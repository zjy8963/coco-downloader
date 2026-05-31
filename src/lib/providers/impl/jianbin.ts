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

    for (const p of ordered) {
      // 确定当前平台的歌曲 ID
      let targetSongId: string | undefined;
      if (p === platform) {
        targetSongId = songId; // 主平台用原始 ID
      } else if (keyword) {
        // 切平台：在目标平台精确搜索同名同歌手
        targetSongId = await this.searchExactInPlatform(p, title, artist);
      }

      if (!targetSongId) {
        // 没 ID 就跳过适配器链，直接走 jianbin 兜底
        if (keyword) {
          try {
            const result = await this.jianbinSearch(keyword, p);
            if (result) {
              const jbsouArtist = (result as any)._artist || '';
              if (jbsouArtist && artist) {
                const an = artist.replace(/\s+/g, '').toLowerCase();
                const jn = jbsouArtist.replace(/\s+/g, '').toLowerCase();
                if (!jn.includes(an) && !an.includes(jn)) continue;
              }
              return await enrichWithLyric(p, songId, title, artist, album, result);
            }
          } catch {}
        }
        continue;
      }

      // A. 该平台的适配器链
      try {
        if (useLB) {
          const { resolveWithLB } = await import('@/lib/adapter-lb');
          const { getAllAdapters } = await import('@/lib/playlist/resolvers');
          const result = await resolveWithLB(
            p as 'netease' | 'qq' | 'kugou' | 'kuwo',
            { id: targetSongId, title, artist, album, raw: ex || {} },
            getAllAdapters(p as 'netease' | 'qq' | 'kugou' | 'kuwo'),
          );
          return await enrichWithLyric(p, targetSongId, title, artist, album, result);
        } else {
          const { getLiveResolver } = await import('@/lib/playlist/resolvers');
          const resolver = getLiveResolver(p as 'netease' | 'qq' | 'kugou' | 'kuwo');
          const result = await resolver.resolve({ id: targetSongId, title, artist, album, raw: ex || {} });
          return await enrichWithLyric(p, targetSongId, title, artist, album, result);
        }
      } catch {}

      // B. 该平台的 jianbin 兜底
      if (keyword) {
        try {
          const result = await this.jianbinSearch(keyword, p);
          if (result) {
            const jbsouArtist = (result as any)._artist || '';
            if (jbsouArtist && artist) {
              const an = artist.replace(/\s+/g, '').toLowerCase();
              const jn = jbsouArtist.replace(/\s+/g, '').toLowerCase();
              if (!jn.includes(an) && !an.includes(jn)) continue;
            }
            return await enrichWithLyric(p, targetSongId || songId, title, artist, album, result);
          }
        } catch {}
      }
    }

    throw new Error(`All platforms exhausted for ${platform}:${id.split(':')[1]}`);
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

      const results = await searchFn(`${artist} ${title}`, 5);
      const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
      const match = results.find(r =>
        norm(r.title) === norm(title) &&
        norm(r.artist.split('/')[0].trim()) === norm(artist.split('/')[0].trim())
      );
      if (match) return match.id.split(':')[1] || match.id;
    } catch {}
    return undefined;
  }
}
