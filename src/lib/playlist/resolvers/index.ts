import { AudioApiAdapter, AudioResolver, Platform, RawTrackData, PlayInfo } from '../types';

import axios from 'axios';

import { loadPriorityConfig, loadDeadListFor } from '../adapter-config';

// ── 构建函数 ──

function buildResolverFromList(platform: Platform, adapters: AudioApiAdapter[], fastSkip: boolean = false): AudioResolver {
  return {
    platform,
    async resolve(raw: RawTrackData): Promise<PlayInfo> {
      const BATCH = 5;
      for (let i = 0; i < adapters.length; i += BATCH) {
        const batch = adapters.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(a => a.resolve(raw).then(r => (r?.url ? r : null)).catch(() => null))
        );
        for (const r of results) {
          if (!r) continue;
          try {
            const resp = await axios.head(r.url, { timeout: 3000, maxRedirects: 3, validateStatus: () => true });
            const ct = (resp.headers['content-type'] || '').toLowerCase();
            if (resp.status < 400 || ct.includes('audio') || ct.includes('octet-stream')) return r;
          } catch { }
        }
        // 一批全是 null → 平台无版权，快跳
        if (fastSkip && results.every(r => r === null)) break;
      }
      throw new Error(`All ${adapters.length} APIs failed for track ${raw.id} on ${platform}`);
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

/** 获取指定平台的 AudioResolver（含配置覆盖优先级） */
export function getResolver(platform: Platform): AudioResolver {
  const list = getPlatformList(platform);
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

/** 构建排除死名单的解析器（播放用，启用快跳） */
export function getLiveResolver(platform: Platform): AudioResolver {
  const dead = loadDeadListFor(platform);
  const list = getPlatformList(platform).filter(a => !dead.includes(a.name));
  const config = loadPriorityConfig();
  const order = config[platform];
  let sorted = [...list];
  if (order?.length) {
    const om = new Map(order.map((n, i) => [n, i]));
    sorted.sort((a, b) => (om.get(a.name) ?? 999) - (om.get(b.name) ?? 999));
  }
  return buildResolverFromList(platform, sorted, true);
}

/** 获取排除死名单后的适配器 */
export function getLiveAdapters(platform: Platform): AudioApiAdapter[] {
  const { loadDeadListFor } = require('@/lib/playlist/adapter-config');
  const dead = loadDeadListFor(platform);
  return getPlatformList(platform).filter(a => !dead.includes(a.name));
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
