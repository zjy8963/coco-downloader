/**
 * 网易云复杂适配器 — 完全对照 musicdl 源码逐 API 实现
 * 关键修复：form-encoded POST / SSL 跳过 / 音质参数精确匹配 / 两步 API 正确调用
 */
import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';
import { randomUA } from '../../../utils';

// 跳过自签名 SSL 证书验证（musicdl 部分 API 使用 verify=False）
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

// 网易云音质列表（musicdl MUSIC_QUALITIES）
const QS = ['jymaster', 'dolby', 'sky', 'jyeffect', 'hires', 'lossless', 'exhigh', 'standard'];

// ============================================================
// luosu (1) — 两步搜索：name → index(n) → URL
// ============================================================
export class LuosuAdapter implements AudioApiAdapter {
  readonly name = 'luosu'; readonly priority = 1;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const name = raw.title; if (!name) return null;
    try {
      const sResp = await axios.get('https://api.luosu.top/api/wymusic/', {
        params: { ss: name, format: 'json' }, timeout: 8000,
      });
      const songs: any[] = sResp.data?.songs || [];
      const target = songs.find((s: any) => String(s.id) === String(raw.id));
      const n = target?.index ?? 1;
      const resp = await axios.get('https://api.luosu.top/api/wymusic/', {
        params: { ss: name, n }, timeout: 8000,
      });
      const url: string = resp.data?.play_url?.url;
      if (!url?.startsWith('http')) return null;
      return { url, type: 'flac', cover: resp.data?.detail?.album_pic };
    } catch { return null; }
  }
}

// ============================================================
// 317ak (2) — ckey + 两步搜索
// ============================================================
export class Ne317akAdapter implements AudioApiAdapter {
  readonly name = '317ak'; readonly priority = 2;
  private ckey = 'A5VC8VDC1NYMMT18Z9JQ';
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const name = raw.title; if (!name) return null;
    try {
      const sResp = await axios.get('https://api.317ak.cn/api/yljk/wyyundg/wyyundg', {
        params: { ckey: this.ckey, msg: name }, timeout: 8000,
      });
      let songs = sResp.data;
      if (typeof songs === 'object' && !Array.isArray(songs)) songs = songs?.data || songs?.songs || [];
      let n = 1;
      if (Array.isArray(songs)) {
        const idx = songs.findIndex((s: any) => String(s.id) === String(raw.id));
        if (idx >= 0) n = idx + 1;
      }
      const resp = await axios.get('https://api.317ak.cn/api/yljk/wyyundg/wyyundg', {
        params: { ckey: this.ckey, msg: name, n, br: '4' }, timeout: 8000,
      });
      const url: string = resp.data?.url;
      if (!url?.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch { return null; }
  }
}

// ============================================================
// xiaoqin (3) — AES-GCM 密钥握手（musicdl: verify=False, json payload）
// ============================================================
export class XiaoqinAdapter implements AudioApiAdapter {
  readonly name = 'xiaoqin'; readonly priority = 3;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const headers = {
      'Accept': '*/*', 'Content-Type': 'application/json',
      'Origin': 'https://wyapi.toubiec.cn', 'Referer': 'https://wyapi.toubiec.cn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
    };
    const axOpts = { headers, timeout: 8000, httpsAgent: insecureAgent };
    try {
      const keyResp = await axios.post('https://nextmusic.toubiec.cn/api/key', {}, axOpts);
      const { keyId, keyToken, key: b64Key } = keyResp.data?.data || {};
      if (!b64Key) return null;
      const aesKey = Buffer.from(b64Key, 'base64');

      for (const level of QS) {
        const timestamp = Date.now();
        const payload = JSON.stringify({ id: String(raw.id), level, timestamp });
        const nonce = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
        const enc = Buffer.concat([cipher.update(payload, 'utf-8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        const data = [nonce.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');

        const songResp = await axios.post('https://nextmusic.toubiec.cn/api/getSongUrl',
          { keyId, keyToken, data }, axOpts);
        const ct = songResp.data?.ciphertext;
        if (!ct) continue;

        const parts = ct.split('.');
        const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(parts[0], 'base64'));
        decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
        const dec = Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]);
        const result = JSON.parse(dec.toString('utf-8'));
        const url: string = result?.data?.url;
        if (!url?.startsWith('http')) continue;
        return { url, type: 'flac' };
      }
    } catch { return null; }
    return null;
  }
}

// ============================================================
// znnu (4) — HMAC-SHA256 + AES-GCM
// 关键修复：Cookie 跨请求传递（musicdl 用 Session 自动维护）
// ============================================================
export class ZnnuAdapter implements AudioApiAdapter {
  readonly name = 'znnu'; readonly priority = 4;
  // Python: b"a09d0f..." = 64 字节 ASCII 字面量，不是 hex
  private hmacKey = Buffer.from('a09d0f3700a279584e1515354fbe08a7ee1c617f919543142fa625b82f1b5ad0', 'utf-8');
  // 共享 axios 实例（模拟 requests.Session：连接复用 + Cookie jar）
  private session = axios.create({
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Referer: 'https://music.znnu.com/',
    },
  });
  private cookieJar: string[] = ['MUSIC_U=1eb9ce22024bb666e99b6743b2222f29ef64a9e88fda0fd5754714b900a5d70d993166e004087dd3b95085f6a85b059f5e9aba41e3f2646e3cebdbec0317df58c119e5'];

  private get cookies(): string { return this.cookieJar.join('; '); }

  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      // 1. GET /api/key
      const keyResp = await this.session.get('https://music.znnu.com/api/key', {
        headers: { 'User-Agent': randomUA(), Cookie: this.cookies  },
      });
      // 更新 cookie jar
      const sc = keyResp.headers['set-cookie'];
      if (sc) {
        const newCookies = (Array.isArray(sc) ? sc : [sc]).map(c => c.split(';')[0]);
        for (const c of newCookies) {
          const name = c.split('=')[0];
          this.cookieJar = this.cookieJar.filter(existing => !existing.startsWith(name + '='));
          this.cookieJar.push(c);
        }
      }

      const d = keyResp.data?.data;
      if (!d?.keyToken || !d?.key) return null;
      const aesKey = Buffer.from(d.key, 'base64');
      const ip = Array.from({length:4},()=>Math.floor(Math.random()*256)).join('.');

      for (const level of QS) {
        const baseParams: Record<string,string> = { act:'song', id:raw.id, level, ip };
        const ts = String(Math.floor(Date.now()/1000));
        const domain = 'music.znnu.com';
        const sorted = Object.keys(baseParams).sort().map(k=>`${k}=${baseParams[k]}`).join('');
        const sign = crypto.createHmac('sha256',this.hmacKey).update(ts+domain+sorted).digest('hex');
        const fd = new URLSearchParams({...baseParams, timestamp:ts, domain, signature:sign}).toString();

        // 直接用字符串 body 发 POST，完全控制编码
        const resp = await this.session.post('https://music.znnu.com/api/song', fd, {
          headers: {
            'x-key-token': d.keyToken,
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            Cookie: this.cookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: 'https://music.znnu.com/',
          },
        });

        const enc = resp.data?.data;
        if (!enc?.ciphertext) continue;
        const iv = Buffer.from(enc.iv,'base64'), tag = Buffer.from(enc.tag,'base64'), ct = Buffer.from(enc.ciphertext,'base64');
        const decr = crypto.createDecipheriv('aes-256-gcm',aesKey,iv);
        decr.setAuthTag(tag);
        const dec = JSON.parse(Buffer.concat([decr.update(ct),decr.final()]).toString('utf-8'));
        const url:string = dec?.url;
        if (!url?.startsWith('http')) continue;
        return {url,type:'flac'};
      }
    } catch { return null; }
    return null;
  }
}

// ============================================================
// guyuei (12) — URL XOR 解密
// ============================================================
export class GuyueiNeAdapter implements AudioApiAdapter {
  readonly name = 'guyuei'; readonly priority = 12;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get('https://www.guyuei.com/music/163.php', {
        params: { url: `https://music.163.com/song?id=${raw.id}`, yinzhi: 'hns' },
        headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000,
      });
      const enc: string = resp.data?.url; if (!enc) return null;
      // musicdl: base64(A + enc[9:]) → XOR key=b"nsh"
      const padded = 'A' + enc.substring(9) + '='.repeat((4 - (enc.length - 9) % 4) % 4);
      const decoded = Buffer.from(padded.substring(1), 'base64');
      const key = Buffer.from('nsh');
      let r = 'http';
      for (let i = 1; i < decoded.length; i++) r += String.fromCharCode(decoded[i] ^ key[(i-1)%3]);
      const url = r.replace(/\x00+$/, '');
      return url.startsWith('http') ? { url, type: 'flac' } : null;
    } catch { return null; }
  }
}

// ============================================================
// nycnmbyfuns (21) — API key 已失效（返回 403）
// ============================================================
export class NycnmbyfunsAdapter implements AudioApiAdapter {
  readonly name = 'nycnmbyfuns'; readonly priority = 21;
  private keys = [
    'charlespikachuZTYxMDlhMDJiYmYwMjg1MmJhZmIwMGE5ZjIzNWZlYWVjZDk4NTBhNjBlNWYyYmQ0YzQxYWNjYTczNjQwNGIwZA==',
    'charlespikachuOWMxOGVmMTVhYjM2ODRjMGE4NTQ0ODZlYTg4MzcxZTQ1MDNjM2JjMWZjODYzODI1OTgzNzQwZGU5NTU3NTljYg=='
  ];
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const k of this.keys) {
      const apikey = Buffer.from(k.substring(14),'base64').toString('utf-8');
      for (const level of QS) {
        try {
          await axios.get('https://api.nycnm.cn/API/163music.php',{
            params:{ids:raw.id,level,type:'json',apikey},timeout:8000,
          });
          const resp = await axios.get('https://api.byfuns.top/1/',{
            params:{id:raw.id,level},responseType:'text',timeout:8000,
          });
          const url = String(resp.data).trim();
          if (!url?.startsWith('http')) continue;
          return {url,type:'mp3'};
        } catch { /* 403 Forbidden */ }
      }
    }
    return null;
  }
}

// ============================================================
// rrvenn (27) — MD5 签名
// ============================================================
export class RrvennAdapter implements AudioApiAdapter {
  readonly name = 'rrvenn'; readonly priority = 27;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const level of QS) {
      try {
        const ts = String(Math.floor(Date.now() / 1000));
        const sign = crypto.createHash('md5').update(ts + 'kxz_163music_secret_key_2024').digest('hex');
        const resp = await axios.get('https://music.rrvenn.cn/api/api.php', {
          params: { action: 'music', url: raw.id, level, type: 'json', timestamp: ts, signature: sign },
          timeout: 8000,
        });
        const url: string = resp.data?.url;
        if (!url?.startsWith('http')) continue;
        return { url, type: 'mp3' };
      } catch {}
    }
    return null;
  }
}
