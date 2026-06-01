import { MusicItem } from "./music";

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error';

export interface DownloadTask {
  id: string; // unique task id (e.g. musicId + timestamp)
  musicItem: MusicItem;
  status: DownloadStatus;
  progress: number; // 0 to 100
  fileName: string;
  error?: string;
  startTime: number;
  finishedTime?: number; // 完成或失败的时间戳，用于按完成时间倒排
}
