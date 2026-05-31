/**
 * 歌词服务
 * 优先级：平台官方 API > LrcApi 兜底
 * 四平台均有官方歌词接口，酷狗用 fmt=lrc 直取（跳过 KRC 解密）
 * QQ 的 mid 随版本更新会重分配，必须使用实时搜索获取的最新 mid
 */
import axios from 'axios';
import { PlayInfo } from '@/types/music';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ── 网易云官方歌词 API ──

async function fetchNeteaseLyric(songId: string): Promise<string | null> {
  try {
    const resp = await axios.post(
      'https://interface3.music.163.com/api/song/lyric',
      new URLSearchParams({ id: songId, cp: 'false', tv: '0', lv: '0', rv: '0', kv: '0', yv: '0', ytv: '0', yrv: '0' }),
      {
        headers: { 'User-Agent': UA, Referer: 'https://music.163.com/', 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      },
    );
    const lrc = resp.data?.lrc?.lyric || resp.data?.lyric;
    return lrc || null;
  } catch {
    return null;
  }
}

// ── QQ 音乐官方歌词 API ──
// songId 即 QQ 的 mid，必须是最新搜索拿到的（旧 mid 可能已被回收重分配）

async function fetchQQLyric(mid: string): Promise<string | null> {
  try {
    const resp = await axios.get(
      'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
      {
        params: {
          songmid: mid,
          g_tk: '5381',
          format: 'json',
          nobase64: '1',
          loginUin: '0',
          hostUin: '0',
          platform: 'yqq',
          needNewCode: '0',
          inCharset: 'utf8',
          outCharset: 'utf-8',
        },
        headers: { 'User-Agent': UA, Referer: `https://y.qq.com/n/yqq/song/${mid}.html` },
        timeout: 5000,
      },
    );
    const lrc = resp.data?.lyric;
    if (!lrc || lrc.length < 10) return null;
    // nobase64=1 理论上去掉 base64，但部分 mid 仍然返回 base64，兜底解码
    try {
      const decoded = Buffer.from(lrc, 'base64').toString('utf-8');
      if (decoded.startsWith('[ti:') || decoded.startsWith('[ar:') || decoded.startsWith('[offset:')) {
        return decoded;
      }
    } catch {}
    return lrc;
  } catch {
    return null;
  }
}

// ── 酷狗音乐官方歌词 API ──
// songId 即酷狗 hash，如 "b3a52a7a958bf0aed0ebfba2e9a818b7"
// fmt=lrc 直取 LRC 格式，跳过 KRC 的 XOR+ZLIB 解密

async function fetchKugouLyric(hash: string): Promise<string | null> {
  try {
    // 第1步：搜索歌词 ID（用 hash 精确匹配）
    const searchResp = await axios.get('http://krcs.kugou.com/search', {
      params: { ver: '1', man: 'no', client: 'pc', hash },
      headers: { 'User-Agent': UA },
      timeout: 5000,
    });
    const candidate = searchResp.data?.candidates?.[0];
    if (!candidate?.id || !candidate?.accesskey) return null;

    // 第2步：下载歌词（fmt=lrc 直接拿标准 LRC 文本）
    const dlResp = await axios.get('http://lyrics2.kugou.com/download', {
      params: {
        accesskey: candidate.accesskey,
        charset: 'utf8',
        client: 'pc',
        fmt: 'lrc',
        id: candidate.id,
        ver: '1',
      },
      headers: { 'User-Agent': UA },
      timeout: 5000,
    });
    const content = dlResp.data?.content;
    if (!content || content.length < 20) return null;

    // 内容以 base64 传输，解码得标准 LRC
    const lrc = Buffer.from(content, 'base64').toString('utf-8');
    return lrc || null;
  } catch {
    return null;
  }
}

// ── 酷我音乐官方歌词 API ──
// songId 即 musicrid 去掉 MUSIC_ 前缀后的数字，如 "215257"

function formatKuwoLrc(lrclist: Array<{ time: string; lineLyric: string }>): string | null {
  if (!lrclist?.length) return null;
  const lines = lrclist
    .filter(l => l.lineLyric && l.time)
    .map(l => {
      const sec = parseFloat(l.time);
      const min = Math.floor(sec / 60);
      const s = (sec % 60).toFixed(2);
      return `[${String(min).padStart(2, '0')}:${String(s).padStart(5, '0')}]${l.lineLyric}`;
    });
  return lines.length > 0 ? lines.join('\n') : null;
}

async function fetchKuwoLyric(musicId: string): Promise<string | null> {
  try {
    const resp = await axios.get(
      'https://m.kuwo.cn/newh5/singles/songinfoandlrc',
      {
        params: { musicId },
        headers: { 'User-Agent': UA, Referer: 'https://m.kuwo.cn/' },
        timeout: 5000,
      },
    );
    const lrclist = resp.data?.data?.lrclist;
    return formatKuwoLrc(lrclist);
  } catch {
    return null;
  }
}

// ── LrcApi 兜底 ──

async function fetchLrcApi(title: string, artist: string, album?: string): Promise<string | null> {
  try {
    const params: Record<string, string> = { title, artist };
    if (album) params.album = album;
    const resp = await axios.get('https://api.lrc.cx/lyrics', {
      params,
      headers: { 'User-Agent': UA },
      timeout: 8000,
    });
    if (typeof resp.data === 'string' && resp.data.length > 10) return resp.data;
    return null;
  } catch {
    return null;
  }
}

// ── 统一入口 ──

/** 歌词入口：按平台走官方 API，失败则 LrcApi 兜底 */
export async function fetchLyric(
  platform: string,
  songId: string,
  title: string,
  artist: string,
  album?: string,
  adapterLyric?: string,
): Promise<string | undefined> {
  // 0. 适配器自带歌词（如 jianbin 返回的 lrc）
  if (adapterLyric) return adapterLyric;

  // 1. 平台官方 API
  if (platform === 'netease') {
    const lrc = await fetchNeteaseLyric(songId);
    if (lrc) return lrc;
  }
  if (platform === 'qq') {
    const lrc = await fetchQQLyric(songId);
    if (lrc) return lrc;
  }
  if (platform === 'kuwo') {
    // 兼容 playlist 解析器未去 MUSIC_ 前缀的情况
    const musicId = songId.replace(/^MUSIC_/, '');
    const lrc = await fetchKuwoLyric(musicId);
    if (lrc) return lrc;
  }
  if (platform === 'kugou') {
    const lrc = await fetchKugouLyric(songId);
    if (lrc) return lrc;
  }

  // 2. LrcApi 兜底
  if (title && artist) {
    const lrc = await fetchLrcApi(title, artist, album);
    if (lrc) return lrc;
  }

  return undefined;
}

/** 补充歌词到 PlayInfo（已有歌词则跳过） */
export async function enrichWithLyric(
  platform: string,
  songId: string,
  title: string,
  artist: string,
  album?: string,
  info?: PlayInfo,
): Promise<PlayInfo> {
  if (!info) return { url: '', type: 'mp3' };
  if (info.lyric) return info;
  const lyric = await fetchLyric(platform, songId, title, artist, album);
  return { ...info, lyric: lyric || undefined };
}
