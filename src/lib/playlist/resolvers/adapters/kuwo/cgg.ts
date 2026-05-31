/**
 * cgg — GET kw-api.cenguigui.cn
 * 简单 GET（先试 curl_cffi，失败则普通 GET；此处只实现普通 GET）
 */
import axios from 'axios';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';

export class CggKuwoAdapter implements AudioApiAdapter {
  readonly name = 'cgg';
  readonly priority = 3;

  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    try {
      const resp = await axios.get('https://kw-api.cenguigui.cn/', {
        params: { id: raw.id, type: 'song', level: 'lossless', format: 'json' },
        timeout: 5000,
      });
      const url: string = resp.data?.data?.url;
      if (!url || !url.startsWith('http')) return null;
      return { url, type: 'flac' };
    } catch {
      return null;
    }
  }
}
