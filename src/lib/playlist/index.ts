/**
 * 歌单解析模块
 * 核心流程：URL → 平台识别 → 提取歌单ID → 调用平台API → 返回 MusicItem[]
 * 播放/下载时才按需通过第三方 API 解析
 */
import { MusicItem } from '@/types/music';
import { parseNeteasePlaylist } from './netease';
import { parseQQPlaylist } from './qq';
import { parseKuwoPlaylist } from './kuwo';
import { parseKugouPlaylist } from './kugou';

export interface PlaylistInfo {
  name: string;
  trackCount: number;
  cover?: string;
}

export interface PlaylistResult {
  info: PlaylistInfo;
  items: MusicItem[];
}

const PLATFORM_DETECTORS: { suffix: string; parser: (url: string) => Promise<PlaylistResult> }[] = [
  { suffix: '163.com', parser: parseNeteasePlaylist },
  { suffix: 'qq.com',   parser: parseQQPlaylist },
  { suffix: 'kuwo.cn',  parser: parseKuwoPlaylist },
  { suffix: 'kugou.com',parser: parseKugouPlaylist },
];

export async function parsePlaylist(url: string): Promise<PlaylistResult> {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error('无效的 URL 格式');
  }

  for (const detector of PLATFORM_DETECTORS) {
    if (!hostname.endsWith(detector.suffix)) continue;
    try {
      const result = await detector.parser(url);
      if (result.items.length > 0) return result;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error('不支持该平台的歌单链接');
}
