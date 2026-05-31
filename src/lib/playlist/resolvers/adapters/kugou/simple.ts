/**
 * 酷狗适配器 — 对照 musicdl 源码
 */
import axios from 'axios';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';
import { randomUA } from '../../../utils';

const E = (url: string) => url.split('?')[0].split('.').pop() || 'mp3';

export class Kg317akAdapter implements AudioApiAdapter {
  readonly name = '317ak'; readonly priority = 1;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const ckey = Buffer.from('charlespikachuWE1VS0lBSjNQOExQWDNQOTcxS1U='.substring(14), 'base64').toString('utf-8');
    for (const br of ['6','5','4','3','2','1']) {
      try {
        const resp = await axios.get(
          `https://api.317ak.cn/api/yinyue/kugou?ckey=${ckey}&i=${raw.id}&br=${br}&type=json&lrc=1`,
          { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' }, timeout: 5000 }
        );
        const url: string = resp.data?.url;
        if (url?.startsWith('http')) return { url, type: E(url) };
      } catch {}
    }
    return null;
  }
}

export class LiuyunidcKgAdapter implements AudioApiAdapter {
  readonly name = 'liuyunidc'; readonly priority = 2;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of ['clear','atmos','flac24bit','flac','320k','128k']) {
      try {
        const resp = await axios.get(
          `http://api.liuyunidc.cn/baimusic/musicurl.php?source=kg&musicId=${raw.id}&quality=${q}`,
          { headers: { 'User-Agent': randomUA(), Referer: 'http://api.liuyunidc.cn/baimusic/', Host: 'api.liuyunidc.cn' }, timeout: 5000 }
        );
        const url: string = resp.data?.url;
        if (url?.startsWith('http')) return { url, type: E(url) };
      } catch {}
    }
    return null;
  }
}

export class HaitangwKgAdapter implements AudioApiAdapter {
  readonly name = 'haitangw'; readonly priority = 3;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of ['hires','lossless','exhigh']) {
      for (const base of ['https://musicapi.haitangw.net', 'https://music.haitangw.cc']) {
        try {
          const resp = await axios.get(`${base}/kgqq/kg.php?type=json&id=${raw.id}&level=${q}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' },
            timeout: 5000,
          });
          const url: string = resp.data?.data?.url;
          if (!url?.startsWith('http')) continue;
          const e = E(url);
          if (e.startsWith('m')) continue;
          return { url, type: e };
        } catch {}
      }
    }
    return null;
  }
}

export class CggKgAdapter implements AudioApiAdapter {
  readonly name = 'cgg'; readonly priority = 4;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of ['lossless','exhigh','standard']) {
      try {
        const resp = await axios.get(`https://music-api2.cenguigui.cn/?kg=&id=${raw.id}&type=song&format=json&level=${q}`, {
          headers: { 'User-Agent': randomUA() }, timeout: 5000,
        });
        const url: string = resp.data?.data?.url;
        if (!url?.startsWith('http')) continue;
        const e = E(url);
        if (e.startsWith('m')) continue;
        return { url, type: e };
      } catch {}
    }
    return null;
  }
}

export class JbsouKgAdapter implements AudioApiAdapter {
  readonly name = 'jbsou'; readonly priority = 5;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    // jbsou 不支持 kugou 按 hash 搜，改用歌名搜索
    const keyword = raw.artist && raw.title ? `${raw.artist} ${raw.title}` : raw.title;
    if (!keyword) return null;

    try {
      const params = new URLSearchParams({ input: keyword, filter: 'name', type: 'kugou', page: '1' });
      const resp = await axios.post('https://www.jbsou.cn/', params, {
        headers: {
          'User-Agent': randomUA(),
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Origin: 'https://www.jbsou.cn', Referer: 'https://www.jbsou.cn/',
          'X-Requested-With': 'XMLHttpRequest',
        }, timeout: 5000,
      });
      const apiUrl = resp.data?.data?.[0]?.url;
      if (!apiUrl) return null;
      const fullUrl = apiUrl.startsWith('http') ? apiUrl : `https://www.jbsou.cn/${apiUrl}`;

      // 解析 api.php 重定向到真实 CDN URL，避免 extractExt 返回 'php'
      try {
        const headResp = await axios.head(fullUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 5000, maxRedirects: 5,
          validateStatus: () => true,
        });
        const finalUrl = headResp.request?.res?.responseUrl || fullUrl;
        return { url: finalUrl, type: E(finalUrl) };
      } catch {
        return { url: fullUrl, type: 'mp3' };
      }
    } catch { return null; }
  }
}
