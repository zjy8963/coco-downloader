import { PlayInfo } from '@/types/music';
export type { PlayInfo };

// ── 歌单解析层 ──

/** 歌单元信息 */
export interface PlaylistInfo {
  name: string;
  trackCount: number;
  cover?: string;
  platform: Platform;
}

export type Platform = 'netease' | 'qq' | 'kugou' | 'kuwo';

/** 平台原生歌曲标识（官方 API 返回 + AudioResolver 的入参） */
export interface RawTrackData {
  /** 唯一标识符：网易云=songId, QQ=mid, 酷狗=hash, 酷我=musicrid（去掉 MUSIC_ 前缀） */
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: string;
  /** 完整原始字段，透传给需要额外信息的适配器（如 name 搜索类 API） */
  raw: Record<string, unknown>;
}

/** 歌单中的单首歌曲（前端展示用，不包含音频 URL） */
export interface PlaylistTrack {
  id: string; // "platform_raw:netease:123456"
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  duration?: string;
  provider: string; // "jianbin-netease" 等，复用现有播放链路
  extra?: RawTrackData; // 平台原生数据，音频解析时回传给 /api/playlist/resolve
}

/** 歌单解析完整结果 */
export interface PlaylistResult {
  info: PlaylistInfo;
  tracks: PlaylistTrack[];
}

// ── 音频解析层（Resolver）──

/** 单个第三方 API 适配器 */
export interface AudioApiAdapter {
  readonly name: string;
  readonly priority: number;
  /** 传入平台原生数据，返回音频 PlayInfo 或 null（表示该 API 失败，试下一个） */
  resolve(raw: RawTrackData): Promise<PlayInfo | null>;
}

/** 平台音频解析器（聚合同平台所有适配器） */
export interface AudioResolver {
  readonly platform: Platform;
  resolve(raw: RawTrackData): Promise<PlayInfo>;
}

/** /api/playlist/resolve 请求体 */
export interface ResolveRequest {
  platform: Platform;
  rawData: RawTrackData;
}

/** /api/playlist/resolve 响应体 */
export interface ResolveResponse {
  url: string;
  type: string;
  cover?: string;
}
