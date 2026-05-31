/**
 * 适配器负载均衡器
 * 主池轮转 + 探路替换 + 冷却淘汰
 *
 * 使用方式：
 *   下载路径 → resolveWithLB()  ← 自动管理 select/report/commitSong
 *   测试保存 → lb.reset(platform)
 *   复活检测 → 无需操作（select 实时读 dead list）
 */
import { AudioApiAdapter, Platform, RawTrackData, PlayInfo } from '@/lib/playlist/types';
import { loadPriorityConfig, loadDeadListFor } from '@/lib/playlist/adapter-config';

// ── 内部类型 ──

interface AdapterState {
  name: string;
  avgLatency: number;
  sampleCount: number;
  consecutiveFails: number;
}

interface EvictedState {
  name: string;
  avgLatency: number;
  sampleCount: number;
  cooldownRounds: number;
  cooldownMultiplier: number;
}

interface PlatformState {
  pool: AdapterState[];       // 主池（rotationSize 个轮转位 + 1 个可选探路缓冲位）
  evicted: EvictedState[];
  rotationIndex: number;
  songCount: number;
  rotationSize: number;

  // 上次 select 返回的探路者（用于 report 时判断是否写回池）
  pendingExplorer: { name: string; latency: number } | null;
}

// ── 动态池大小 ──

function calcPoolSize(totalLive: number): { rotationSize: number; explorerSlot: number } {
  if (totalLive <= 2) return { rotationSize: totalLive, explorerSlot: 0 };
  if (totalLive <= 5) return { rotationSize: totalLive - 1, explorerSlot: 1 };
  if (totalLive <= 10) return { rotationSize: Math.max(3, Math.floor(totalLive * 0.6)), explorerSlot: 1 };
  return { rotationSize: Math.min(8, Math.floor(totalLive * 0.4)), explorerSlot: 1 };
}

// ── 工具 ──

function ema(prev: number, current: number, sampleCount: number): number {
  const alpha = 1 / Math.min(sampleCount, 10);
  return prev * (1 - alpha) + current * alpha;
}

// ── 负载均衡器 ──

export class AdapterLoadBalancer {
  private platforms = new Map<Platform, PlatformState>();

  // ── 初始化 ──

  private ensureInit(platform: Platform, allAdapters: AudioApiAdapter[]): PlatformState {
    let state = this.platforms.get(platform);
    if (state) return state;

    const deadList = loadDeadListFor(platform);
    const live = allAdapters.filter(a => !deadList.includes(a.name));

    // 排序：历史 order > static priority
    const config = loadPriorityConfig();
    const order = config[platform] as string[] | undefined;
    if (order?.length) {
      const om = new Map(order.map((n, i) => [n, i]));
      live.sort((a, b) => (om.get(a.name) ?? 999) - (om.get(b.name) ?? 999));
    } else {
      live.sort((a, b) => a.priority - b.priority);
    }

    const { rotationSize, explorerSlot } = calcPoolSize(live.length);
    const poolSize = rotationSize + explorerSlot;

    state = {
      pool: live.slice(0, poolSize).map(a => ({
        name: a.name, avgLatency: 999, sampleCount: 0, consecutiveFails: 0,
      })),
      evicted: [],
      rotationIndex: 0,
      songCount: 0,
      rotationSize,
      pendingExplorer: null,
    };

    this.platforms.set(platform, state);
    return state;
  }

  // ── 选择下一个适配器 ──

  select(platform: Platform, allAdapters: AudioApiAdapter[]): AudioApiAdapter {
    const state = this.ensureInit(platform, allAdapters);
    const live = this.liveAdapters(platform, allAdapters);
    const { rotationSize, explorerSlot } = calcPoolSize(live.length);

    // 同步池：移除已不在 live 中的成员
    const liveNames = new Set(live.map(a => a.name));
    state.pool = state.pool.filter(p => liveNames.has(p.name));
    state.rotationSize = rotationSize;

    // 池不足时补充
    const needed = rotationSize + explorerSlot;
    while (state.pool.length < needed) {
      const inPool = new Set(state.pool.map(p => p.name));
      const next = live.find(a => !inPool.has(a.name));
      if (!next) break;
      state.pool.push({ name: next.name, avgLatency: 999, sampleCount: 0, consecutiveFails: 0 });
    }

    // 探路轮判定
    const isExplorerRound = explorerSlot > 0
      && state.songCount > 0
      && (state.songCount + 1) % (rotationSize + 1) === 0;

    // 如果上次探路者还没被 rebalance 消费，先清理
    if (state.pendingExplorer) {
      state.pendingExplorer = null;
    }

    if (isExplorerRound) {
      const inPool = new Set(state.pool.map(p => p.name));
      const inEvicted = new Set(state.evicted.filter(e => e.cooldownRounds > 0).map(e => e.name));
      const candidates = live.filter(
        a => !inPool.has(a.name) && !inEvicted.has(a.name),
      );
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        return allAdapters.find(a => a.name === pick.name)!;
      }
      // 无候选 → 退化为正常轮转
    }

    // 正常轮转
    if (state.pool.length === 0) {
      // 全空了，从 live 随便拿一个
      return allAdapters.find(a => a.name === live[0]?.name)!;
    }

    const idx = state.rotationIndex % Math.min(rotationSize, state.pool.length);
    state.rotationIndex++;
    const picked = state.pool[idx];
    return allAdapters.find(a => a.name === picked.name)!;
  }

  // ── 上报结果 ──

  report(platform: Platform, name: string, success: boolean, latency: number): void {
    const state = this.platforms.get(platform);
    if (!state) return;

    const member = state.pool.find(p => p.name === name);
    if (!member) return;

    if (success) {
      member.consecutiveFails = 0;
      member.sampleCount++;
      member.avgLatency = ema(member.avgLatency, latency, member.sampleCount);
    } else {
      member.consecutiveFails++;
      if (member.consecutiveFails >= 3) {
        this.kickFromPool(state, member);
      }
    }
  }

  /** 记录探路者延迟（探路者不在池中，需单独记录） */
  reportExplorer(platform: Platform, name: string, latency: number): void {
    const state = this.platforms.get(platform);
    if (!state) return;
    state.pendingExplorer = { name, latency };
  }

  // ── 一首歌结束 ──

  commitSong(platform: Platform, allAdapters: AudioApiAdapter[]): void {
    const state = this.ensureInit(platform, allAdapters);
    state.songCount++;
    this.rebalance(state, allAdapters, platform);
  }

  // ── 从配置重建 ──

  reset(platform: Platform): void {
    this.platforms.delete(platform);
  }

  // ── 私有 ──

  private liveAdapters(platform: Platform, all: AudioApiAdapter[]): AudioApiAdapter[] {
    const dead = loadDeadListFor(platform);
    return all.filter(a => !dead.includes(a.name));
  }

  private kickFromPool(state: PlatformState, member: AdapterState): void {
    state.pool = state.pool.filter(p => p.name !== member.name);
    const existing = state.evicted.find(e => e.name === member.name);
    const mult = existing ? Math.min(existing.cooldownMultiplier * 2, 32) : 1;
    state.evicted = state.evicted.filter(e => e.name !== member.name);
    state.evicted.push({
      name: member.name,
      avgLatency: member.avgLatency,
      sampleCount: member.sampleCount,
      cooldownRounds: 10 * mult,
      cooldownMultiplier: mult,
    });
  }

  private rebalance(state: PlatformState, allAdapters: AudioApiAdapter[], platform: Platform): void {
    const live = this.liveAdapters(platform, allAdapters);
    const { rotationSize, explorerSlot } = calcPoolSize(live.length);

    // 冷却递减
    for (const e of state.evicted) e.cooldownRounds--;
    state.evicted = state.evicted.filter(e => e.cooldownRounds > 0);

    // 池成员过期清理
    const liveNames = new Set(live.map(a => a.name));
    state.pool = state.pool.filter(p => liveNames.has(p.name));

    // 池内按延迟排序
    const main = state.pool.slice(0, rotationSize);
    main.sort((a, b) => a.avgLatency - b.avgLatency);

    // 探路者处理
    const explorer = state.pendingExplorer;
    state.pendingExplorer = null;

    if (explorer && explorerSlot > 0 && main.length > 0) {
      const worst = main[main.length - 1];
      const explorerLatency = explorer.latency;

      // 探路者需有实际样本才能比较
      if (explorerLatency < worst.avgLatency) {
        // 探路者进池替换最差
        const explorerState: AdapterState = {
          name: explorer.name,
          avgLatency: explorerLatency,
          sampleCount: 1,
          consecutiveFails: 0,
        };
        main[main.length - 1] = explorerState;

        // 被替换者进入冷却
        const existingEv = state.evicted.find(e => e.name === worst.name);
        const mult = existingEv ? Math.min(existingEv.cooldownMultiplier * 2, 32) : 1;
        state.evicted = state.evicted.filter(e => e.name !== worst.name);
        state.evicted.push({
          name: worst.name,
          avgLatency: worst.avgLatency,
          sampleCount: worst.sampleCount,
          cooldownRounds: 10 * mult,
          cooldownMultiplier: mult,
        });
      }
    }

    // 补充池成员到满额
    const needed = rotationSize + (explorerSlot > 0 && live.length > rotationSize ? 1 : 0);
    const inPool = new Set(main.map(p => p.name));
    const inEvicted = new Set(state.evicted.filter(e => e.cooldownRounds > 0).map(e => e.name));

    for (const a of live) {
      if (main.length >= needed) break;
      if (!inPool.has(a.name) && !inEvicted.has(a.name)) {
        main.push({ name: a.name, avgLatency: 999, sampleCount: 0, consecutiveFails: 0 });
        inPool.add(a.name);
      }
    }

    state.pool = main;
    state.rotationSize = rotationSize;
    state.rotationIndex = state.songCount % rotationSize;
  }
}

// ── 模块级单例 ──

let instance: AdapterLoadBalancer | null = null;

export function getLoadBalancer(): AdapterLoadBalancer {
  if (!instance) instance = new AdapterLoadBalancer();
  return instance;
}

// ── 高层封装：一次完整的 LB 解析 ──

export async function resolveWithLB(
  platform: Platform,
  raw: RawTrackData,
  allAdapters: AudioApiAdapter[],
): Promise<PlayInfo> {
  const lb = getLoadBalancer();
  const maxTries = Math.min(allAdapters.length, 3);
  const tried = new Set<string>();

  for (let i = 0; i < maxTries; i++) {
    const adapter = lb.select(platform, allAdapters);
    if (tried.has(adapter.name)) continue;
    tried.add(adapter.name);

    const start = Date.now();
    try {
      const result = await adapter.resolve(raw);
      const latency = Date.now() - start;

      if (result?.url) {
        // HEAD 验证：只排除网络不可达，HTTP 4xx/5xx 不阻塞（CDN 常用 403 拒 HEAD 但 GET 可通）
        const axiosModule = (await import('axios')).default;
        let reachable = true;
        try {
          await axiosModule.head(result.url, {
            timeout: 3000, maxRedirects: 3,
            validateStatus: () => true,
          });
        } catch {
          reachable = false;
        }
        if (!reachable) continue;

        lb.report(platform, adapter.name, true, latency);
        lb.commitSong(platform, allAdapters);
        return result;
      }

      // 返回了但没有 url（歌不在库中），不 report
      continue;
    } catch (err) {
      const latency = Date.now() - start;
      const code = (err as any)?.code || '';
      if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ECONNABORTED') {
        lb.report(platform, adapter.name, false, latency);
      }
      continue;
    }
  }

  lb.commitSong(platform, allAdapters);
  throw new Error(`All adapters exhausted for ${platform}`);
}
