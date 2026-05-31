/**
 * 酷我适配器 — 对照 musicdl 源码，格式从 URL 识别
 */
import axios from 'axios';
import crypto from 'crypto';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';
import { randomUA } from '../../../utils';

const E = (url: string) => url.split('?')[0].split('.').pop() || 'mp3';

// ── ccwu — musicdl: audio_link_tester.test 验证 URL 可达性 ──
export class CcwuAdapter implements AudioApiAdapter {
  readonly name = 'ccwu'; readonly priority = 1;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const url = `http://kw.006lp.ccwu.cc:7119/api/song?id=${raw.id}&level=jymaster&stream=1`;
    try {
      const resp = await axios.get(url, { timeout: 5000, maxRedirects: 5, responseType: 'stream', headers: { 'User-Agent': randomUA(), Range: 'bytes=0-0'  } });
      if (resp.status < 400) return { url, type: 'flac' };
    } catch { return { url, type: 'flac' }; } // fallback 直返 URL
    return null;
  }
}

// ── yibai — musicdl: 完整 MD5-like 签名 + AES-GCM ──
export class YibaiAdapter implements AudioApiAdapter {
  readonly name = 'yibai'; readonly priority = 2;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of ['master','atmos_plus','atmos','flac','320k']) {
      try {
        const sign = crypto.createHash('md5').update(`id=${raw.id}&q=${q}`).digest('hex');
        const resp = await axios.get('http://kwdecf.yibai.us/kwurl', {
          params: { id: raw.id, q, sign },
          headers: { Referer:'http://api.liuyunidc.cn/', Host:'kwdecf.yibai.us', 'User-Agent':'Mozilla/5.0' },
          timeout: 5000,
        });
        const enc = resp.data?.url;
        if (!enc) continue;
        const key = Buffer.from('kwdecyibainb66666666666666666666');
        const encBuf = Buffer.from(enc + '='.repeat((4-enc.length%4)%4), 'base64url');
        if (encBuf.length < 28) continue;
        const nonce = encBuf.subarray(0,12), tag = encBuf.subarray(encBuf.length-16), ct = encBuf.subarray(12,encBuf.length-16);
        const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
        d.setAuthTag(tag);
        const url = Buffer.concat([d.update(ct), d.final()]).toString('utf-8');
        if (url?.startsWith('http')) return { url, type: E(url) };
      } catch {}
    }
    return null;
  }
}

// ── cgg ──
export class CggKuwoAdapter implements AudioApiAdapter {
  readonly name = 'cgg'; readonly priority = 3;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get('https://kw-api.cenguigui.cn/', {
        params: { id: raw.id, type: 'song', level: 'lossless', format: 'json' }, timeout: 5000,
      });
      const url: string = resp.data?.data?.url;
      return url?.startsWith('http') ? { url, type: E(url) } : null;
    } catch { return null; }
  }
}

// ── ceseet ──
export class CeseetKuwoAdapter implements AudioApiAdapter {
  readonly name = 'ceseet'; readonly priority = 4;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://m-api.ceseet.me/url/kw/${raw.id}/flac`, {
        headers: { 'Content-Type':'application/json', 'User-Agent':'lx-music-request/2.6.0', 'X-Request-Key':'' },
        timeout: 5000,
      });
      const url: string = resp.data?.data;
      return url?.startsWith('http') ? { url, type: E(url) } : null;
    } catch { return null; }
  }
}

// ── lxmusic ──
export class LxmusicKuwoAdapter implements AudioApiAdapter {
  readonly name = 'lxmusic'; readonly priority = 5;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://lxmusicapi.onrender.com/url/kw/${raw.id}/flac`, {
        headers: { 'Content-Type':'application/json', 'User-Agent':'lx-music-request/2.6.0', 'X-Request-Key':'share-v3' },
        timeout: 5000,
      });
      const url: string = resp.data?.url;
      return url?.startsWith('http') ? { url, type: E(url) } : null;
    } catch { return null; }
  }
}

// ── gdstudio — musicdl: types=url (注意 s) ──
export class GdstudioKuwoAdapter implements AudioApiAdapter {
  readonly name = 'gdstudio'; readonly priority = 6;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://music-api.gdstudio.xyz/api.php?types=url&id=${raw.id}&source=kuwo&br=999`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
      const url: string = resp.data?.url;
      return url?.startsWith('http') ? { url, type: E(url) } : null;
    } catch { return null; }
  }
}

// ── nxinxz ──
export class NxinxzAdapter implements AudioApiAdapter {
  readonly name = 'nxinxz'; readonly priority = 7;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of ['lossless','exhigh','standard']) {
      try {
        const resp = await axios.get(`http://music.nxinxz.com/kw.php?id=${raw.id}&level=${q}&type=json`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
        const url: string = resp.data?.data?.url;
        if (url?.startsWith('http')) return { url, type: E(url) };
      } catch {}
    }
    return null;
  }
}

// ── haitangw ──
export class HaitangwKuwoAdapter implements AudioApiAdapter {
  readonly name = 'haitangw'; readonly priority = 8;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of ['lossless','exhigh','standard']) {
      try {
        const resp = await axios.get(`https://musicapi.haitangw.net/music/kw.php?id=${raw.id}&level=${q}&type=json`, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
        const url: string = resp.data?.data?.url;
        if (url?.startsWith('http')) return { url, type: E(url) };
      } catch {}
    }
    return null;
  }
}

// ── yyy001 ──
export class Yyy001Adapter implements AudioApiAdapter {
  readonly name = 'yyy001'; readonly priority = 9;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const rkeys = ['charlespikachuU2hhbmhhaS11RENkUGhoQ2xlUmd2WFh5bFFCbHFQVHMyb3RtSGNQbFJ5UWdvdlRsbW8wMDRyZko=', 'charlespikachuU2hhbmhhaS0yYlBxOUJFcFV5ZUtENGNESGc0MHp3Nzl6UDN1SkhqalNTS2hCekpYRVpxakdTbzE=', 'charlespikachuU2hhbmhhaS1XenJBNlFWS2N5RlExYk5aemRSZ1NpVHVhR1Z6N21ET29GamVEM0FvS3NGUlFtZ2M='];
    const key = Buffer.from(rkeys[Math.floor(Math.random()*rkeys.length)].substring(14), 'base64').toString('utf-8');
    for (const q of ['ff','p','h']) {
      for (let i=0; i<5; i++) {
        try {
          const resp = await axios.get('https://apione.apibyte.cn/kwmusic', {
            params: { key, action:'music_url', music_id: raw.id, quality: q }, timeout: 5000,
          });
          if (resp.data?.code !== 200 && resp.data?.code !== '200') continue;
          const url: string = resp.data?.data?.url;
          if (url?.startsWith('http')) return { url, type: E(url) };
        } catch { await new Promise(r=>setTimeout(r,1000)); }
      }
    }
    return null;
  }
}

// ── guyuei — musicdl: base64(A+enc[9:]) → skip byte0 → XOR key=nsh ──
export class GuyueiKuwoAdapter implements AudioApiAdapter {
  readonly name = 'guyuei'; readonly priority = 10;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get('https://www.guyuei.com/music/kw.php', {
        params: { url: `https://www.kuwo.cn/play_detail/${raw.id}`, yinzhi:'hns' },
        headers: { 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36' },
        timeout: 5000,
      });
      const enc: string = resp.data?.url;
      if (!enc) return null;
      // musicdl: "A" + enc[9:], pad, base64 decode, skip byte 0, XOR key=b"nsh"
      const str = 'A' + enc.substring(9);
      const padded = str + '='.repeat((4 - str.length % 4) % 4);
      const decoded = Buffer.from(padded, 'base64');
      const key = Buffer.from('nsh');
      let r = 'http';
      for (let i = 1; i < decoded.length; i++) r += String.fromCharCode(decoded[i] ^ key[(i-1) % 3]);
      const url = r.replace(/\x00+$/, '');
      return url.startsWith('http') ? { url, type: url.split('?')[0].split('.').pop() || 'mp3' } : null;
    } catch { return null; }
  }
}
