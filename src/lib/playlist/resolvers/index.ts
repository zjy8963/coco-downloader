import { AudioApiAdapter, AudioResolver, Platform, RawTrackData, PlayInfo } from '../types';

import axios from 'axios';

import { loadPriorityConfig, loadExcludedListFor } from '../adapter-config';

// ── 音频魔数校验：Range GET 前 512 字节，防止假 URL 通过 HEAD 校验 ──
// 若 Range 请求本身失败（CDN 不支持），则放行不误杀
const AUDIO_MAGIC: Array<{ offset: number; bytes: number[] }> = [
  // MP3 / MPEG
  { offset: 0, bytes: [0xFF, 0xFB] },
  { offset: 0, bytes: [0xFF, 0xFA] },
  { offset: 0, bytes: [0xFF, 0xF3] },
  { offset: 0, bytes: [0xFF, 0xF2] },
  // ID3 tag (MP3 常见容器)
  { offset: 0, bytes: [0x49, 0x44, 0x33] },
  // FLAC
  { offset: 0, bytes: [0x66, 0x4C, 0x61, 0x43] },
  // OGG / Opus
  { offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53] },
  // RIFF (WAV)
  { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  // ADTS AAC
  { offset: 0, bytes: [0xFF, 0xF1] },
  { offset: 0, bytes: [0xFF, 0xF9] },
  // M4A / MP4 (ftyp，偏移 4 或 0 均有可能)
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  { offset: 0, bytes: [0x66, 0x74, 0x79, 0x70] },
  // APE (Monkey's Audio)
  { offset: 0, bytes: [0x4D, 0x41, 0x43, 0x20] },
  // WMA / ASF
  { offset: 0, bytes: [0x30, 0x26, 0xB2, 0x75] },
  // QMC 加密格式（QQ音乐加密，虽不能直接播但说明源有效）
  { offset: 0, bytes: [0x51, 0x4D, 0x43, 0x31] },
  { offset: 0, bytes: [0x51, 0x4D, 0x43, 0x30] },
  // KGM 加密格式（酷狗加密）
  { offset: 0, bytes: [0x7C, 0xD5, 0x32, 0x76] },
];

/** 判断字节数组是否看起来像可显示文本（而非二进制音频） */
function looksLikeText(buf: Buffer): boolean {
  let printable = 0;
  const sample = buf.subarray(0, Math.min(64, buf.length));
  for (const b of sample) {
    // 可打印 ASCII (32-126) 或常见空白
    if ((b >= 0x20 && b <= 0x7E) || b === 0x09 || b === 0x0A || b === 0x0D) {
      printable++;
    }
  }
  // 超过 85% 可打印字符 → 像文本/HTML
  return printable / sample.length > 0.85;
}

export async function verifyAudioBytes(url: string): Promise<boolean> {
  try {
    const resp = await axios.get(url, {
      headers: { Range: 'bytes=0-511' },
      timeout: 3000,
      maxRedirects: 3,
      responseType: 'arraybuffer',
      validateStatus: (s) => s === 206 || s === 200,
    });

    // CDN 不支持 Range（416/403/其他）：放行，避免误杀
    if (resp.status !== 206 && resp.status !== 200) return true;

    // 拿到全量文件（CDN 忽略 Range）：只读前 512 字节
    const raw = Buffer.from(resp.data);
    const buf = raw.length > 512 ? raw.subarray(0, 512) : raw;
    if (buf.length < 16) return false;

    // HTML/文本检测（严格：开头是 < 空格 换行）
    if (buf[0] === 0x3C || buf[0] === 0x20 || buf[0] === 0x0A || buf[0] === 0x0D) return false;

    // 检测已知音频魔数
    for (const magic of AUDIO_MAGIC) {
      if (magic.offset + magic.bytes.length > buf.length) continue;
      let match = true;
      for (let i = 0; i < magic.bytes.length; i++) {
        if (buf[magic.offset + i] !== magic.bytes[i]) { match = false; break; }
      }
      if (match) return true;
    }

    // 未匹配任何魔数，但不像是文本 → 放行（可能是不常见的音频格式）
    return !looksLikeText(buf);
  } catch {
    // Range 请求网络失败：放行，不阻塞
    return true;
  }
}

// ── 构建函数 ──

function buildResolverFromList(platform: Platform, adapters: AudioApiAdapter[], fastSkip: boolean = false): AudioResolver {
  return {
    platform,
    async resolve(raw: RawTrackData): Promise<PlayInfo> {
      const BATCH = 5;

      for (let i = 0; i < adapters.length; i += BATCH) {
        const batch = adapters.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(a => a.resolve(raw).then(r => (r?.url ? { ...r, _adapter: a.name } : null)).catch(() => null))
        );

        // 先找有效 URL
        for (const r of results) {
          if (!r) continue;
          try {
            const resp = await axios.head(r.url, { timeout: 1500, maxRedirects: 2, validateStatus: () => true });
            const ct = (resp.headers['content-type'] || '').toLowerCase();
            if (!(resp.status < 400 || ct.includes('audio') || ct.includes('octet-stream'))) continue;

            // HEAD 通过后，Range GET 前 512 字节验证魔数，防假 URL
            const valid = await verifyAudioBytes(r.url);
            if (!valid) continue;

            console.log(`[适配器] ${platform}:${raw.id} → ${(r as any)._adapter} 命中 url=${r.url}`);
            return r;
          } catch {}
        }

        // 计算连续 null 个数（从头开始）
        let consecutiveNulls = 0;
        for (const r of results) {
          if (r === null) {
            consecutiveNulls++;
          } else {
            break; // 中间断了就不算连续
          }
        }

        // fastSkip: 1个null就切  |  切平台: 连续3个null才切
        if (fastSkip && consecutiveNulls >= 1) {
          console.log(`[适配器] ${platform}:${raw.id} → 首批null，快跳`);
          break;
        }
        if (!fastSkip && consecutiveNulls >= 3) {
          console.log(`[适配器] ${platform}:${raw.id} → 连续${consecutiveNulls}个null，切平台`);
          break;
        }
      }
      throw new Error(`All adapters failed for track ${raw.id} on ${platform}`);
    },
  };
}

// ── 注册表（按平台分组，每个适配器一行 new XxxAdapter()）──

// 适配器在后续阶段逐个创建，当前注册表为空数组占位
// 增加 API：import + new XxxAdapter() 加入对应数组
// 删除 API：删 import + 删对应行
// 调优先级：改适配器类里的 priority 数值

// ── 酷我适配器 ──
import { YibaiAdapter } from './adapters/kuwo/yibai';
import {
  CcwuAdapter, CggKuwoAdapter, CeseetKuwoAdapter, LxmusicKuwoAdapter,
  GdstudioKuwoAdapter, NxinxzAdapter, HaitangwKuwoAdapter, Yyy001Adapter, GuyueiKuwoAdapter,
} from './adapters/kuwo/simple';

// ── 酷狗适配器 ──
import {
  Kg317akAdapter,
  LiuyunidcKgAdapter,
  HaitangwKgAdapter,
  CggKgAdapter,
  JbsouKgAdapter,
} from './adapters/kugou/simple';

// ── QQ适配器 ──
import {
  LiuyunidcQqAdapter,
  Qq317akAdapter,
  LpzAdapter,
  TangAdapter,
  XianyuwQqAdapter,
  NkiAdapter,
  XunhuisiAdapter,
  CyapiAdapter,
  LxmusicQqAdapter,
  XcvtsQqAdapter,
  VkeysAdapter,
  YgkingAdapter,
  LuoyueAdapter,
} from './adapters/qq/simple';

// ── 网易云适配器 ──
import { LuosuAdapter, Ne317akAdapter, XiaoqinAdapter, ZnnuAdapter, GuyueiNeAdapter, NycnmbyfunsAdapter, RrvennAdapter } from './adapters/netease/complex';
import {
  BugpkAdapter, XingmianAdapter, XuanluogeAdapter, KangqiovoAdapter,
  HaitangwNeAdapter, CggNeAdapter, XunjinluAdapter, Vincentzyu233Adapter,
  JfjtAdapter, LblbAdapter, CunyuAdapter, QjqqAdapter,
  YutangxiaowuAdapter, XiaotAdapter, GdstudioNeAdapter,
  CeseetNeAdapter, ManshuoAdapter, NanorockyAdapter,
  XcvtsNeAdapter, XianyuwNeAdapter, CyruiAdapter, TmetuAdapter,
} from './adapters/netease/simple';

// 原始适配器列表（不排序，供 buildResolver / getAllAdapters 复用）
const neteaseList: AudioApiAdapter[] = [
  new LuosuAdapter(), new Ne317akAdapter(), new XiaoqinAdapter(), new ZnnuAdapter(),
  new BugpkAdapter(), new XingmianAdapter(), new XuanluogeAdapter(), new KangqiovoAdapter(),
  new HaitangwNeAdapter(), new CggNeAdapter(), new XunjinluAdapter(), new GuyueiNeAdapter(),
  new Vincentzyu233Adapter(), new JfjtAdapter(), new LblbAdapter(), new CunyuAdapter(),
  new QjqqAdapter(), new YutangxiaowuAdapter(), new XiaotAdapter(), new GdstudioNeAdapter(),
  new NycnmbyfunsAdapter(), new CeseetNeAdapter(), new ManshuoAdapter(), new NanorockyAdapter(),
  new XcvtsNeAdapter(), new XianyuwNeAdapter(), new RrvennAdapter(), new CyruiAdapter(), new TmetuAdapter(),
];
const qqList: AudioApiAdapter[] = [
  new LiuyunidcQqAdapter(), new Qq317akAdapter(), new LpzAdapter(), new TangAdapter(),
  new XianyuwQqAdapter(), new NkiAdapter(), new XunhuisiAdapter(), new CyapiAdapter(), new LxmusicQqAdapter(),
  new XcvtsQqAdapter(), new VkeysAdapter(), new YgkingAdapter(), new LuoyueAdapter(),
];
const kugouList: AudioApiAdapter[] = [
  new Kg317akAdapter(), new LiuyunidcKgAdapter(), new HaitangwKgAdapter(), new CggKgAdapter(), new JbsouKgAdapter(),
];
const kuwoList: AudioApiAdapter[] = [
  new CcwuAdapter(), new YibaiAdapter(), new CggKuwoAdapter(), new CeseetKuwoAdapter(), new LxmusicKuwoAdapter(),
  new GdstudioKuwoAdapter(), new NxinxzAdapter(), new HaitangwKuwoAdapter(), new Yyy001Adapter(), new GuyueiKuwoAdapter(),
];

const resolvers: Record<Platform, AudioResolver> = {
  netease: buildResolverFromList('netease', neteaseList),
  qq: buildResolverFromList('qq', qqList),
  kugou: buildResolverFromList('kugou', kugouList),
  kuwo: buildResolverFromList('kuwo', kuwoList),
};

/** 获取指定平台的 AudioResolver（含死源+屏蔽源过滤 + 配置优先级，无 fastSkip） */
export function getResolver(platform: Platform): AudioResolver {
  const excluded = loadExcludedListFor(platform);
  const list = getPlatformList(platform).filter(a => !excluded.includes(a.name));
  const config = loadPriorityConfig();
  const order = config[platform];

  let sorted = [...list];
  if (order && order.length > 0) {
    const orderMap = new Map(order.map((name, i) => [name, i]));
    sorted.sort((a, b) => {
      const ai = orderMap.get(a.name) ?? 999;
      const bi = orderMap.get(b.name) ?? 999;
      return ai - bi;
    });
  } else {
    sorted.sort((a, b) => a.priority - b.priority);
  }

  return buildResolverFromList(platform, sorted);
}

/** 获取某平台全部适配器（供测试器遍历） */
export function getAllAdapters(platform: Platform): AudioApiAdapter[] {
  return getPlatformList(platform);
}

/** 构建排除死源+屏蔽源的解析器（播放用，启用快跳） */
export function getLiveResolver(platform: Platform): AudioResolver {
  const excluded = loadExcludedListFor(platform);
  const list = getPlatformList(platform).filter(a => !excluded.includes(a.name));
  const config = loadPriorityConfig();
  const order = config[platform];
  let sorted = [...list];
  if (order?.length) {
    const om = new Map(order.map((n, i) => [n, i]));
    sorted.sort((a, b) => (om.get(a.name) ?? 999) - (om.get(b.name) ?? 999));
  }
  return buildResolverFromList(platform, sorted, true);
}

/** 获取排除死源+屏蔽源后的适配器 */
export function getLiveAdapters(platform: Platform): AudioApiAdapter[] {
  const excluded = loadExcludedListFor(platform);
  return getPlatformList(platform).filter(a => !excluded.includes(a.name));
}

function getPlatformList(platform: Platform): AudioApiAdapter[] {
  switch (platform) {
    case 'netease': return neteaseList;
    case 'qq': return qqList;
    case 'kugou': return kugouList;
    case 'kuwo': return kuwoList;
  }
}

// 重新导出接口，方便适配器文件 import
export type { AudioApiAdapter, AudioResolver };
