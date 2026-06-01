/**
 * 歌词服务
 * 优先级：平台官方 API > LrcApi 兜底
 * 网易云 / QQ 支持双语歌词（原词+翻译合并），酷我 / 酷狗仅原词
 */
import axios from 'axios';
import { PlayInfo } from '@/types/music';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

// ── 双语合并 ──

/** 解析 LRC 为元数据行 + 时间轴行 */
function parseLrc(lrc: string): { meta: string[]; timed: { time: string; text: string }[] } {
  const lines = lrc.split('\n');
  const meta: string[] = [];
  const timed: { time: string; text: string }[] = [];
  for (const line of lines) {
    const match = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\](.*)/);
    if (match) {
      timed.push({ time: match[1], text: match[2].trim() });
    } else if (line.trim()) {
      meta.push(line);
    }
  }
  return { meta, timed };
}

/** 按位置对齐合并原词和翻译：第 N 行原文接第 N 行翻译，同一时间戳 */
function mergeBilingual(lrc: string, trans: string): string {
  if (!trans || trans.length < 5) return lrc;
  const original = parseLrc(lrc);
  const translation = parseLrc(trans);

  const result = [...original.meta];
  for (let i = 0; i < original.timed.length; i++) {
    const o = original.timed[i];
    result.push(`[${o.time}]${o.text}`);
    if (i < translation.timed.length) {
      result.push(`[${o.time}]${translation.timed[i].text}`);
    }
  }
  return result.join('\n');
}

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
    const tlyric = resp.data?.tlyric?.lyric;
    if (!lrc || lrc.length < 10) return null;
    // 合并翻译
    return tlyric ? mergeBilingual(lrc, tlyric) : lrc;
  } catch {
    return null;
  }
}

// ── QQ 音乐官方歌词 API ──

async function fetchQQLyric(mid: string): Promise<string | null> {
  try {
    const resp = await axios.get(
      'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg',
      {
        params: {
          songmid: mid, g_tk: '5381', format: 'json', nobase64: '1',
          loginUin: '0', hostUin: '0', platform: 'yqq',
          needNewCode: '0', inCharset: 'utf8', outCharset: 'utf-8',
        },
        headers: { 'User-Agent': UA, Referer: `https://y.qq.com/n/yqq/song/${mid}.html` },
        timeout: 5000,
      },
    );
    const lyric = resp.data?.lyric;
    const trans = resp.data?.trans;
    if (!lyric || lyric.length < 10) return null;

    // 可能 base64 编码，兜底解码
    const lrc = tryDecodeBase64(lyric);
    const transLrc = trans ? tryDecodeBase64(trans) : '';
    return transLrc ? mergeBilingual(lrc, transLrc) : lrc;
  } catch {
    return null;
  }
}

function tryDecodeBase64(val: string): string {
  try {
    const decoded = Buffer.from(val, 'base64').toString('utf-8');
    if (decoded.startsWith('[ti:') || decoded.startsWith('[ar:') || decoded.startsWith('[offset:')) {
      return decoded;
    }
  } catch {}
  return val;
}

// ── 酷狗音乐官方歌词 API ──

async function fetchKugouLyric(hash: string): Promise<string | null> {
  try {
    const searchResp = await axios.get('http://krcs.kugou.com/search', {
      params: { ver: '1', man: 'no', client: 'pc', hash },
      headers: { 'User-Agent': UA },
      timeout: 5000,
    });
    const candidate = searchResp.data?.candidates?.[0];
    if (!candidate?.id || !candidate?.accesskey) return null;

    const dlResp = await axios.get('http://lyrics2.kugou.com/download', {
      params: {
        accesskey: candidate.accesskey, charset: 'utf8',
        client: 'pc', fmt: 'lrc', id: candidate.id, ver: '1',
      },
      headers: { 'User-Agent': UA },
      timeout: 5000,
    });
    const content = dlResp.data?.content;
    if (!content || content.length < 20) return null;

    const lrc = Buffer.from(content, 'base64').toString('utf-8');
    return lrc || null;
  } catch {
    return null;
  }
}

// ── 酷我音乐官方歌词 API ──

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

export async function fetchLyric(
  platform: string,
  songId: string,
  title: string,
  artist: string,
  album?: string,
  adapterLyric?: string,
): Promise<string | undefined> {
  if (adapterLyric) return adapterLyric;

  if (platform === 'netease') {
    const lrc = await fetchNeteaseLyric(songId);
    if (lrc) return lrc;
  }
  if (platform === 'qq') {
    const lrc = await fetchQQLyric(songId);
    if (lrc) return lrc;
  }
  if (platform === 'kuwo') {
    const musicId = songId.replace(/^MUSIC_/, '');
    const lrc = await fetchKuwoLyric(musicId);
    if (lrc) return lrc;
  }
  if (platform === 'kugou') {
    const lrc = await fetchKugouLyric(songId);
    if (lrc) return lrc;
  }

  if (title && artist) {
    const lrc = await fetchLrcApi(title, artist, album);
    if (lrc) return lrc;
  }

  return undefined;
}

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
