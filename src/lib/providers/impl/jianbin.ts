import axios from 'axios';
import { MusicItem, MusicProvider, PlayInfo } from '@/types/music';

const BASE_URL = 'https://www.jbsou.cn/';
const REQUEST_TIMEOUT = 30000;

const SEARCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
  'accept': 'application/json, text/javascript, */*; q=0.01',
  'accept-encoding': 'gzip, deflate, br, zstd',
  'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'origin': 'https://www.jbsou.cn',
  'x-requested-with': 'XMLHttpRequest',
  'referer': 'https://www.jbsou.cn/',
};

type JbsouSearchItem = {
  songid?: string | number;
  name?: string;
  artist?: string;
  album?: string;
  url?: string;
  lrc?: string;
  cover?: string;
};

type JbsouSearchResponse = {
  data?: JbsouSearchItem[];
};

function toAbsoluteUrl(value?: string) {
  if (!value) return '';
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return value;
  }
}

function extractExt(url: string) {
  const clean = url.split('?')[0];
  const parts = clean.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'mp3';
}

function normalizeSearchResponse(payload: unknown): JbsouSearchResponse {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as JbsouSearchResponse;
    } catch {
      return {};
    }
  }
  return payload as JbsouSearchResponse;
}

function getResponseUrl(response: unknown) {
  const request = response as { request?: { res?: { responseUrl?: string } } };
  const resUrl = request?.request?.res?.responseUrl;
  if (typeof resUrl === 'string' && resUrl.startsWith('http')) return resUrl;
  const config = response as { config?: { url?: string } };
  const configUrl = config?.config?.url;
  return typeof configUrl === 'string' ? configUrl : '';
}

async function resolveFinalUrl(url: string) {
  try {
    const response = await axios.head(url, {
      headers: {
        'user-agent': SEARCH_HEADERS['user-agent'],
      },
      timeout: REQUEST_TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,  // CDN HEAD 可能返回 403，不抛异常
    });
    const resolved = getResponseUrl(response);
    return resolved && resolved.startsWith('http') ? resolved : url;
  } catch {
    return url;
  }
}

function normalizeIdToUrl(id: string) {
  const value = (id || '').trim();
  if (!value) return '';
  const decodedOnce = value.includes('%') ? safeDecode(value) : value;
  const decoded = decodedOnce.includes('%') ? safeDecode(decodedOnce) : decodedOnce;
  if (decoded.startsWith('http')) return decoded;
  return toAbsoluteUrl(decoded);
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export class JianbinProvider implements MusicProvider {
  name: string;
  private source: string;

  constructor(name: string, source: string) {
    this.name = name;
    this.source = source;
  }

  async search(query: string): Promise<MusicItem[]> {
    try {
      const params = new URLSearchParams({
        input: query,
        filter: 'name',
        type: this.source,
        page: '1',
      });
      const { data } = await axios.post<JbsouSearchResponse>(BASE_URL, params, {
        headers: SEARCH_HEADERS,
        timeout: REQUEST_TIMEOUT,
      });
      const list = normalizeSearchResponse(data)?.data || [];
      return list
        .map((item) => {
          const downloadUrl = toAbsoluteUrl(item?.url);
          const coverUrl = toAbsoluteUrl(item?.cover);
          return {
            id: downloadUrl ? encodeURIComponent(downloadUrl) : '',
            title: item?.name || '未知歌曲',
            artist: item?.artist || '未知歌手',
            album: item?.album || undefined,
            cover: coverUrl || undefined,
            provider: this.name,
            extra: { lrc: item?.lrc || undefined },
          };
        })
        .filter((item) => item.id);
    } catch (error) {
      console.error('Jianbin search error:', error);
      return [];
    }
  }

  async getPlayInfo(id: string, extra?: unknown): Promise<PlayInfo> {
    // 检测 netease: / qq: / kugou: / kuwo: 前缀 → 调用 AudioResolver
    const platformMatch = id.match(/^(netease|qq|kugou|kuwo):/);
    if (platformMatch) {
      return this.resolveViaAdapters(platformMatch[1] as string, id, extra);
    }

    try {
      const url = normalizeIdToUrl(id);
      if (!url) throw new Error('Invalid id');
      const finalUrl = await resolveFinalUrl(url);
      if (!finalUrl.startsWith('http')) throw new Error('Invalid play url');
      return {
        url: finalUrl,
        type: extractExt(finalUrl),
      };
    } catch (error) {
      console.error('Jianbin getPlayInfo error:', error);
      throw error;
    }
  }

  /** 三级兜底：本平台适配器 → jianbin → 下一平台适配器 → jianbin → ... */
  private async resolveViaAdapters(platform: string, id: string, extra?: unknown): Promise<PlayInfo> {
    const ex = extra as Record<string, unknown> | undefined;
    const title = (ex?.title as string) || '';
    const artist = (ex?.artist as string) || '';
    const album = (ex?.album as string) || '';
    const keyword = title ? (artist ? `${artist} ${title}` : title) : '';
    const songId = id.split(':')[1];
    const { enrichWithLyric } = await import('@/lib/playlist/lyric-service');

    // 平台优先级：当前平台最先，其余按 netease > qq > kuwo > kugou
    const allPlatforms = ['netease', 'qq', 'kuwo', 'kugou'] as const;
    const ordered = [platform, ...allPlatforms.filter(p => p !== platform)];

    // 下载路径用 LB 单源轮转，播放路径保持 batch=5 并行
    const useLB = !!ex?._lb;

    // ── 第一轮：各平台适配器链 ──
    console.log(`[切平台] 歌曲: ${artist} - ${title}  主平台: ${platform}`);
    for (const p of ordered) {
      let targetSongId: string | undefined;
      if (p === platform) {
        targetSongId = songId;
        console.log(`[切平台]   ${p}: 主平台原始ID=${songId}`);
      } else if (keyword) {
        targetSongId = await this.searchExactInPlatform(p, title, artist);
        console.log(`[切平台]   ${p}: 精确搜索 keyword="${title} ${artist}" → ${targetSongId || '未找到'}`);
      }

      if (!targetSongId) {
        console.log(`[切平台]   ${p}: 跳过（无ID）`);
        continue;
      }

      try {
        if (useLB) {
          const { resolveWithLB } = await import('@/lib/adapter-lb');
          const { getAllAdapters } = await import('@/lib/playlist/resolvers');
          const result = await resolveWithLB(
            p as 'netease' | 'qq' | 'kugou' | 'kuwo',
            { id: targetSongId, title, artist, album, raw: ex || {} },
            getAllAdapters(p as 'netease' | 'qq' | 'kugou' | 'kuwo'),
          );
          console.log(`[切平台]   ${p}: LB解析成功 url=${result.url.substring(0,60)}...`);
          return await enrichWithLyric(p, targetSongId, title, artist, album, result);
        } else {
          const { getResolver } = await import('@/lib/playlist/resolvers');
          const resolver = getResolver(p as 'netease' | 'qq' | 'kugou' | 'kuwo');
          const result = await resolver.resolve({ id: targetSongId, title, artist, album, raw: ex || {} });
          console.log(`[切平台]   ${p}: 解析成功 url=${result.url.substring(0,60)}...`);
          return await enrichWithLyric(p, targetSongId, title, artist, album, result);
        }
      } catch (e) {
        console.log(`[切平台]   ${p}: 适配器链失败`);
      }
    }

    // ── 第二轮：jianbin 兜底（仅非主平台），严格匹配 → 宽松匹配 → 失败 ──
    if (keyword) {
      console.log(`[切平台] 进入 jianbin 兜底...`);
      for (const p of ordered.slice(1)) {
        const result = await this.jianbinSmartMatch(keyword, p, title, artist);
        if (result) {
          const jbsouArtist = (result as any)._artist || '';
          console.log(`[切平台]   jianbin-${p}: 命中 artist="${jbsouArtist}" url=${result.url.substring(0,60)}...`);
          return await enrichWithLyric(p, songId, title, artist, album, result);
        }
        console.log(`[切平台]   jianbin-${p}: 未命中`);
      }
    }

    console.log(`[切平台] ❌ 全部失败`);

    throw new Error(`All platforms exhausted for ${platform}:${id.split(':')[1]}`);
  }

  /** jianbin 智能匹配：从搜索结果中找严格匹配 → 宽松匹配 → 失败 */
  private async jianbinSmartMatch(
    keyword: string, type: string, title: string, artist: string,
  ): Promise<PlayInfo | null> {
    try {
      const params = new URLSearchParams({ input: keyword, filter: 'name', type, page: '1' });
      const { data } = await axios.post<JbsouSearchResponse>(BASE_URL, params, {
        headers: SEARCH_HEADERS, timeout: REQUEST_TIMEOUT,
      });
      const list = normalizeSearchResponse(data)?.data || [];
      console.log(`[jianbin] type=${type} keyword="${keyword}" → ${list.length}条结果`);
      if (list.length === 0) return null;

      const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      const nt = norm(title);
      const na = norm(artist.split('/')[0].trim());

      // 1. 严格匹配
      const strictMatch = list.find((item: JbsouSearchItem) => {
        const it = norm(item.name || '');
        const ia = norm((item.artist || '').split('/')[0].trim());
        return it === nt && ia === na;
      });
      if (strictMatch) {
        console.log(`[jianbin] ✅ 严格匹配: ${strictMatch.artist} - ${strictMatch.name}`);
        return await this.buildJianbinResult(strictMatch);
      }

      // 2. 宽松匹配
      const looseMatch = list.find((item: JbsouSearchItem) => {
        const combined = norm((item.name || '') + (item.artist || ''));
        return combined.includes(nt) && combined.includes(na);
      });
      if (looseMatch) {
        console.log(`[jianbin] ⚠️ 宽松匹配: ${looseMatch.artist} - ${looseMatch.name}`);
        return await this.buildJianbinResult(looseMatch);
      }

      console.log(`[jianbin] ❌ 未匹配到 (nt="${nt}" na="${na}")`);
      for (const item of list.slice(0, 3)) {
        console.log(`[jianbin]   候选: ${item.artist} - ${item.name}`);
      }
      return null;
    } catch (e) {
      console.log(`[jianbin] 请求失败: ${e}`);
      return null;
    }
  }

  /** 构建 jianbin 结果（含歌词） */
  private async buildJianbinResult(item: JbsouSearchItem): Promise<PlayInfo | null> {
    const downloadUrl = toAbsoluteUrl(item?.url);
    if (!downloadUrl) return null;
    const finalUrl = await resolveFinalUrl(downloadUrl);
    if (!finalUrl.startsWith('http')) return null;

    const result: PlayInfo = { url: finalUrl, type: extractExt(finalUrl) } as any;
    (result as any)._artist = item?.artist || '';

    if (item?.lrc) {
      const lrcUrl = toAbsoluteUrl(item.lrc);
      if (lrcUrl) {
        try {
          const lrcResp = await axios.get(lrcUrl, {
            headers: { 'user-agent': SEARCH_HEADERS['user-agent'] }, timeout: 5000,
          });
          if (typeof lrcResp.data === 'string' && lrcResp.data.length > 10) {
            result.lyric = lrcResp.data;
          }
        } catch {}
      }
    }
    return result;
  }

  /** jianbin 关键词搜索 → 获取第一条结果的播放 URL（含歌词） */
  private async jianbinSearch(keyword: string, type: string): Promise<PlayInfo | null> {
    const params = new URLSearchParams({ input: keyword, filter: 'name', type, page: '1' });
    const { data } = await axios.post<JbsouSearchResponse>(BASE_URL, params, {
      headers: SEARCH_HEADERS,
      timeout: REQUEST_TIMEOUT,
    });
    const list = normalizeSearchResponse(data)?.data || [];
    if (list.length === 0) return null;
    const item = list[0];
    const downloadUrl = toAbsoluteUrl(item?.url);
    if (!downloadUrl) return null;
    const finalUrl = await resolveFinalUrl(downloadUrl);
    if (!finalUrl.startsWith('http')) return null;

    const result: PlayInfo = { url: finalUrl, type: extractExt(finalUrl) } as any;
    // 附带 jbsou 返回的歌手名，供外部校验
    (result as any)._artist = item?.artist || '';

    // jbsou 自带歌词链接
    if (item?.lrc) {
      const lrcUrl = toAbsoluteUrl(item.lrc);
      if (lrcUrl) {
        try {
          const lrcResp = await axios.get(lrcUrl, {
            headers: { 'user-agent': SEARCH_HEADERS['user-agent'] },
            timeout: 5000,
          });
          if (typeof lrcResp.data === 'string' && lrcResp.data.length > 10) {
            result.lyric = lrcResp.data;
          }
        } catch {}
      }
    }

    return result;
  }

  /** 在目标平台精确搜索同名同歌手，返回歌曲 ID */
  private async searchExactInPlatform(p: string, title: string, artist: string): Promise<string | undefined> {
    if (!title || !artist) return undefined;
    try {
      const { searchNetease } = await import('@/lib/search/official-netease');
      const { searchQQ } = await import('@/lib/search/official-qq');
      const { searchKuwo } = await import('@/lib/search/official-kuwo');
      const { searchKugou } = await import('@/lib/search/official-kugou');
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
      if (match) return match.id.split(':')[1] || match.id;

      // 2. 歌手+歌名搜索失败时，用纯歌名兜底（处理网易云返回的冗余字符）
      //    在纯歌名结果中再做严格匹配，不会误匹配
      const titleOnly = await searchFn(title, 10);
      match = titleOnly.find(r =>
        norm(r.title) === normTitle &&
        norm(r.artist.split('/')[0].trim()) === normArtist
      );
      if (match) return match.id.split(':')[1] || match.id;
    } catch {}
    return undefined;
  }
}
