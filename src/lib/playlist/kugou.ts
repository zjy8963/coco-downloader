/**
 * 酷狗音乐歌单解析
 * Gateway API 签名 + 分页获取 → HTML 提取歌单名
 * 播放/下载时才按需通过第三方 API 解析音频
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { MusicItem } from '@/types/music';
import { PlaylistResult } from './index';

function extractPlaylistId(url: string): string {
  const cleanUrl = url.split('#')[0];
  const pathname = new URL(cleanUrl).pathname;
  if (pathname.includes('special/single/')) {
    const match = pathname.match(/\/single\/(\d+)/);
    if (match) return match[1];
  }
  if (pathname.includes('plist/list/')) {
    const match = pathname.match(/\/list\/(\d+)/);
    if (match) return match[1];
  }
  throw new Error('无法从链接中提取歌单 ID，支持格式：special/single/XXX 或 plist/list/XXX');
}

/** 酷狗 MD5 签名 */
function kugouSign(apiUrl: string): string {
  const questStr = apiUrl.split('?')[1] || '';
  const sorted = questStr.split('&').sort().join('');
  return crypto.createHash('md5')
    .update(`OIlwieks28dk2k092lksi2UIkp${sorted}OIlwieks28dk2k092lksi2UIkp`)
    .digest('hex');
}

const ANDROID_HEADERS_BASE = {
  'User-Agent': 'Android9-AndroidPhone-11239-18-0-playlist-wifi',
  Host: 'gatewayretry.kugou.com',
  'x-router': 'pubsongscdn.kugou.com',
  mid: '239526275778893399526700786998289824956',
  dfid: '-',
};

/** 从歌单页面 HTML 提取 specialInfo */
async function fetchPlaylistMetaFromPage(url: string): Promise<{ name: string; cover: string }> {
  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.kugou.com/songlist/' },
      timeout: 10000,
    });
    const $ = cheerio.load(resp.data);
    const scripts = $('script').toArray();
    for (const script of scripts) {
      const text = $(script).html() || '';
      const match = text.match(/var\s+specialInfo\s*=\s*(\{[\s\S]*?\});/);
      if (match) {
        const info = JSON.parse(match[1]);
        return { name: info.name || '', cover: (info.imgurl || '').replace('{size}', '400') };
      }
    }
  } catch { /* 提取失败，使用默认名 */ }
  return { name: '', cover: '' };
}

/** 酷狗文件名格式：歌手 - 歌名 */
function parseName(raw: string): { artist: string; title: string } {
  const idx = raw.indexOf(' - ');
  return idx > 0
    ? { artist: raw.substring(0, idx).trim(), title: raw.substring(idx + 3).trim() }
    : { artist: '未知歌手', title: raw };
}

export async function parseKugouPlaylist(url: string): Promise<PlaylistResult> {
  const playlistId = extractPlaylistId(url);

  // ── 分页获取所有歌曲 ──
  const allTracks: Array<Record<string, unknown>> = [];
  let page = 1;
  while (true) {
    const apiUrl = `http://gatewayretry.kugou.com/v2/get_other_list_file?specialid=${playlistId}&need_sort=1&module=CloudMusic&clientver=11239&pagesize=300&specalidpgc=${playlistId}&userid=0&page=${page}&type=0&area_code=1&appid=1005`;
    const signature = kugouSign(apiUrl);
    const headers = { ...ANDROID_HEADERS_BASE, clienttime: Math.floor(Date.now() / 1000).toString() };
    try {
      const resp = await axios.get(`${apiUrl}&signature=${signature}`, { headers, timeout: 15000 });
      const info = resp.data?.data?.info || [];
      if (info.length === 0) break;
      allTracks.push(...info);
      if (Number(resp.data?.data?.count || 0) <= allTracks.length) break;
      page++;
    } catch { break; }
  }

  // ── 歌单名/封面 ──
  const { name: pageName, cover: pageCover } = await fetchPlaylistMetaFromPage(url);
  const playlistName = pageName || `歌单 ${playlistId}`;

  // ── 去重 ──
  const seen = new Set<string>();
  const uniqueTracks = allTracks.filter(t => {
    const h = t.hash as string;
    if (!h || seen.has(h)) return false;
    seen.add(h);
    return true;
  });

  // id 存 hash，播放时通过 AudioResolver（5 个适配器链）解析音频
  const items: MusicItem[] = uniqueTracks.map(track => {
    const rawName = (track.name || track.filename || '未知歌曲') as string;
    const { artist, title } = parseName(rawName);
    const singers = track.singerinfo as Array<{ name: string }> | undefined;
    const finalArtist = singers?.length ? singers.map(s => s.name).join(' ') : artist;
    const displayArtist = singers?.length ? singers.map(s => s.name).join(' / ') : artist;
    const hash = (track.hash as string) || '';
    const coverUrl = ((track.cover as string) || '').replace('{size}', '240');
    return {
      id: `kugou:${hash}`,
      title,
      artist: displayArtist,
      album: ((track.albuminfo as { name?: string })?.name) || '',
      cover: coverUrl || undefined,
      provider: 'jianbin-kugou',
      extra: { id: hash, title, artist: finalArtist, source: 'kugou' },
    };
  });

  return {
    info: { name: playlistName, trackCount: items.length, cover: pageCover || items[0]?.cover },
    items,
  };
}
