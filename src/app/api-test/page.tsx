'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Play, Check, X, Loader2, Save, ArrowLeft, Zap, Gauge, Clock, GripVertical, Ban, RefreshCw, Skull, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Platform } from '@/lib/playlist/types';

interface TestItem {
  name: string;
  status: 'pending' | 'testing' | 'success' | 'failed';
  time?: number;
  ext?: string;
  dead?: boolean;
  blocked?: boolean;
}

const PLATFORM_OPTIONS: { key: Platform; label: string }[] = [
  { key: 'netease', label: '网易云' },
  { key: 'qq', label: 'QQ音乐' },
  { key: 'kugou', label: '酷狗' },
  { key: 'kuwo', label: '酷我' },
];

const INTERVAL_UNITS = [
  { value: 'minutes', label: '分钟' },
  { value: 'hours', label: '小时' },
  { value: 'days', label: '天' },
] as const;

export default function ApiTestPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>('netease');
  const [testing, setTesting] = useState(false);
  const [items, setItems] = useState<TestItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [liveTotal, setLiveTotal] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [saved, setSaved] = useState(false);
  const [concurrency, setConcurrency] = useState(5);
  const [timeoutMs, setTimeoutMs] = useState(8000);
  const [sortMode, setSortMode] = useState<'quality' | 'speed'>('quality');
  const abortRef = useRef<AbortController | null>(null);

  const [autoReviveEnabled, setAutoReviveEnabled] = useState(false);
  const [intervalValue, setIntervalValue] = useState(5);
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours' | 'days'>('minutes');
  const autoReviveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [lastAutoReviveTime, setLastAutoReviveTime] = useState<string>('');

  // ── 首次加载 UI 设置 ──
  const uiLoadedRef = useRef(false);
  useEffect(() => {
    if (uiLoadedRef.current) return;
    fetch('/api/test-adapters/config')
      .then(r => r.json())
      .then(data => {
        const ui = data._ui;
        if (ui) {
          if (typeof ui.concurrency === 'number') setConcurrency(ui.concurrency);
          if (typeof ui.timeoutMs === 'number') setTimeoutMs(ui.timeoutMs);
          if (ui.sortMode) setSortMode(ui.sortMode);
        }
        uiLoadedRef.current = true;
      })
      .catch(() => { uiLoadedRef.current = true; });
  }, []);

  // ── 切换平台时加载历史配置 ──
  useEffect(() => {
    setCompleted(0);
    setTotal(0);
    setLiveTotal(0);
    setProgress(0);
    setSaved(false);
    setReviveResult(null);
    fetch('/api/test-adapters/config')
      .then(r => r.json())
      .then(data => {
        const order = data[platform] as string[] | undefined;
        const deadList: string[] = data._dead?.[platform] || [];
        const blockedList: string[] = data._blocked?.[platform] || [];
        const autoRevive = data._autoRevive?.[platform] === true;
        const intervalCfg = data._autoReviveInterval?.[platform];
        setAutoReviveEnabled(autoRevive);
        if (intervalCfg) {
          setIntervalValue(intervalCfg.value || 5);
          setIntervalUnit(intervalCfg.unit || 'minutes');
        }
        if (order && order.length > 0) {
          setItems(order.map(name => ({
            name,
            status: 'pending' as const,
            dead: deadList.includes(name),
            blocked: blockedList.includes(name),
          })));
          setTotal(order.length);
        } else {
          setItems([]);
          setTotal(0);
        }
      })
      .catch(() => {});
  }, [platform]);

  // ── UI 设置持久化 ──
  const uiSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const persistUi = useCallback(() => {
    if (uiSaveTimerRef.current) clearTimeout(uiSaveTimerRef.current);
    uiSaveTimerRef.current = setTimeout(() => {
      fetch('/api/test-adapters/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _ui: { concurrency, timeoutMs, sortMode } }),
      }).catch(() => {});
    }, 500);
  }, [concurrency, timeoutMs, sortMode]);

  useEffect(() => {
    if (!uiLoadedRef.current) return;
    persistUi();
    return () => { if (uiSaveTimerRef.current) clearTimeout(uiSaveTimerRef.current); };
  }, [concurrency, timeoutMs, sortMode, persistUi]);

  // ── 自动复活 ──
  const platformRef = useRef(platform);
  platformRef.current = platform;

  const getIntervalMs = (value: number, unit: string): number => {
    switch (unit) {
      case 'minutes': return value * 60 * 1000;
      case 'hours': return value * 60 * 60 * 1000;
      case 'days': return value * 24 * 60 * 60 * 1000;
      default: return 5 * 60 * 1000;
    }
  };

  const runAutoRevive = useCallback(async () => {
    const p = platformRef.current; // 快照当前平台
    try {
      const resp = await fetch('/api/test-adapters/revive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: p }),
      });
      if (platformRef.current !== p) return; // 平台已切换，丢弃过期结果
      const data = await resp.json();
      const platformResult = data.results?.[p];
      if (platformResult) {
        showReviveResult(platformResult);
        if (platformResult.revived.length > 0) {
          setItems(prev => {
            const next = prev.map(i =>
              platformResult.revived.includes(i.name)
                ? { ...i, dead: false, status: 'success' as const }
                : i
            );
            saveItems(next);
            return next;
          });
        }
        setLastAutoReviveTime(new Date().toLocaleTimeString());
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (autoReviveTimerRef.current) { clearInterval(autoReviveTimerRef.current); autoReviveTimerRef.current = null; }
    if (autoReviveEnabled) {
      runAutoRevive();
      autoReviveTimerRef.current = setInterval(runAutoRevive, getIntervalMs(intervalValue, intervalUnit));
    }
    return () => { if (autoReviveTimerRef.current) clearInterval(autoReviveTimerRef.current); };
  }, [autoReviveEnabled, intervalValue, intervalUnit, runAutoRevive]);

  const toggleAutoRevive = async () => {
    const next = !autoReviveEnabled;
    setAutoReviveEnabled(next);
    try {
      await fetch('/api/test-adapters/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, autoRevive: next, autoReviveInterval: { value: intervalValue, unit: intervalUnit } }),
      });
    } catch {}
  };

  const handleIntervalChange = async (value: number, unit: 'minutes' | 'hours' | 'days') => {
    setIntervalValue(value);
    setIntervalUnit(unit);
    if (autoReviveEnabled) {
      try {
        await fetch('/api/test-adapters/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, autoReviveInterval: { value, unit } }),
        });
      } catch {}
    }
  };

  // ── 持久化保存 ──
  const saveItems = async (currentItems?: TestItem[]) => {
    const list = currentItems || items;
    const ordered = list.map(i => i.name).filter(n => n !== '...' && !n.startsWith('#'));
    if (ordered.length === 0) return;
    const deadItems = list.filter(i => i.dead && i.name !== '...').map(i => i.name);
    const blockedItems = list.filter(i => i.blocked && i.name !== '...').map(i => i.name);
    await fetch('/api/test-adapters/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, order: ordered, dead: deadItems, blocked: blockedItems }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const saveOrder = () => saveItems();

  // ── 测试 ──
  const startTest = useCallback(async () => {
    setTesting(true);
    setSaved(false);
    setProgress(0);
    setCompleted(0);
    abortRef.current = new AbortController();
    try {
      const resp = await fetch(
        `/api/test-adapters?platform=${platform}&concurrency=${concurrency}&timeout=${timeoutMs}`,
        { signal: abortRef.current.signal }
      );
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'total') {
              setTotal(event.total);
              setLiveTotal(event.liveTotal || event.total);
              setItems(prev => {
                if (prev.length >= event.total) return prev;
                const next = [...prev];
                while (next.length < event.total) next.push({ name: '...', status: 'pending' as const, dead: false, blocked: false });
                return next;
              });
            } else if (event.type === 'result') {
              setCompleted(event.index);
              setProgress(liveTotal > 0 ? Math.round((event.index / liveTotal) * 100) : 0);
              setItems(prev => {
                const next = [...prev];
                const idx = next.findIndex(it => it.name === event.name);
                if (idx >= 0) next[idx] = { name: event.name, status: event.status, time: event.time, ext: event.ext, dead: !!event.dead, blocked: !!event.blocked };
                return next;
              });
            } else if (event.type === 'done') {
              setProgress(100);
              setItems(prev => {
                let updated = prev.map(i => ({
                  ...i,
                  dead: i.status === 'failed' && !i.blocked ? true : i.dead,
                }));
                const success = updated.filter(i => i.status === 'success');
                const failed = updated.filter(i => i.status === 'failed');
                const pending = updated.filter(i => i.status === 'pending');
                if (sortMode === 'speed') {
                  success.sort((a, b) => (a.time || 99999) - (b.time || 99999));
                } else {
                  success.sort((a, b) => {
                    const qa = a.ext === 'mp3' ? 0 : 1;
                    const qb = b.ext === 'mp3' ? 0 : 1;
                    if (qa !== qb) return qb - qa;
                    return (a.time || 99999) - (b.time || 99999);
                  });
                }
                updated = [...success, ...failed, ...pending];
                setTimeout(() => saveItems(updated), 0);
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.error(err);
    } finally {
      setTesting(false);
    }
  }, [platform, concurrency, timeoutMs, sortMode, liveTotal]);

  const stopTest = () => { abortRef.current?.abort(); setTesting(false); };

  // ── 死源 / 屏蔽源切换 ──
  const toggleDead = (idx: number) => {
    if (testing) return;
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], dead: !next[idx].dead, blocked: next[idx].blocked && !next[idx].dead ? false : next[idx].blocked };
      return next;
    });
    setSaved(false);
  };

  const toggleBlocked = (idx: number) => {
    if (testing) return;
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], blocked: !next[idx].blocked, dead: next[idx].blocked ? next[idx].dead : false };
      return next;
    });
    setSaved(false);
  };

  const markAllFailedAsDead = () => {
    if (testing) return;
    setItems(prev => prev.map(i => i.status === 'failed' && !i.blocked ? { ...i, dead: true } : i));
    setSaved(false);
  };

  const blockAllFailed = () => {
    if (testing) return;
    setItems(prev => prev.map(i => i.status === 'failed' ? { ...i, blocked: true, dead: false } : i));
    setSaved(false);
  };

  const clearDeadList = () => {
    if (testing) return;
    if (!confirm('确认清空当前平台的死名单？（屏蔽源不受影响）')) return;
    setItems(prev => prev.map(i => ({ ...i, dead: false })));
    setSaved(false);
  };

  const clearBlockedList = () => {
    if (testing) return;
    if (!confirm('确认清空当前平台的手动屏蔽源？')) return;
    setItems(prev => prev.map(i => ({ ...i, blocked: false })));
    setSaved(false);
  };

  // ── 手动检测死源 ──
  const [reviving, setReviving] = useState(false);
  const [reviveResult, setReviveResult] = useState<{ revived: string[]; stillDead: string[]; errors: string[] } | null>(null);
  const [reviveExpanded, setReviveExpanded] = useState(false);
  const reviveDismissRef = useRef<NodeJS.Timeout | null>(null);

  // 显示复活结果并 8 秒后自动消失
  const showReviveResult = (result: { revived: string[]; stillDead: string[]; errors: string[] }) => {
    setReviveResult(result);
    setReviveExpanded(false);
    if (reviveDismissRef.current) clearTimeout(reviveDismissRef.current);
    reviveDismissRef.current = setTimeout(() => setReviveResult(null), 8000);
  };

  const handleRevive = async () => {
    if (testing || reviving) return;
    const p = platformRef.current;
    setReviving(true);
    setReviveResult(null);
    try {
      const resp = await fetch('/api/test-adapters/revive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: p }) });
      if (platformRef.current !== p) return;
      const data = await resp.json();
      const platformResult = data.results?.[p];
      if (platformResult) {
        showReviveResult(platformResult);
        if (platformResult.revived.length > 0) {
          setItems(prev => {
            const next = prev.map(i => platformResult.revived.includes(i.name) ? { ...i, dead: false, status: 'success' as const } : i);
            saveItems(next);
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Revive error:', err);
    } finally {
      if (platformRef.current === p) setReviving(false);
    }
  };

  // ── 拖拽排序 ──
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const handleDragStart = (idx: number) => { if (!testing) setDragIdx(idx); };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setItems(prev => { const next = [...prev]; const [moved] = next.splice(dragIdx, 1); next.splice(idx, 0, moved); return next; });
    setDragIdx(idx);
  };
  const handleDragEnd = () => { setDragIdx(null); setSaved(false); };

  // ── 统计：始终从当前 items 计算 ──
  const deadCount = items.filter(i => i.dead).length;
  const blockedCount = items.filter(i => i.blocked).length;
  const availableCount = items.filter(i => i.name !== '...' && !i.dead && !i.blocked).length;

  return (
    <main className="min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 pb-32 transition-colors duration-300">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.push('/')} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <FlaskConical className="w-7 h-7 text-violet-500" />
          <h1 className="text-2xl font-bold">API 源测试</h1>
        </div>

        {/* ──── 统一设置卡片 ──── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm mb-6 overflow-hidden">
          {/* 平台选择 */}
          <div className="px-5 pt-5 pb-4 border-b border-slate-50 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
              <Settings2 className="w-3.5 h-3.5" /> 目标平台
            </div>
            <div className="flex gap-2">
              {PLATFORM_OPTIONS.map(p => (
                <button key={p.key}
                  onClick={() => { if (!testing) { setPlatform(p.key); setItems([]); setProgress(0); setSaved(false); } }}
                  className={cn('px-4 py-1.5 rounded-full text-sm font-medium transition-all',
                    platform === p.key
                      ? 'bg-violet-500 text-white shadow-lg shadow-violet-200 dark:shadow-none'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
                  )}>{p.label}</button>
              ))}
            </div>
          </div>

          {/* 测试参数 */}
          <div className="px-5 py-4 border-b border-slate-50 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
              <Gauge className="w-3.5 h-3.5" /> 测试参数
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* 并发数 */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>并发数</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{concurrency}</span>
                </div>
                <input type="range" min="1" max="10" value={concurrency}
                  onChange={e => setConcurrency(Number(e.target.value))}
                  className="w-full h-1.5 accent-violet-500 cursor-pointer" disabled={testing} />
              </div>
              {/* 超时 */}
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>超时</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{timeoutMs}ms</span>
                </div>
                <input type="range" min="2000" max="15000" step="1000" value={timeoutMs}
                  onChange={e => setTimeoutMs(Number(e.target.value))}
                  className="w-full h-1.5 accent-violet-500 cursor-pointer" disabled={testing} />
              </div>
            </div>
          </div>

          {/* 排序模式 + 按钮 */}
          <div className="px-5 py-4 border-b border-slate-50 dark:border-slate-800">
            <div className="flex items-center gap-3 flex-wrap">
              {/* 排序模式 */}
              <button
                onClick={() => setSortMode(m => m === 'quality' ? 'speed' : 'quality')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  sortMode === 'quality'
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/30'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'
                )}>
                <Zap className="w-3.5 h-3.5" />
                {sortMode === 'quality' ? '音质优先' : '速度优先'}
              </button>

              {/* 开始测试 */}
              {!testing ? (
                <button onClick={startTest}
                  className="flex items-center gap-1.5 px-5 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-full text-sm font-medium transition-colors shadow-lg shadow-violet-200 dark:shadow-none">
                  <Play className="w-3.5 h-3.5" /> 开始测试
                </button>
              ) : (
                <button onClick={stopTest}
                  className="flex items-center gap-1.5 px-5 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-medium transition-colors">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> 停止
                </button>
              )}

              {/* 保存排序 */}
              {items.length > 0 && !testing && (
                <button onClick={saveOrder}
                  className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                    saved
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 border border-emerald-200 dark:border-emerald-800/30'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-emerald-300'
                  )}>
                  {saved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  {saved ? '已保存' : '保存排序'}
                </button>
              )}
            </div>
          </div>

          {/* 自动检测死源 */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
              <RefreshCw className="w-3.5 h-3.5" /> 定时检测死名单
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              {/* 开关 */}
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={autoReviveEnabled} onChange={toggleAutoRevive}
                  className="w-4 h-4 accent-violet-500 cursor-pointer" disabled={testing} />
                <span className={cn('text-sm font-medium', autoReviveEnabled ? 'text-violet-600 dark:text-violet-400' : 'text-slate-500')}>
                  {autoReviveEnabled ? '已开启' : '已关闭'}
                </span>
              </label>

              {/* 间隔设置 */}
              {autoReviveEnabled && (
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="text-slate-400">每</span>
                  <input type="number" min={1} max={999} value={intervalValue}
                    onChange={e => { const v = Math.max(1, parseInt(e.target.value) || 1); handleIntervalChange(v, intervalUnit); }}
                    className="w-14 px-2 py-1 text-center border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent text-slate-700 dark:text-slate-300 focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 outline-none text-sm" />
                  <select value={intervalUnit}
                    onChange={e => handleIntervalChange(intervalValue, e.target.value as 'minutes' | 'hours' | 'days')}
                    className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-transparent text-slate-700 dark:text-slate-300 focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30 outline-none text-sm cursor-pointer">
                    {INTERVAL_UNITS.map(u => (<option key={u.value} value={u.value}>{u.label}</option>))}
                  </select>
                  <span className="text-slate-400">检测一次</span>
                  {lastAutoReviveTime && <span className="text-slate-400 text-xs ml-1">· 上次 {lastAutoReviveTime}</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ──── 进度条 ──── */}
        {total > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1.5 text-slate-500">
              <span>{completed}/{liveTotal || total} 已测</span><span>{progress}%</span>
            </div>
            <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <motion.div className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full"
                initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
            </div>
          </div>
        )}

        {/* ──── 统计 + 快捷操作 ──── */}
        {items.length > 0 && !testing && (
          <div className="flex items-center gap-3 mb-6 text-sm flex-wrap">
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-medium text-xs border border-emerald-100 dark:border-emerald-800/30">
              <Check className="w-3.5 h-3.5" /> {availableCount} 可用
            </span>
            <span className={cn('flex items-center gap-1 px-2.5 py-1 rounded-full font-medium text-xs border',
              deadCount > 0
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-800/30'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-100 dark:border-slate-700'
            )}>
              <Skull className="w-3.5 h-3.5" /> {deadCount} 死源
            </span>
            <span className={cn('flex items-center gap-1 px-2.5 py-1 rounded-full font-medium text-xs border',
              blockedCount > 0
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-100 dark:border-slate-700'
            )}>
              <Ban className="w-3.5 h-3.5" /> {blockedCount} 屏蔽源
            </span>
            {saved && <span className="text-violet-500 animate-pulse text-xs"><Zap className="w-3.5 h-3.5 inline mr-1" />已保存</span>}

            {/* 操作按钮 */}
            {items.some(i => i.status === 'failed') && (
              <>
                <button onClick={markAllFailedAsDead}
                  className="px-2.5 py-1 text-xs rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors border border-amber-200 dark:border-amber-800/30">
                  全部加入死名单
                </button>
                <button onClick={blockAllFailed}
                  className="px-2.5 py-1 text-xs rounded-full bg-slate-50 dark:bg-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700">
                  全部手动屏蔽
                </button>
              </>
            )}
            {deadCount > 0 && (
              <>
                <button onClick={handleRevive} disabled={reviving}
                  className={cn('px-2.5 py-1 text-xs rounded-full transition-colors border flex items-center gap-1',
                    reviving
                      ? 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-wait'
                      : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border-emerald-200 dark:border-emerald-800/30'
                  )}>
                  {reviving ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  检测死源
                </button>
                <button onClick={clearDeadList}
                  className="px-2.5 py-1 text-xs rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors border border-amber-200 dark:border-amber-800/30">
                  清空死名单
                </button>
              </>
            )}
            {blockedCount > 0 && (
              <button onClick={clearBlockedList}
                className="px-2.5 py-1 text-xs rounded-full bg-slate-50 dark:bg-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700">
                清空屏蔽源
              </button>
            )}
          </div>
        )}

        {/* ──── 复活结果（紧凑，8 秒自动消失）──── */}
        {reviveResult && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="mb-6 px-4 py-3 rounded-xl border text-sm bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800">
            <button onClick={() => setReviveExpanded(e => !e)}
              className="flex items-center gap-2 w-full text-left cursor-pointer">
              {reviveResult.revived.length > 0 ? (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Check className="w-4 h-4" />
                  已恢复 {reviveResult.revived.length} 个
                </span>
              ) : (
                <span className="text-slate-400">检测完成，无源恢复</span>
              )}
              {reviveResult.stillDead.length > 0 && (
                <span className="text-slate-400">
                  · 仍不可用 {reviveResult.stillDead.length} 个
                </span>
              )}
              <span className="text-slate-300 dark:text-slate-600 text-xs ml-auto">
                {reviveExpanded ? '收起 ▲' : '详情 ▼'}
              </span>
            </button>
            {reviveExpanded && (
              <div className="mt-2 pt-2 border-t border-slate-50 dark:border-slate-800 space-y-1">
                {reviveResult.revived.length > 0 && (
                  <p className="text-emerald-600 dark:text-emerald-400 text-xs">
                    已恢复：{reviveResult.revived.join(', ')}
                  </p>
                )}
                {reviveResult.stillDead.length > 0 && (
                  <p className="text-slate-400 text-xs">
                    仍不可用：{reviveResult.stillDead.join(', ')}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* ──── 适配器列表 ──── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            <AnimatePresence>
              {items.map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  draggable={!testing}
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  className={cn('flex items-center gap-3 px-4 py-3 text-sm cursor-default select-none',
                    dragIdx === i && 'opacity-50 bg-violet-50 dark:bg-violet-900/10',
                    item.status === 'testing' && 'bg-violet-50 dark:bg-violet-900/10',
                    item.blocked && 'opacity-40 bg-slate-50 dark:bg-slate-800/30',
                    item.dead && !item.blocked && 'opacity-60 bg-amber-50/50 dark:bg-amber-900/5',
                  )}>
                  <div className="w-5 h-5 flex-shrink-0 text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  <span className="w-6 text-xs text-slate-400 dark:text-slate-500 text-right flex-shrink-0 font-mono">{i + 1}</span>
                  <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                    {item.blocked && <Ban className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                    {!item.blocked && item.dead && <Skull className="w-4 h-4 text-amber-500" />}
                    {!item.blocked && !item.dead && item.status === 'pending' && <div className="w-3 h-3 rounded-full bg-slate-200 dark:bg-slate-700" />}
                    {!item.blocked && !item.dead && item.status === 'testing' && <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />}
                    {!item.blocked && !item.dead && item.status === 'success' && <Check className="w-4 h-4 text-emerald-500" />}
                    {!item.blocked && !item.dead && item.status === 'failed' && <X className="w-4 h-4 text-red-400" />}
                  </div>
                  <span className={cn('font-mono flex-1 min-w-0 truncate',
                    item.blocked ? 'text-slate-400 dark:text-slate-500 line-through decoration-slate-400' :
                    item.dead ? 'text-amber-600 dark:text-amber-400' :
                    'text-slate-700 dark:text-slate-300'
                  )}>{item.name}</span>
                  {item.dead && !item.blocked && (
                    <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">死源</span>
                  )}
                  {item.blocked && (
                    <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-medium">屏蔽</span>
                  )}
                  {!item.blocked && !item.dead && item.status === 'success' && (
                    <span className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 text-xs">{item.ext?.toUpperCase()} · {item.time}ms</span>
                  )}
                  {!item.blocked && !item.dead && item.status === 'failed' && item.time !== undefined && (
                    <span className="text-slate-400 flex-shrink-0 text-xs">{item.time}ms</span>
                  )}
                  {!testing && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!item.blocked && (
                        <button onClick={(e) => { e.stopPropagation(); toggleDead(i); }}
                          className={cn('w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors',
                            item.dead
                              ? 'bg-amber-100 dark:bg-amber-900/20 text-amber-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:text-emerald-600'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-500'
                          )}
                          title={item.dead ? '移出死名单' : '加入死名单'}>
                          {item.dead ? '💀' : '☠'}
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); toggleBlocked(i); }}
                        className={cn('w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors',
                          item.blocked
                            ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:text-emerald-600'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500'
                        )}
                        title={item.blocked ? '解除屏蔽' : '手动屏蔽（不参与自动检测）'}>
                        {item.blocked ? '⊘' : '⊗'}
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </main>
  );
}
