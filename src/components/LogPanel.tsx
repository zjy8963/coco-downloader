'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, X, ChevronDown, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  msg: string;
  tag?: string;
}

const TAG_COLORS: Record<string, string> = {
  download: 'text-sky-400',
  quality: 'text-amber-400',
  test: 'text-violet-400',
  'cross-platform': 'text-emerald-400',
  jbsou: 'text-rose-400',
  '切平台': 'text-cyan-400',
  adapter: 'text-indigo-400',
};

export default function LogPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/logs');
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        setLogs(prev => {
          const next = [...prev, entry];
          if (next.length > 500) next.splice(0, next.length - 500);
          return next;
        });
      } catch {}
    };

    es.onerror = () => {
      // 连接断开自动重连
    };

    return () => { es.close(); };
  }, []);

  // 自动滚到底部
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, open]);

  const clearLogs = () => setLogs([]);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  };

  const levelIcon = (level: string) => {
    switch (level) {
      case 'error': return '✕';
      case 'warn': return '⚠';
      default: return '';
    }
  };

  return (
    <>
      {/* 浮动按钮 */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 left-6 z-50 w-12 h-12 bg-slate-800 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-emerald-400 rounded-full shadow-lg flex items-center justify-center transition-all active:scale-95"
            title="日志面板"
          >
            <Terminal className="w-5 h-5" />
            {logs.filter(l => l.level === 'error').length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                {logs.filter(l => l.level === 'error').length}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* 日志面板 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: 20, height: 0 }}
            className="fixed bottom-6 left-6 z-50 w-[480px] max-w-[calc(100vw-3rem)] max-h-[60vh] bg-slate-900/95 backdrop-blur border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-700 bg-slate-800/50">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-slate-200">运行日志</span>
                <span className="text-xs text-slate-500">{logs.length}</span>
              </div>
              <div className="flex items-center gap-1">
                {/* 筛选 */}
                {(['all', 'info', 'warn', 'error'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={cn('px-2 py-0.5 text-[10px] rounded-md transition-colors',
                      filter === f
                        ? 'bg-slate-700 text-slate-200'
                        : 'text-slate-500 hover:text-slate-300'
                    )}>
                    {f === 'all' ? '全部' : f === 'info' ? '信息' : f === 'warn' ? '警告' : '错误'}
                  </button>
                ))}
                <button onClick={clearLogs} className="p-1 text-slate-500 hover:text-slate-300 transition-colors" title="清空">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setOpen(false)} className="p-1 text-slate-500 hover:text-slate-300 transition-colors">
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Log List */}
            <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed space-y-0.5">
              {filtered.length === 0 && (
                <div className="text-slate-600 py-4 text-center">等待日志...</div>
              )}
              {filtered.map((entry, i) => (
                <div key={i} className={cn('flex gap-2',
                  entry.level === 'error' && 'bg-red-900/20 -mx-1 px-1 rounded',
                  entry.level === 'warn' && 'bg-amber-900/10 -mx-1 px-1 rounded',
                )}>
                  <span className="text-slate-600 flex-shrink-0 w-[66px]">{formatTime(entry.ts)}</span>
                  <span className={cn('flex-shrink-0 w-4 text-center',
                    entry.level === 'error' ? 'text-red-400' :
                    entry.level === 'warn' ? 'text-amber-400' : 'text-slate-500'
                  )}>{levelIcon(entry.level)}</span>
                  {entry.tag && (
                    <span className={cn('flex-shrink-0', TAG_COLORS[entry.tag] || 'text-slate-500')}>
                      [{entry.tag}]
                    </span>
                  )}
                  <span className={cn(
                    entry.level === 'error' ? 'text-red-300' :
                    entry.level === 'warn' ? 'text-amber-300' : 'text-slate-300'
                  )}>{entry.msg}</span>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
