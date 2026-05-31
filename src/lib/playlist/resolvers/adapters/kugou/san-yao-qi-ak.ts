/**
 * 酷狗 317ak — ckey 解密 + hash 直传
 */
import axios from 'axios';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';

// base64.decode(str[14:]) → 'charlespikachu' + real_key
const ENCODED_KEY = 'charlespikachuWE1VS0lBSjNQOExQWDNQOTcxS1U=';
const CKKEY = Buffer.from(ENCODED_KEY.substring(14), 'base64').toString('utf-8');

export class Kg317akAdapter implements AudioApiAdapter {
  readonly name = '317ak';
  readonly priority = 1;
  private brs = ['6', '5', '4', '3', '2', '1'];

  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const br of this.brs) {
      try {
        const resp = await axios.get('https://api.317ak.cn/api/yinyue/kugou', {
          params: {
            ckey: CKKEY,
            i: raw.id,
            br,
            type: 'json',
            lrc: '1',
          },
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36',
          },
          timeout: 5000,
        });
        const url: string = resp.data?.url;
        if (!url || !url.startsWith('http')) continue;
        return { url, type: 'mp3' };
      } catch { /* 下一音质 */ }
    }
    return null;
  }
}
