/**
 * QQ音乐歌单解析
 * 调用 QQ CGI API → 立即返回歌名/歌手
 * 播放/下载时才按需通过第三方 API 解析音频
 */
import axios from 'axios';
import { MusicItem } from '@/types/music';
import { PlaylistResult } from './index';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Referer: 'https://y.qq.com/',
};

function extractPlaylistId(url: string): string {
  const params = new URL(url).searchParams;
  const id = params.get('id') || params.get('disstid');
  if (id) return id;
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\/playlist\/(\d+)/);
  if (match) return match[1];
  throw new Error('无法从链接中提取歌单 ID');
}

export async function parseQQPlaylist(url: string): Promise<PlaylistResult> {
  const playlistId = extractPlaylistId(url);

  const resp = await axios.get(
    'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg',
    {
      params: { disstid: playlistId, type: '1', json: '1', utf8: '1', onlysong: '0', format: 'json' },
      headers: HEADERS,
      timeout: 15000,
    }
  );

  const cdlist = resp.data?.cdlist;
  if (!cdlist || !cdlist[0]) throw new Error('获取歌单信息失败');
  const cd = cdlist[0];
  const songlist = cd.songlist || cd.list || [];

  // 歌单封面
  const playlistCover = cd.logo as string | undefined;

  // id 存平台原生 mid，播放时通过 AudioResolver（13 个适配器链）解析音频
  const items: MusicItem[] = songlist.map((song: Record<string, unknown>) => {
    const singers = (song.singer as Array<{ name: string }>) || [];
    const artist = singers.map(s => s.name).join(' / ') || (song.singername as string) || '';
    const title = (song.songname || song.title || '') as string;
    const songmid = (song.songmid as string) || '';
    const albummid = song.albummid as string | undefined;
    const songCover = albummid
      ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`
      : playlistCover;
    return {
      id: `qq:${songmid}`,
      title: title || '未知歌曲',
      artist: artist || '未知歌手',
      album: (song.albumname as string) || (song.album as string) || '',
      cover: songCover,
      provider: 'jianbin-qq',
      extra: { id: songmid, title, artist, source: 'qq' },
    };
  });

  return {
    info: {
      name: (cd.dissname || `歌单 ${playlistId}`) as string,
      trackCount: items.length,
      cover: cd.logo as string | undefined,
    },
    items,
  };
}
