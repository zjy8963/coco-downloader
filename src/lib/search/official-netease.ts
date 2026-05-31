/**
 * 网易云音乐官方搜索
 * API: https://music.163.com/api/cloudsearch/pc
 */
import axios from 'axios';
import { MusicItem } from '@/types/music';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://music.163.com/',
};

export async function searchNetease(query: string, limit = 30): Promise<MusicItem[]> {
  try {
    const resp = await axios.post(
      'https://music.163.com/api/cloudsearch/pc',
      new URLSearchParams({ s: query, type: '1', limit: String(limit), offset: '0' }).toString(),
      { headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 },
    );
    const songs = resp.data?.result?.songs || [];
    return songs.map((s: any) => ({
      id: `netease:${s.id}`,
      title: s.name || '未知歌曲',
      artist: (s.ar || []).map((a: any) => a.name).join(' / ') || '未知歌手',
      album: s.al?.name || undefined,
      cover: s.al?.picUrl || undefined,
      duration: s.dt ? String(Math.round(s.dt / 1000)) : undefined,
      provider: 'official-netease',
      extra: {
        songId: s.id,
        platform: 'netease',
        // 原始数据中的其他平台 ID（用于跨平台匹配）
        alia: s.alia || [],
        tns: s.tns || [],
      },
    }));
  } catch (err) {
    console.error('Netease search error:', err);
    return [];
  }
}
