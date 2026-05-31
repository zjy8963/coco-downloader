/**
 * QQ音乐适配器 — 逐行对照 musicdl，格式从 URL 自动识别
 */
import axios from 'axios';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';
import { randomUA } from '../../../utils';

// URL 提取扩展名
const ext = (url: string) => url.split('?')[0].split('.').pop() || 'mp3';

// ── liuyunidc ──
export class LiuyunidcQqAdapter implements AudioApiAdapter {
  readonly name = 'liuyunidc'; readonly priority = 2;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const headers = {
      accept: '*/*', 'accept-encoding': 'gzip, deflate',
      'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: 'http://api.liuyunidc.cn/baimusic/', host: 'api.liuyunidc.cn',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    };
    for (const q of ['master','atmos_plus','atmos','flac','320k','128k']) {
      try {
        const resp = await axios.get(`http://api.liuyunidc.cn/baimusic/musicurl.php?source=tx&musicId=${raw.id}&quality=${q}`, { headers, timeout: 5000 });
        const url: string = resp.data?.url;
        if (url?.startsWith('http')) return { url, type: ext(url) };
      } catch {}
    }
    return null;
  }
}

// ── 317ak ──
export class Qq317akAdapter implements AudioApiAdapter {
  readonly name = '317ak'; readonly priority = 1;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const ckey = Buffer.from('charlespikachuWk83NlFKQ0lINVBQSUNKT09YVUg='.substring(14), 'base64').toString('utf-8');
    const h = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' };
    for (const br of ['8','6','5']) {
      try {
        const resp = await axios.get(`https://api.317ak.cn/api/yinyue/qqyinyue?ckey=${ckey}&i=${raw.id}&br=${br}&type=json&lrc=1`, { headers: h, timeout: 5000 });
        const url: string = resp.data?.url;
        if (url?.startsWith('http')) return { url, type: ext(url) };
      } catch {}
    }
    return null;
  }
}

// ── lpz ──
export class LpzAdapter implements AudioApiAdapter {
  readonly name = 'lpz'; readonly priority = 3;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://lpz.chatc.vip/apiqq.php?songmid=${raw.id}&type=json&br=1`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
      const url: string = resp.data?.data?.music_url;
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── tang ──
export class TangAdapter implements AudioApiAdapter {
  readonly name = 'tang'; readonly priority = 4;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://tang.api.s01s.cn/music_open_api.php?mid=${raw.id}`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
      const d = resp.data;
      const url = d?.song_play_url_sq || d?.song_play_url_pq || d?.song_play_url_accom
        || d?.song_play_url_hq || d?.song_play_url || d?.song_play_url_standard || d?.song_play_url_fq;
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── nki (5) — musicdl 完全复刻: 先 curl_cffi 再普通 GET, 多 URL 字段降级 ──
export class NkiAdapter implements AudioApiAdapter {
  readonly name = 'nki'; readonly priority = 5;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const rkeys = ['MjhmZWNlOTI1NDM5YjA1Mjc5MmE5Nzk4OWM4NzBjZWQzODAzYTcxYzZiNTM0ZjcxZTVhNTMzMzhiMmQzMWVmOA==', 'YzRjNGY1ZmMzNmJhZDRjYWNiOTg4MzllMTRmZWE0MDI3N2IzNWVhMmViMWJhYmRhZDdiYmRlMTI4NDAwZjNiMQ=='];
    // musicdl: decrypt = base64(str).encode → 全串 base64 解码
    const key = Buffer.from(rkeys[Math.floor(Math.random() * rkeys.length)], 'base64').toString('utf-8');
    try {
      const resp = await axios.get(
        `https://api.nki.pw/API/music_open_api.php?mid=${raw.id}&apikey=${encodeURIComponent(key)}`,
        { headers: { 'User-Agent': randomUA() }, timeout: 8000 }
      );
      const d = resp.data;
      // musicdl 多字段优先级降级
      const url = d?.song_play_url_sq || d?.song_play_url_pq || d?.song_play_url_accom
        || d?.song_play_url_hq || d?.song_play_url || d?.song_play_url_standard || d?.song_play_url_fq;
      if (!url?.startsWith('http')) return null;
      return { url, type: ext(url) };
    } catch { return null; }
  }
}
export class XianyuwQqAdapter implements AudioApiAdapter {
  readonly name = 'xianyuw'; readonly priority = 5;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const key = Buffer.from('charlespikachuc2stODRiMzc5N2Y5MTg0ODFmZGE0ZDkxMWMwZjYzYjc0MzE='.substring(14), 'base64').toString('utf-8');
    try {
      const resp = await axios.get(`https://apii.xianyuw.cn/api/v1/qq-music-search?id=${raw.id}&key=${key}&no_url=0&br=hires`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
      const url: string = resp.data?.data?.url;
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── xunhuisi ──
export class XunhuisiAdapter implements AudioApiAdapter {
  readonly name = 'xunhuisi'; readonly priority = 6;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://api.xunhuisi.store/API/QQMusic/Song.php?mid=${raw.id}&type=json`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
      const url: string = resp.data?.music_url;
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── cyapi ──
export class CyapiAdapter implements AudioApiAdapter {
  readonly name = 'cyapi'; readonly priority = 7;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const keys = ['1ffdf5733f5d538760e63d7e46ba17438d9f7b9dfc18c51be1109386fd74c3a1', '2baf39266d8ef0580aba937245d5bb569fe376f230ff508f1faa0922dc320fe4'];
    try {
      const resp = await axios.get('https://cyapi.top/API/qq_music.php', {
        params: { apikey: keys[Math.floor(Math.random()*keys.length)], type: 'json', mid: raw.id, quality: 'lossless' },
        timeout: 5000,
      });
      const url: string = resp.data?.url;
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── lxmusic ──
export class LxmusicQqAdapter implements AudioApiAdapter {
  readonly name = 'lxmusic'; readonly priority = 8;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://lxmusicapi.onrender.com/url/tx/${raw.id}/flac`, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'lx-music-request/2.6.0', 'X-Request-Key': 'share-v3' },
        timeout: 8000,
      });
      const url: string = resp.data?.url;
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── xcvts ──
export class XcvtsQqAdapter implements AudioApiAdapter {
  readonly name = 'xcvts'; readonly priority = 9;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const keys = ['Nzg5OTMzNDRiOWJmMTEwNTY1NTU5OTAwOWNkYmEzZDI=', 'Y2U3NzhlYjBkMTg1OGVkZmI0YjIwNzFhMTE1ZjFlZGY='];
    const key = Buffer.from(keys[0], 'base64').toString('utf-8');
    for (const q of ['臻品母带','臻品全景声','臻品2.0','SQ无损','HQ高品质','中品质','普通','低品质','试听']) {
      try {
        const resp = await axios.get(`https://api.xcvts.cn/api/music/qq?apiKey=${key}&mid=${raw.id}&type=${encodeURIComponent(q)}`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
        const url: string = resp.data?.data?.music;
        if (url?.startsWith('http')) return { url, type: ext(url) };
      } catch {}
    }
    return null;
  }
}

// ── vkeys ──
export class VkeysAdapter implements AudioApiAdapter {
  readonly name = 'vkeys'; readonly priority = 10;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://api.vkeys.cn/v2/music/tencent/geturl?mid=${raw.id}&quality=8`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
      const url: string = resp.data?.data?.url;
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── ygking ──
export class YgkingAdapter implements AudioApiAdapter {
  readonly name = 'ygking'; readonly priority = 11;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://api.ygking.top/api/song/url?mid=${raw.id}&quality=master`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
      const url: string = resp.data?.data?.[raw.id];
      return url?.startsWith('http') ? { url, type: ext(url) } : null;
    } catch { return null; }
  }
}

// ── luoyue ──
export class LuoyueAdapter implements AudioApiAdapter {
  readonly name = 'luoyue'; readonly priority = 12;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const h = { 'Content-Type': 'application/json', 'User-Agent': 'lx-music-request/2.6.0', 'X-Request-Key': 'lxmusic' };
    for (const q of ['flac24bit','hires','flac','320k']) {
      try {
        const resp = await axios.get(`http://220.167.101.253:6001/api/musics/url/tx/${raw.id}/${q}`, { headers: h, timeout: 5000 });
        const url: string = resp.data?.data;
        if (url?.startsWith('http')) return { url, type: ext(url) };
      } catch {}
    }
    return null;
  }
}
