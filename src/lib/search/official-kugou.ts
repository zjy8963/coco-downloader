/**
 * 酷狗音乐官方搜索
 * API: http://mobilecdn.kugou.com/api/v3/search/song
 */
import axios from 'axios';
import { MusicItem } from '@/types/music';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://www.kugou.com/',
};

/** 酷狗文件名格式：歌手 - 歌名[备注] */
function parseFilename(filename: string): { title: string; artist: string } {
  const clean = filename.replace(/【.*?】/g, '').replace(/\[.*?\]/g, '').trim();
  const idx = clean.indexOf(' - ');
  if (idx > 0) {
    return {
      artist: clean.substring(0, idx).trim().replace(/、/g, ' / '),
      title: clean.substring(idx + 3).trim(),
    };
  }
  return { title: clean || '未知歌曲', artist: '未知歌手' };
}

export async function searchKugou(query: string, limit = 30): Promise<MusicItem[]> {
  try {
    const resp = await axios.get(
      'http://mobilecdn.kugou.com/api/v3/search/song',
      {
        params: {
          format: 'json',
          keyword: query,
          page: 1,
          pagesize: limit,
          showtype: 1,
        },
        headers: HEADERS,
        timeout: 10000,
      },
    );
    const info = resp.data?.data?.info || [];
    return info.map((s: any) => {
      const { title, artist } = parseFilename(s.filename || '');
      return {
        id: `kugou:${s.hash}`,
        title,
        artist: s.singername?.replace(/、/g, ' / ') || artist,
        album: s.album_name || undefined,
        cover: (() => {
          // union_cover 是带 {size} 占位符的模板，替换后即真实封面 URL
          const tpl = s.trans_param?.union_cover;
          if (typeof tpl === 'string' && tpl.startsWith('http')) {
            return tpl.replace('{size}', '240');
          }
          return undefined;
        })(),
        duration: s.duration ? String(s.duration) : undefined,
        provider: 'official-kugou',
        extra: {
          hash: s.hash,
          platform: 'kugou',
        },
      };
    });
  } catch (err) {
    console.error('Kugou search error:', err);
    return [];
  }
}
