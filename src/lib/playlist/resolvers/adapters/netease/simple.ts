/**
 * 网易云核心适配器合集（29 个中的简单 GET/POST 适配器）
 */
import axios from 'axios';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';
import { randomUA } from '../../../utils';

// 通用音质列表
// 通用音质列表
const QS = ['jymaster', 'dolby', 'sky', 'jyeffect', 'hires', 'lossless', 'exhigh', 'standard'];

// 音质 → 格式映射（无损 → flac，其余 → mp3）
function qualityFormat(q: string): string {
  return ['jymaster', 'dolby', 'sky', 'jyeffect', 'hires', 'lossless'].includes(q) ? 'flac' : 'mp3';
}

// ── bugpk (priority 5) ──
export class BugpkAdapter implements AudioApiAdapter {
  readonly name = 'bugpk'; readonly priority = 5;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('https://api.bugpk.com/api/163_music', {
          params: { ids: raw.id, level: q, type: 'json' }, timeout: 5000,
        });
        const url: string = resp.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: 'flac' };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── xingmian (priority 6) ──
export class XingmianAdapter implements AudioApiAdapter {
  readonly name = 'xingmian'; readonly priority = 6;
  private keys = ['8513033789fda37d053485a83565312ff0428e10b4a7bd21e57107c928c17392', '663924f8ed9ef01700a436d328caa6b0b03543ac404694ca3ec12717be55b856'];
  private qMap: Record<string, string> = { jymaster: '超清母带', dolby: '杜比全景声', sky: '沉浸环绕声', jyeffect: '高清环绕声', hires: 'Hi-Res', lossless: '无损', exhigh: '高音质', standard: '低音质' };
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const key = this.keys[Math.floor(Math.random() * this.keys.length)];
        const resp = await axios.get('https://1.xingmianapi1.ccwu.cc/API/netease.php', {
          params: { id: raw.id, quality: this.qMap[q] || q, apikey: key }, timeout: 5000,
        });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: 'flac' };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── xuanluoge (priority 7) ──
export class XuanluogeAdapter implements AudioApiAdapter {
  readonly name = 'xuanluoge'; readonly priority = 7;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('http://118.24.104.108:3456/api.php', {
          params: { miss: 'getMusicUrl', id: raw.id, level: q }, timeout: 5000,
        });
        const url: string = resp.data?.data?.[0]?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── kangqiovo (priority 8) ── POST form
export class KangqiovoAdapter implements AudioApiAdapter {
  readonly name = 'kangqiovo'; readonly priority = 8;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const params = new URLSearchParams({ url: raw.id, level: q, type: 'json' });
        const resp = await axios.post('https://ncm.kangqiovo.com/Song_V1', params, {
          headers: { 'User-Agent': randomUA(), Referer: 'https://ncm.kangqiovo.com/'  }, timeout: 5000,
        });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── haitangw (priority 9) ──
export class HaitangwNeAdapter implements AudioApiAdapter {
  readonly name = 'haitangw'; readonly priority = 9;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('https://musicapi.haitangw.net/music/wy.php', {
          params: { id: raw.id, level: q, type: 'json' }, timeout: 5000,
        });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── cgg (priority 10) ──
export class CggNeAdapter implements AudioApiAdapter {
  readonly name = 'cgg'; readonly priority = 10;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('https://api-v2.cenguigui.cn/api/netease/music_v1.php', {
          params: { id: raw.id, type: 'json', level: q }, timeout: 5000,
        });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── xunjinlu (priority 11) — apikey + 深层嵌套 JSON ──
export class XunjinluAdapter implements AudioApiAdapter {
  readonly name = 'xunjinlu'; readonly priority = 11;
  private keys = ['charlespikachuc2tfNzQzMjk5ZmNhZGUyNDliMmU1ODYzOGQzODRjYWJkYmQ=', 'charlespikachuc2tfMTIxMDAzNTM5NGI2ZThkNDVkNDNmNDdiZjNhNmYyMzI='];
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      const k = Buffer.from(this.keys[0].substring(14), 'base64').toString('utf-8');
      try {
        const resp = await axios.get('https://api.xunjinlu.fun/apis/wymusic', {
          params: { action: 'song', id: raw.id, key: k, level: q }, timeout: 5000,
        });
        // 深层嵌套: data.data.url.url
        const url: string = resp.data?.data?.data?.url?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── vincentzyu233 (priority 13) ──
export class Vincentzyu233Adapter implements AudioApiAdapter {
  readonly name = 'vincentzyu233'; readonly priority = 13;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`http://xwl.vincentzyu233.cn:51217/v2/music/netease`, {
        params: { id: raw.id, quality: '9' }, timeout: 5000,
      });
      const url: string = resp.data?.data?.url;
      if (!url || !url.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch { return null; }
  }
}

// ── jfjt (priority 14) ── POST form
export class JfjtAdapter implements AudioApiAdapter {
  readonly name = 'jfjt'; readonly priority = 14;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const params = new URLSearchParams({ url: raw.id, level: q, type: 'json' });
        const resp = await axios.post('https://dm.jfjt.cc/Song_V1', params, {
          headers: { 'User-Agent': randomUA(), Referer: 'https://dm.jfjt.cc/'  }, timeout: 5000,
        });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── lblb (priority 15) ── POST form
export class LblbAdapter implements AudioApiAdapter {
  readonly name = 'lblb'; readonly priority = 15;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const params = new URLSearchParams({ url: raw.id, level: q, type: 'json' });
        const resp = await axios.post('https://music163.lblb.eu/Song_V1', params, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── cunyu (priority 16) ──
export class CunyuAdapter implements AudioApiAdapter {
  readonly name = 'cunyu'; readonly priority = 16;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('https://www.cunyuapi.top/163music_play', {
          params: { id: raw.id, quality: q }, timeout: 5000,
        });
        const url: string = resp.data?.song_file_url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── qjqq (priority 17) ── POST form
export class QjqqAdapter implements AudioApiAdapter {
  readonly name = 'qjqq'; readonly priority = 17;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const params = new URLSearchParams({ url: raw.id, level: q, type: 'json' });
        const resp = await axios.post('https://metings.qjqq.cn/Song_V1', params, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── yutangxiaowu (priority 18) ── GET, URL 在顶层
export class YutangxiaowuAdapter implements AudioApiAdapter {
  readonly name = 'yutangxiaowu'; readonly priority = 18;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('https://yutangxiaowu.cn:4000/Song_V1', {
          params: { url: raw.id, level: q, type: 'json' }, timeout: 5000,
        });
        const url: string = resp.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── xiaot (priority 19) ──
export class XiaotAdapter implements AudioApiAdapter {
  readonly name = 'xiaot'; readonly priority = 19;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get('https://api.s0o1.com/API/wyy_music/', {
        params: { id: raw.id, yz: '7' }, timeout: 5000,
      });
      const url: string = resp.data?.data?.url;
      if (!url || !url.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch { return null; }
  }
}

// ── gdstudio (priority 20) ──
export class GdstudioNeAdapter implements AudioApiAdapter {
  readonly name = 'gdstudio'; readonly priority = 20;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get('https://music-api.gdstudio.xyz/api.php', {
        params: { types: 'url', id: raw.id, source: 'netease', br: '999' }, timeout: 5000,
      });
      const url: string = resp.data?.url;
      if (!url || !url.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch { return null; }
  }
}

// ── ceseet (priority 22) ──
export class CeseetNeAdapter implements AudioApiAdapter {
  readonly name = 'ceseet'; readonly priority = 22;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get(`https://m-api.ceseet.me/url/wy/${raw.id}/hires`, {
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'lx-music-request/2.6.0', 'X-Request-Key': '' },
        timeout: 5000,
      });
      const url: string = resp.data?.data;
      if (!url || !url.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch { return null; }
  }
}

// ── manshuo (priority 23) ── POST form
export class ManshuoAdapter implements AudioApiAdapter {
  readonly name = 'manshuo'; readonly priority = 23;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const params = new URLSearchParams({ url: raw.id, level: q, type: 'json' });
        const resp = await axios.post('https://api.manshuo.ink/wyy/Song_V1', params, { headers: { 'User-Agent': randomUA() }, timeout: 5000 });
        const url: string = resp.data?.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── nanorocky (priority 24) ── 直连 URL（musicdl: audio_link_tester.test 验证可达性）
export class NanorockyAdapter implements AudioApiAdapter {
  readonly name = 'nanorocky'; readonly priority = 24;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const url = `https://metingapi.nanorocky.top/?server=netease&type=url&id=${raw.id}&br=2000`;
    try {
      // musicdl 用 audio_link_tester.test 实际请求验证 URL 是否可达
      const resp = await axios.get(url, {
        timeout: 5000,
        maxRedirects: 5,
        responseType: 'stream',
        // 只取第一个 chunk 验证可达性
        headers: { 'User-Agent': randomUA(), Range: 'bytes=0-0'  },
      });
      if (resp.status < 400) return { url, type: 'flac' };
    } catch {
      // HEAD/range 可能不支持，fallback 到直接返回 URL
      return { url, type: 'flac' };
    }
    return null;
  }
}

// ── xcvts (priority 25) ── apikey
export class XcvtsNeAdapter implements AudioApiAdapter {
  readonly name = 'xcvts'; readonly priority = 25;
  private keys = ['charlespikachuZTA5NDg3ZjVlYjNiZjJmYjIzODQyMDRlNjI3OTYyMWI=', 'charlespikachuMTQ5NThjZGYxOTVlZDc2ODY1YWRhNDM4NzZjMzcxNGM='];
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const k = Buffer.from(this.keys[0].substring(14), 'base64').toString('utf-8');
    try {
      const resp = await axios.get('https://api.xcvts.cn/api/music/163music', {
        params: { apiKey: k, id: raw.id, br: '999000' }, timeout: 5000,
      });
      const url: string = resp.data?.data?.music;
      if (!url || !url.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch { return null; }
  }
}

// ── xianyuw (priority 26) ── apikey
export class XianyuwNeAdapter implements AudioApiAdapter {
  readonly name = 'xianyuw'; readonly priority = 26;
  private key = Buffer.from('charlespikachuc2stODRiMzc5N2Y5MTg0ODFmZGE0ZDkxMWMwZjYzYjc0MzE='.substring(14), 'base64').toString('utf-8');
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get('https://apii.xianyuw.cn/api/v1/163-music-search', {
        params: { id: raw.id, key: this.key, no_url: '0', br: 'hires' }, timeout: 5000,
      });
      const url: string = resp.data?.data?.url;
      if (!url || !url.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch { return null; }
  }
}

// ── cyrui (priority 28) ── 两步调用
export class CyruiAdapter implements AudioApiAdapter {
  readonly name = 'cyrui'; readonly priority = 28;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('https://blog.cyrui.cn/netease/api/getMusicUrl.php', {
          params: { id: raw.id, level: q }, timeout: 5000,
        });
        const url: string = resp.data?.data?.[0]?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}

// ── tmetu (priority 29) ──
export class TmetuAdapter implements AudioApiAdapter {
  readonly name = 'tmetu'; readonly priority = 29;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of QS) {
      try {
        const resp = await axios.get('https://www.tmetu.cn/api/music/api.php', {
          params: { miss: 'songAll', id: raw.id, level: q, withLyric: 'true' }, timeout: 5000,
        });
        const url: string = resp.data?.data?.audioUrl;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: qualityFormat(q) };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}
