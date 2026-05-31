/**
 * 酷我音乐官方搜索
 * API: http://search.kuwo.cn/r.s
 * 使用 itemset=web_2013&newsearch=1 匹配官网排序
 */
import axios from 'axios';
import { MusicItem } from '@/types/music';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'http://www.kuwo.cn/',
};

/** 清理 HTML 实体和多余空白 */
function cleanText(s: string): string {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kuwo 返回单引号 JSON，需转标准 JSON 再解析 */
function parseKuwoJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      return {};
    }
  }
}

export async function searchKuwo(query: string, limit = 30): Promise<MusicItem[]> {
  try {
    const resp = await axios.get('http://search.kuwo.cn/r.s', {
      params: {
        all: query,
        pn: 0,
        rn: limit,
        ft: 'music',
        // 桌面客户端参数（strategy=2012 排序接近官网，原版优先）
        client: 'kt',
        uid: '794762570',
        ver: 'kwplayer_ar_9.2.2.1',
        vipver: '1',
        show_copyright_off: '1',
        newver: '1',
        cluster: '0',
        strategy: '2012',
        vermerge: '1',
        mobi: '1',
        issubtitle: '1',
        rformat: 'json',
        encoding: 'utf8',
      },
      headers: { ...HEADERS },
      timeout: 10000,
    });
    const data = typeof resp.data === 'string' ? parseKuwoJson(resp.data) : resp.data;
    const list = data?.abslist || [];
    return list.map((s: any) => {
      // 封面：专辑封面优先，歌手图兜底
      let cover: string | undefined;
      const alb = s.web_albumpic_short;
      const art = s.web_artistpic_short;
      if (alb) {
        cover = `https://img4.kuwo.cn/star/albumcover/${alb.replace('120', '500')}`;
      } else if (art) {
        cover = `https://img1.kuwo.cn/star/starheads/${art.replace('120', '500')}`;
      }
      return {
      id: `kuwo:${String(s.MUSICRID || '').replace('MUSIC_', '')}`,
      title: cleanText(s.SONGNAME || s.NAME || '未知歌曲'),
      artist: cleanText(s.ARTIST || '未知歌手'),
      album: cleanText(s.ALBUM || ''),
      cover,
      duration: s.DURATION ? String(s.DURATION) : undefined,
      provider: 'official-kuwo' as const,
      extra: {
        musicrid: s.MUSICRID,
        platform: 'kuwo',
      },
      };
    });
  } catch (err) {
    console.error('Kuwo search error:', err);
    return [];
  }
}
