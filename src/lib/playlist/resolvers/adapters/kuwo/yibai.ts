/**
 * yibai — musicdl 自定义 MD5-like 签名 + AES-GCM 解密
 */
import axios from 'axios';
import crypto from 'crypto';
import { AudioApiAdapter } from '../../index';
import { RawTrackData, PlayInfo } from '../../../types';
import { randomUA } from '../../../utils';

const MASK = 0xFFFFFFFF;
const u32 = (x: number) => x >>> 0;
const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
const INIT = [0x79696261, 0x39343232, 0x34796962, 0x61693934];
const SHIFTS = [16,21,26,31,16,21,26,31,16,21,26,31,16,21,26,31,9,13,18,24,9,13,18,24,9,13,18,24,9,13,18,24,6,13,18,25,6,13,18,25,6,13,18,25,6,13,18,25,8,12,17,23,8,12,17,23,8,12,17,23,8,12,17,23];
const CONSTANTS = Array.from({length:64}, (_,i) => u32((Math.floor(Math.abs(Math.sin(i+1)) * 0x100000000)) ^ 0x94224));

function yibaiSign(data: string): string {
  const bytes = Buffer.from(data, 'utf-8');
  const bitLen = bytes.length * 8;
  // padding: bytearray 追加 0x80 → 补零到 len%64==56 → 追加 8 字节 bitLen (LE)
  const arr: number[] = [...bytes, 0x80];
  while (arr.length % 64 !== 56) arr.push(0);
  for (let i = 0; i < 8; i++) arr.push((bitLen >>> (i * 8)) & 0xFF);
  const padded = Buffer.from(arr);
  
  let [a,b,c,d] = INIT;
  for (let off = 0; off < padded.length; off += 64) {
    const block = padded.subarray(off, off+64);
    const words = new Uint32Array(16);
    for (let i=0; i<16; i++) words[i] = block.readUInt32LE(i*4);
    let [aa,bb,cc,dd] = [a,b,c,d];
    for (let i=0; i<64; i++) {
      let f: number, g: number;
      if (i<16) { f = (bb & cc) | ((~bb) & dd); g = i; }
      else if (i<32) { f = (bb & dd) | (cc & (~dd)); g = (5*i+1) % 16; }
      else if (i<48) { f = bb ^ cc ^ dd; g = (3*i+5) % 16; }
      else { f = cc ^ (bb | (~dd)); g = (7*i) % 16; }
      const val = u32(aa + f + words[g] + CONSTANTS[i]);
      aa = dd; dd = cc; cc = bb; bb = u32(bb + rotl(val, SHIFTS[i]));
    }
    a = u32(a + aa); b = u32(b + bb); c = u32(c + cc); d = u32(d + dd);
  }
  const buf = Buffer.alloc(16);
  buf.writeUInt32LE(a,0); buf.writeUInt32LE(b,4); buf.writeUInt32LE(c,8); buf.writeUInt32LE(d,12);
  return buf.toString('hex');
}

function yibaiDecrypt(enc: string): string | null {
  try {
    // musicdl: base64.urlsafe_b64decode(enc + padding)
    const pad = (4 - enc.length % 4) % 4;
    const raw = Buffer.from(enc + '='.repeat(pad), 'base64url');
    if (raw.length < 32) return null;
    // musicdl: AESGCM(key).decrypt(nonce=raw[:16], data=raw[32:]+raw[16:32])
    // layout: nonce[16] + tag[16] + ciphertext
    const nonce = raw.subarray(0, 16);
    const tag = raw.subarray(16, 32);
    const ct = raw.subarray(32);
    const key = Buffer.from('kwdecyibainb66666666666666666666');
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf-8');
  } catch { return null; }
}

export class YibaiAdapter implements AudioApiAdapter {
  readonly name = 'yibai'; readonly priority = 2;
  async resolve(raw: RawTrackData): Promise<PlayInfo | null> {
    for (const q of ['master','atmos_plus','atmos','flac','320k']) {
      try {
        const sign = yibaiSign(`id=${raw.id}&q=${q}`);
        const resp = await axios.get(`http://kwdecf.yibai.us/kwurl?id=${raw.id}&q=${q}&sign=${sign}`, {
          headers: {
            accept: '*/*', 'accept-encoding': 'gzip, deflate',
            'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            origin: 'http://api.liuyunidc.cn', host: 'kwdecf.yibai.us',
            referer: 'http://api.liuyunidc.cn/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
          },
          timeout: 5000,
        });
        const enc = resp.data?.url;
        if (!enc) continue;
        const url = yibaiDecrypt(enc);
        if (url?.startsWith('http')) return { url, type: url.split('?')[0].split('.').pop() || 'flac' };
      } catch {}
    }
    return null;
  }
}
