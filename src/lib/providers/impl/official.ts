/**
 * 官方聚合搜索 Provider
 * 搜索时并发查询四平台，前端按标签页展示分平台结果
 * 播放/下载时走 adapter chain + 跨平台兜底 + jianbin 兜底
 * 切平台顺序：netease > qq > kuwo > kugou > jianbin
 */
import axios from 'axios';
import { MusicItem, MusicProvider, PlayInfo } from '@/types/music';
import { searchAll, SearchAllResult } from '@/lib/search/cross-platform';
import { searchNetease } from '@/lib/search/official-netease';
import { searchQQ } from '@/lib/search/official-qq';
import { searchKuwo } from '@/lib/search/official-kuwo';
import { searchKugou } from '@/lib/search/official-kugou';
import { enrichWithLyric } from '@/lib/playlist/lyric-service';

const JBSOU_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Origin: 'https://www.jbsou.cn',
  Referer: 'https://www.jbsou.cn/',
  'X-Requested-With': 'XMLHttpRequest',
};

/** 模块级存储，供 API 路由读取分平台结果 */
let lastPlatformResults: Record<string, MusicItem[]> = {};
export function getLastPlatformResults() { return lastPlatformResults; }

export class OfficialSearchProvider implements MusicProvider {
  name = 'official';

  async search(query: string): Promise<MusicItem[]> {
    const result = await searchAll(query, 30);
    lastPlatformResults = result.byPlatform;

    // 扁平化：网易在前，QQ/酷我/酷狗交替排列
    const flat: MusicItem[] = [];
    const keys = ['netease', 'qq', 'kuwo', 'kugou'];
    const arrays = keys.map(k => result.byPlatform[k] || []);
    let row = 0;
    while (flat.length < 120) {
      let added = false;
      for (let i = 0; i < arrays.length; i++) {
        if (row < arrays[i].length) {
          flat.push(arrays[i][row]);
          added = true;
          if (flat.length >= 120) break;
        }
      }
      if (!added) break;
      row++;
    }
    return flat;
  }

  async getPlayInfo(id: string, extra?: unknown): Promise<PlayInfo> {
    const ex = extra as Record<string, any> | undefined;
    const details: Record<string, { id: string; title?: string; artist?: string }> = ex?.details || ex || {};
    const platformMatch = id.match(/^(netease|qq|kugou|kuwo):/);

    if (platformMatch) {
      return this.resolveWithFallback(
        platformMatch[1],
        id.split(':')[1],
        details,
      );
    }
    throw new Error('Invalid official id');
  }

  /** 解析单平台 → adapter chain → 精确搜索切平台 → jianbin 兜底 */
  private async resolveWithFallback(
    platform: string,
    songId: string,
    details: Record<string, { id: string; title?: string; artist?: string }>,
  ): Promise<PlayInfo> {
    const allPlatforms = ['netease', 'qq', 'kuwo', 'kugou'] as const;
    const ordered = [platform as string, ...allPlatforms.filter(p => p !== platform)];

    // 主平台信息
    const primary = details[platform];
    const title = primary?.title || '';
    const artist = primary?.artist || '';

    // 第一轮：每个平台尝试解析
    for (const p of ordered) {
      let targetId: string | undefined;

      if (p === platform) {
        // 主平台：直接用原始 ID
        targetId = songId;
      } else {
        // 切平台：在目标平台精确搜索同名同歌手，取第一条严格匹配的 ID
        targetId = await this.searchExactMatch(p, title, artist);
      }

      if (!targetId) continue;

      const result = await this.tryAdapterChain(p, targetId, title, artist);
      if (result) {
        return await enrichWithLyric(p, targetId, title, artist, '', result);
      }
    }

    // 第二轮：全局 jianbin 兜底（跳过主平台，适配器链已试过）
    if (title && artist) {
      const keyword = `${artist} ${title}`;
      for (const p of ordered.slice(1)) {
        const result = await this.tryJianbin(keyword, p, artist);
        if (result) {
          // jianbin 自带歌词，优先保留；否则用 lyric-service 补充
          return await enrichWithLyric(p, '', title, artist, '', result);
        }
      }
    }

    throw new Error(`All platforms exhausted for ${platform}:${songId}`);
  }

  /** 在目标平台精确搜索，取同名同歌手的第一条 ID */
  private async searchExactMatch(p: string, title: string, artist: string): Promise<string | undefined> {
    if (!title || !artist) return undefined;
    try {
      const searchFn = p === 'netease' ? searchNetease : p === 'qq' ? searchQQ : p === 'kuwo' ? searchKuwo : p === 'kugou' ? searchKugou : undefined;
      if (!searchFn) return undefined;

      const results = await searchFn(`${artist} ${title}`, 10);
      const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      const normTitle = norm(title);
      const normArtist = norm(artist.split('/')[0].trim());

      // 1. 严格匹配：歌名 + 第一歌手完全相同
      let match = results.find(r =>
        norm(r.title) === normTitle &&
        norm(r.artist.split('/')[0].trim()) === normArtist
      );
      if (match) {
        return match.id.split(':')[1] || match.id;
      }

      // 2. 纯歌名兜底（网易云歌单 API 返回的歌手名可能含冗余字符）
      const titleOnly = await searchFn(title, 10);
      match = titleOnly.find(r =>
        norm(r.title) === normTitle &&
        norm(r.artist.split('/')[0].trim()) === normArtist
      );
      if (match) {
        return match.id.split(':')[1] || match.id;
      }
    } catch {}
    return undefined;
  }

  /** 单平台适配器链（排除死名单，复用 resolver） */
  private async tryAdapterChain(
    p: string,
    targetId: string,
    title: string,
    artist: string,
  ): Promise<PlayInfo | null> {
    try {
      const { getLiveResolver } = await import('@/lib/playlist/resolvers');
      const resolver = getLiveResolver(p as any);
      return await resolver.resolve({ id: targetId, title, artist, raw: {} });
    } catch {
      return null;
    }
  }

  /** jianbin 兜底（歌手校验） */
  private async tryJianbin(keyword: string, type: string, expectedArtist?: string): Promise<PlayInfo | null> {
    try {
      const resp = await axios.post('https://www.jbsou.cn/',
        new URLSearchParams({ input: keyword, filter: 'name', type, page: '1' }),
        { headers: JBSOU_HEADERS, timeout: 8000 },
      );
      const item = resp.data?.data?.[0];
      if (!item?.url) return null;

      // 校验歌手名至少部分匹配，防止返回完全不相关的歌
      if (expectedArtist && item.artist) {
        const en = expectedArtist.replace(/\s+/g, '').toLowerCase();
        const gn = item.artist.replace(/\s+/g, '').toLowerCase();
        // 任一包含对方
        if (!gn.includes(en) && !en.includes(gn)) return null;
      }

      const apiUrl = item.url.startsWith('http') ? item.url : `https://www.jbsou.cn/${item.url}`;
      const headResp = await axios.head(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000, maxRedirects: 5, validateStatus: () => true,
      });
      const finalUrl = headResp.request?.res?.responseUrl || apiUrl;
      if (!finalUrl.startsWith('http')) return null;

      let lyric: string | undefined;
      if (item.lrc) {
        try {
          const lrcUrl = item.lrc.startsWith('http') ? item.lrc : `https://www.jbsou.cn/${item.lrc}`;
          const lrcResp = await axios.get(lrcUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
          if (typeof lrcResp.data === 'string') lyric = lrcResp.data;
        } catch {}
      }

      const ext = finalUrl.split('?')[0].split('.').pop() || 'mp3';
      return { url: finalUrl, type: ext, lyric };
    } catch {
      return null;
    }
  }
}
