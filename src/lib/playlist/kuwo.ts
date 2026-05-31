/**
 * 酷我音乐歌单解析
 * 移动端 WAPI 分页获取曲目 → 立即返回
 * 播放/下载时才按需通过第三方 API 解析音频
 */
import axios from 'axios';
import { MusicItem } from '@/types/music';
import { PlaylistResult } from './index';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://m.kuwo.cn/',
};

function extractPlaylistId(url: string): string {
  const params = new URL(url).searchParams;
  const id = params.get('id') || params.get('pid');
  if (id) return id;
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\/playlist(?:_detail)?\/(\d+)/);
  if (match) return match[1];
  throw new Error('无法从链接中提取歌单 ID');
}

export async function parseKuwoPlaylist(url: string): Promise<PlaylistResult> {
  const playlistId = extractPlaylistId(url);

  const allTracks: Array<Record<string, unknown>> = [];
  let page = 1;
  let playlistName = `歌单 ${playlistId}`;

  while (true) {
    try {
      const resp = await axios.get('https://m.kuwo.cn/newh5app/wapi/api/www/playlist/playListInfo', {
        params: { pid: playlistId, pn: page, rn: 100 },
        headers: HEADERS,
        timeout: 15000,
      });
      const data = resp.data?.data;
      if (!data) break;
      const musicList = data.musicList || [];
      if (musicList.length === 0) break;
      allTracks.push(...musicList);
      if (page === 1 && data.name) playlistName = data.name as string;
      if (Number(data.total || 0) <= allTracks.length) break;
      page++;
    } catch { break; }
  }

  // 去重
  const seen = new Set<string>();
  const uniqueTracks = allTracks.filter(t => {
    const rid = t.musicrid as string;
    if (!rid || seen.has(rid)) return false;
    seen.add(rid);
    return true;
  });

  // 歌单封面用第一首歌的图
  const playlistImg = (allTracks[0] as Record<string, unknown>)?.pic as string | undefined;

  // id 存 musicrid，播放时通过 AudioResolver（10 个适配器链）解析音频
  const items: MusicItem[] = uniqueTracks.map(track => {
    const musicrid = (track.musicrid as string || '').replace('MUSIC_', '');
    const title = (track.name || track.songname || '未知歌曲') as string;
    const artist = (track.artist || track.author || '未知歌手') as string;
    return {
      id: `kuwo:${musicrid}`,
      title,
      artist,
      album: (track.album || '') as string,
      cover: (track.pic || track.albumpic || track.pic120) as string | undefined,
      provider: 'jianbin-kuwo',
      extra: { id: musicrid, title, artist, source: 'kuwo' },
    };
  });

  return {
    info: { name: playlistName, trackCount: items.length, cover: playlistImg },
    items,
  };
}
