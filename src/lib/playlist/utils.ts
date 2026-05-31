import { Platform } from './types';

// ── 平台 hostname 匹配集（直接继承 musicdl hosts.py）──

const PLATFORM_HOSTS: Record<Platform, string[]> = {
  netease: ['music.163.com', 'y.music.163.com', 'm.music.163.com', '3g.music.163.com', '163cn.tv'],
  qq: ['y.qq.com', 'i.y.qq.com', 'c.y.qq.com', 'c6.y.qq.com', 'music.qq.com'],
  kugou: ['www.kugou.com', 'm.kugou.com', 'kugou.com', 'h5.kugou.com'],
  kuwo: ['kuwo.cn', 'www.kuwo.cn', 'm.kuwo.cn', 'mobile.kuwo.cn'],
};

// ── 平台检测 ──

/** 从歌单 URL 识别平台 */
export function detectPlatform(url: string): Platform | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS)) {
    if (hosts.some(h => hostname === h || hostname.endsWith('.' + h))) {
      return platform as Platform;
    }
  }
  return null;
}

// ── 歌单 ID 提取 ──

/** 从歌单 URL 中提取平台原生歌单 ID */
export function extractPlaylistId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // 1. 检查 hash fragment（网易云 #/playlist?id=xxx）
  if (parsed.hash) {
    const fragmentQuery = parsed.hash.replace(/^#\/?/, '');
    const fakeUrl = new URL('https://x.com/?' + fragmentQuery.split('?').slice(1).join('?'));
    const idFromFragment = fakeUrl.searchParams.get('id');
    if (idFromFragment) return idFromFragment;
  }

  // 2. 检查 query 参数
  const idFromQuery = parsed.searchParams.get('id');
  if (idFromQuery) return idFromQuery;

  // 3. 从 path 末段提取
  const pathParts = parsed.pathname.replace(/\/$/, '').split('/');
  const lastPart = pathParts[pathParts.length - 1].replace(/\.html?$/i, '');
  if (lastPart && /^\d+/.test(lastPart)) return lastPart;

  return null;
}

// ── 限流重试 ──

/** 递增延时重试（用于网易云 v3 API code:-447 限流） */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxRetries) {
        await sleep(baseDelayMs * (i + 1)); // 1s → 2s → 3s
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── misc ──

/** 从 URL 提取文件扩展名 */
export function extractExt(url: string): string {
  const clean = url.split('?')[0];
  const parts = clean.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : 'mp3';
}

/** 随机 UA（模拟 musicdl 的 fake_useragent） */
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
];
export function randomUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}
