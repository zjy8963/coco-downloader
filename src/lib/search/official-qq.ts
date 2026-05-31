/**
 * QQ音乐官方搜索
 * API: https://u.y.qq.com/cgi-bin/musicu.fcg
 */
import axios from 'axios';
import { MusicItem } from '@/types/music';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com/',
};

export async function searchQQ(query: string, limit = 30): Promise<MusicItem[]> {
  try {
    const body = {
      search: {
        method: 'DoSearchForQQMusicDesktop',
        module: 'music.search.SearchCgiService',
        param: {
          query,
          num_per_page: limit,
          page_num: 1,
          search_type: 0, // 0 = 单曲
        },
      },
    };
    const resp = await axios.post('https://u.y.qq.com/cgi-bin/musicu.fcg', body, {
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    const songs = resp.data?.search?.data?.body?.song?.list || [];
    return songs.map((s: any) => {
      const singerNames = (s.singer || []).map((si: any) => si.name).join(' / ');
      return {
        id: `qq:${s.mid}`,
        title: s.name || s.title || '未知歌曲',
        artist: singerNames || '未知歌手',
        album: s.album?.name || s.album?.title || undefined,
        cover: s.album?.pmid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${s.album.pmid}.jpg`
          : undefined,
        duration: s.interval ? String(s.interval) : undefined,
        provider: 'official-qq',
        extra: {
          songId: s.id,
          mid: s.mid,
          platform: 'qq',
        },
      };
    });
  } catch (err) {
    console.error('QQ search error:', err);
    return [];
  }
}
