/**
 * 适配器测试器 v2
 * 支持并发测试、超时阈值、配置化
 */
import { AudioApiAdapter, Platform, RawTrackData } from './types';
import { getAllAdapters } from './resolvers';

export interface AdapterTestResult {
  name: string;
  status: 'success' | 'failed';
  time: number;
  ext?: string;
}

export interface TestOptions {
  concurrency: number;   // 并发数
  timeoutMs: number;     // 超过此时间算失败
  order?: string[];      // 指定测试顺序（来自历史配置）
}

const TEST_DATA: Partial<Record<Platform, RawTrackData>> = {
  netease: { id: '3382908505', title: '晴天', artist: '周杰伦', raw: {} },
  qq:      { id: '003TLWoN0gQnP5', title: '晴天', artist: '周杰伦', raw: {} },
  kugou:   { id: '3891584F58EE0372F5ACC4CB0B1E70BE', title: 'Unscripted Aura', artist: 'EchoSKy', raw: {} },
  kuwo:    { id: '708227', title: '车载低音炮', artist: 'dj舞曲', raw: {} },
};

/** 并发测试适配器，结果逐个实时推送 */
export async function* testAdapters(
  platform: Platform,
  opts: TestOptions = { concurrency: 3, timeoutMs: 8000 },
  testData?: RawTrackData,
  adapters?: AudioApiAdapter[]  // 可选：自定义适配器列表，不传则取全部
): AsyncGenerator<AdapterTestResult & { index: number }> {
  let list = adapters || getAllAdapters(platform);
  const data = testData || TEST_DATA[platform];
  if (!data) return;

  if (opts.order && opts.order.length > 0) {
    const orderMap = new Map(opts.order.map((name, i) => [name, i]));
    list = [...list].sort((a, b) => (orderMap.get(a.name) ?? 999) - (orderMap.get(b.name) ?? 999));
  }

  const LIMIT = Math.max(1, opts.concurrency);
  const queue = list.map((a, i) => ({ adapter: a, idx: i }));
  const running: Promise<AdapterTestResult & { index: number }>[] = [];
  let next = 0;

  const runOne = async (adapter: AudioApiAdapter, idx: number): Promise<AdapterTestResult & { index: number }> => {
    const start = Date.now();
    try {
      const timeout = new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), opts.timeoutMs));
      const result = await Promise.race([adapter.resolve(data), timeout]);
      const elapsed = Date.now() - start;
      if (result && (result as any).url) {
        return { name: adapter.name, status: 'success', time: elapsed, ext: (result as any).type || 'mp3', index: idx + 1 };
      }
      return { name: adapter.name, status: 'failed', time: elapsed, index: idx + 1 };
    } catch {
      return { name: adapter.name, status: 'failed', time: Date.now() - start, index: idx + 1 };
    }
  };

  while (next < queue.length || running.length > 0) {
    // 补充到并发上限
    while (next < queue.length && running.length < LIMIT) {
      const { adapter, idx } = queue[next++];
      const p = runOne(adapter, idx);
      running.push(p);
      // 完成时自动从 running 中移除
      p.then(() => {
        const i = running.indexOf(p);
        if (i >= 0) running.splice(i, 1);
      });
    }
    // 等任意一个完成
    if (running.length > 0) {
      yield await Promise.race(running);
    }
  }
}
