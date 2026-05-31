/**
 * ccwu — 直连下载 URL
 * URL 本身就是音频链接，无需解析 JSON
 */
import axios from 'axios';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';
import { extractExt } from '../../../utils';

export class CcwuAdapter implements AudioApiAdapter {
  readonly name = 'ccwu';
  readonly priority = 1;

  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    const url = `http://kw.006lp.ccwu.cc:7119/api/song?id=${raw.id}&level=jymaster&stream=1`;
    try {
      // URL 本身就是下载链接，用 HEAD 验证可达性
      const resp = await axios.head(url, { timeout: 5000, maxRedirects: 5 });
      if (resp.status < 400) {
        return { url, type: 'mp3' };
      }
    } catch {
      return null;
    }
    return null;
  }
}
