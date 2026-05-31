/**
 * 网易云音乐歌单解析
 * POST v6 拿全部 trackIds → GET v3 批量拿歌名 → 立即返回
 * 播放/下载时才按需通过第三方 API 解析音频
 */
import axios from 'axios';
import { MusicItem } from '@/types/music';
import { PlaylistResult } from './index';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://music.163.com/',
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 限流重试：code:-447 递增延时 */
async function postWithRetry(url: string, data: Record<string, unknown>, maxRetries = 3): Promise<unknown> {
  for (let i = 0; i < maxRetries; i++) {
    const resp = await axios.post(url, new URLSearchParams(data as Record<string, string>).toString(), {
      headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    if (resp.data?.code === -447) {
      if (i < maxRetries - 1) { await delay(1000 * (i + 1)); continue; }
      throw new Error('网易云服务器繁忙，请稍后重试');
    }
    return resp.data;
  }
}

/** 批量获取歌曲详情（每批 400 首） */
async function fetchSongDetails(songIds: number[]): Promise<Map<number, { name: string; artists: string; album: string; cover: string }>> {
  const result = new Map<number, { name: string; artists: string; album: string; cover: string }>();
  const batchSize = 400;
  for (let i = 0; i < songIds.length; i += batchSize) {
    const batch = songIds.slice(i, i + batchSize);
    const cParam = '[' + batch.map(id => `{"id":${id}}`).join(',') + ']';
    try {
      const resp = await axios.get('https://music.163.com/api/v3/song/detail', {
        params: { c: cParam }, headers: HEADERS, timeout: 15000,
      });
      for (const song of resp.data?.songs || []) {
        result.set(song.id, {
          name: song.name || '未知歌曲',
          artists: (song.ar || []).map((a: { name: string }) => a.name).join(' / ') || '未知歌手',
          album: song.al?.name || '',
          cover: song.al?.picUrl || '',
        });
      }
    } catch { continue; }
  }
  return result;
}

/** 从 URL 提取歌单 ID（支持 web + hash 路由） */
function extractPlaylistId(url: string): string {
  const hashIndex = url.indexOf('#/');
  if (hashIndex !== -1) {
    const fragment = url.substring(hashIndex);
    const fakeUrl = 'https://music.163.com' + fragment.replace('#/', '/');
    const id = new URL(fakeUrl).searchParams.get('id');
    if (id) return id;
  }
  const params = new URL(url).searchParams;
  const queryId = params.get('id');
  if (queryId) return queryId;
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\/playlist\/(\d+)/);
  if (match) return match[1];
  throw new Error('无法从链接中提取歌单 ID');
}

export async function parseNeteasePlaylist(url: string): Promise<PlaylistResult> {
  const playlistId = extractPlaylistId(url);

  // 1. POST v6 → 全部 trackIds
  const data = await postWithRetry('https://music.163.com/api/v6/playlist/detail', { id: playlistId }) as {
    playlist?: Record<string, unknown>;
  };
  const playlist = data.playlist;
  if (!playlist) throw new Error('获取歌单信息失败');

  const trackIds: Array<{ id: number }> = (playlist.trackIds as Array<{ id: number }>) || [];
  if (trackIds.length === 0) throw new Error('歌单为空');

  // 2. GET v3 → 批量拿歌名歌手
  const songIds = trackIds.map(t => t.id);
  const details = await fetchSongDetails(songIds);

  // id 存平台原生标识符，播放时通过 AudioResolver（57 个适配器链）解析音频
  const items: MusicItem[] = songIds.map(sid => {
    const d = details.get(sid);
    return {
      id: `netease:${sid}`,
      title: d?.name || `歌曲 #${sid}`,
      artist: d?.artists || '加载失败',
      album: d?.album,
      cover: d?.cover || (playlist.coverImgUrl as string) || undefined,
      provider: 'jianbin-netease',
      extra: { songId: sid, title: d?.name, artist: d?.artists, source: 'netease' },
    };
  });

  return {
    info: {
      name: (playlist.name || `歌单 ${playlistId}`) as string,
      trackCount: items.length,
      cover: playlist.coverImgUrl as string | undefined,
    },
    items,
  };
}
