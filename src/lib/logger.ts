/**
 * 统一日志模块
 * 拦截 console.log/warn/error，写入环形缓冲区，供 SSE 实时推送
 */
export interface LogEntry {
  ts: number;           // 时间戳
  level: 'info' | 'warn' | 'error';
  msg: string;          // 日志内容
  tag?: string;         // 标签，如 [download] [quality]
}

const MAX = 500;
const buffer: LogEntry[] = [];
const listeners = new Set<(e: LogEntry) => void>();

function emit(entry: LogEntry) {
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  for (const fn of listeners) {
    try { fn(entry); } catch { /* 不阻塞 */ }
  }
}

/** 订阅日志流，返回取消函数 */
export function subscribe(fn: (e: LogEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 获取已缓存的全部日志 */
export function getBuffer(): LogEntry[] {
  return [...buffer];
}

function format(args: unknown[]): string {
  return args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

function extractTag(msg: string): { tag?: string; clean: string } {
  const m = msg.match(/^\[(\w[-\w]*)\]\s*/);
  if (m) return { tag: m[1], clean: msg.slice(m[0].length) };
  return { clean: msg };
}

// ── 拦截 console ──
const _log = console.log.bind(console);
const _warn = console.warn.bind(console);
const _error = console.error.bind(console);

console.log = (...args: unknown[]) => {
  _log(...args);
  const msg = format(args);
  const { tag, clean } = extractTag(msg);
  emit({ ts: Date.now(), level: 'info', msg: clean, tag });
};

console.warn = (...args: unknown[]) => {
  _warn(...args);
  const msg = format(args);
  const { tag, clean } = extractTag(msg);
  emit({ ts: Date.now(), level: 'warn', msg: clean, tag });
};

console.error = (...args: unknown[]) => {
  _error(...args);
  const msg = format(args);
  const { tag, clean } = extractTag(msg);
  emit({ ts: Date.now(), level: 'error', msg: clean, tag });
};
