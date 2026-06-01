/**
 * 跨平台搜索
 * 并发搜索网易云+QQ+酷我+酷狗，返回分平台结果供标签页展示
 */
import { MusicItem } from '@/types/music';
import { searchNetease } from './official-netease';
import { searchQQ } from './official-qq';
import { searchKuwo } from './official-kuwo';
import { searchKugou } from './official-kugou';

export interface SearchAllResult {
  /** 分平台原始搜索结果 */
  byPlatform: Record<string, MusicItem[]>;
  /** 所有结果总数（供前端计数） */
  totalCount: number;
}

/** 并发搜索四平台，不合并，直接返回分平台结果 */
export async function searchAll(query: string, limit = 30): Promise<SearchAllResult> {
  const [neteaseResults, qqResults, kuwoResults, kugouResults] = await Promise.all([
    searchNetease(query, limit).catch(() => [] as MusicItem[]),
    searchQQ(query, limit).catch(() => [] as MusicItem[]),
    searchKuwo(query, limit).catch(() => [] as MusicItem[]),
    searchKugou(query, limit).catch(() => [] as MusicItem[]),
  ]);

  // 给每个结果打上 platform 标记，供播放时切平台使用
  const tagPlatform = (items: MusicItem[], p: string) =>
    items.map(item => ({
      ...item,
      provider: 'official' as const,
      extra: {
        ...(item.extra as Record<string, unknown> || {}),
        platform: p,
        details: { [p]: { id: item.id.split(':')[1] || item.id, title: item.title, artist: item.artist } },
        platforms: [p],
        _source: 'official' as const,
      },
    }));

  return {
    byPlatform: {
      netease: tagPlatform(neteaseResults, 'netease'),
      qq: tagPlatform(qqResults, 'qq'),
      kuwo: tagPlatform(kuwoResults, 'kuwo'),
      kugou: tagPlatform(kugouResults, 'kugou'),
    },
    totalCount: neteaseResults.length + qqResults.length + kuwoResults.length + kugouResults.length,
  };
}
