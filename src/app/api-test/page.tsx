'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, Play, Check, X, Loader2, Save, ArrowLeft, Zap, Gauge, Clock, GripVertical, Ban, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Platform } from '@/lib/playlist/types';

interface TestItem {
  name: string;
  status: 'pending' | 'testing' | 'success' | 'failed';
  time?: number;
  ext?: string;
  dead?: boolean;      // 是否在死名单中
}

const PLATFORM_OPTIONS: { key: Platform; label: string }[] = [
  { key: 'netease', label: '网易云' },
  { key: 'qq', label: 'QQ音乐' },
  { key: 'kugou', label: '酷狗' },
  { key: 'kuwo', label: '酷我' },
];

export default function ApiTestPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>('netease');
  const [testing, setTesting] = useState(false);
  const [items, setItems] = useState<TestItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [liveTotal, setLiveTotal] = useState(0);  // 非屏蔽适配器数量
  const [completed, setCompleted] = useState(0);
  const [saved, setSaved] = useState(false);
  const [concurrency, setConcurrency] = useState(5);
  const [timeoutMs, setTimeoutMs] = useState(8000);
  const [sortMode, setSortMode] = useState<'quality' | 'speed'>('quality');
  const abortRef = useRef<AbortController | null>(null);

  // 切换平台时加载历史配置，重置统计
  useEffect(() => {
    setCompleted(0);
    setTotal(0);
    setLiveTotal(0);
    setProgress(0);
    setSaved(false);
    fetch('/api/test-adapters/config')
      .then(r => r.json())
      .then(data => {
        const order = data[platform] as string[] | undefined;
        const deadList: string[] = data._dead?.[platform] || [];
        if (order && order.length > 0) {
          setItems(order.map(name => ({
            name,
            status: 'pending' as const,
            dead: deadList.includes(name),
          })));
          setTotal(order.length);
        } else {
          setItems([]);
          setTotal(0);
        }
      })
      .catch(() => {});
  }, [platform]);

  const startTest = useCallback(async () => {
    setTesting(true);
    setSaved(false);
    setProgress(0);
    setCompleted(0);
    // 不重置 items，保留历史顺序

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
                // 扩容到 total 数量，保留已有项（含屏蔽源）
                if (prev.length >= event.total) return prev;
                const next = [...prev];
                while (next.length < event.total) {
                  next.push({ name: '...', status: 'pending' as const, dead: false });
                }
                return next;
              });
            } else if (event.type === 'result') {
              setCompleted(event.index);
              setProgress(liveTotal > 0 ? Math.round((event.index / liveTotal) * 100) : 0);
              // 按 name 匹配更新，而非按 index（因为屏蔽源已跳过，index 不对齐）
              setItems(prev => {
                const next = [...prev];
                const idx = next.findIndex(item => item.name === event.name);
                if (idx >= 0) {
                  next[idx] = { name: event.name, status: event.status, time: event.time, ext: event.ext, dead: !!event.dead };
                }
                return next;
              });
            } else if (event.type === 'done') {
              // done 事件返回最终死名单
              const finalDead: string[] = event.dead || [];
              setProgress(100);
              // 测试完成后排序
              setItems(prev => {
                const updated = prev.map(i => ({
                  ...i,
                  dead: finalDead.includes(i.name),
                }));
                const success = updated.filter(i => i.status === 'success');
                const failed = updated.filter(i => i.status === 'failed');
                const pending = updated.filter(i => i.status === 'pending');
                if (sortMode === 'speed') {
                  success.sort((a, b) => (a.time || 99999) - (b.time || 99999));
                } else {
                  // 音质优先：flac 在前，mp3 在后，同类按速度
                  success.sort((a, b) => {
                    const qa = a.ext === 'mp3' ? 0 : 1;
                    const qb = b.ext === 'mp3' ? 0 : 1;
                    if (qa !== qb) return qb - qa;
                    return (a.time || 99999) - (b.time || 99999);
                  });
                }
                return [...success, ...failed, ...pending];
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
  }, [platform, concurrency, timeoutMs]);

  const stopTest = () => { abortRef.current?.abort(); setTesting(false); };

  const saveOrder = async () => {
    // 按当前列表顺序保存，过滤掉占位符
    const ordered = items.map(i => i.name).filter(n => n !== '...' && !n.startsWith('#'));
    if (ordered.length === 0) return;
    // 收集已标记为 dead 的适配器
    const deadItems = items.filter(i => i.dead && i.name !== '...').map(i => i.name);
    await fetch('/api/test-adapters/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, order: ordered, dead: deadItems }),
    });
    setSaved(true);
  };

  // ── 死名单切换 ──
  const toggleDead = (idx: number) => {
    if (testing) return;
    setItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], dead: !next[idx].dead };
      return next;
    });
    setSaved(false);
  };

  // ── 一键把全部 failed 源加入死名单 ──
  const markAllFailedAsDead = () => {
    if (testing) return;
    setItems(prev => prev.map(i =>
      i.status === 'failed' ? { ...i, dead: true } : i
    ));
    setSaved(false);
  };

  // ── 清空当前平台死名单 ──
  const clearDeadList = () => {
    if (testing) return;
    if (!confirm('确认清空当前平台的死名单？')) return;
    setItems(prev => prev.map(i => ({ ...i, dead: false })));
    setSaved(false);
  };

  // ── 检测屏蔽源 ──
  const [reviving, setReviving] = useState(false);
  const [reviveResult, setReviveResult] = useState<{
    revived: string[];
    stillDead: string[];
    errors: string[];
  } | null>(null);

  const handleRevive = async () => {
    if (testing || reviving) return;
    setReviving(true);
    setReviveResult(null);
    try {
      const resp = await fetch('/api/test-adapters/revive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const data = await resp.json();
      const platformResult = data.results?.[platform];
      if (platformResult) {
        setReviveResult(platformResult);
        // 将已恢复的源从死名单中移除
        if (platformResult.revived.length > 0) {
          setItems(prev => prev.map(i =>
            platformResult.revived.includes(i.name)
              ? { ...i, dead: false, status: 'success' as const }
              : i
          ));
          setSaved(false);
        }
      }
    } catch (err) {
      console.error('Revive error:', err);
    } finally {
      setReviving(false);
    }
  };

  // ── 拖拽排序 ──
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const handleDragStart = (idx: number) => { if (!testing) setDragIdx(idx); };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  };
  const handleDragEnd = () => { setDragIdx(null); setSaved(false); };

  const successCount = items.filter(i => i.status === 'success').length;
  const failedCount = items.filter(i => i.status === 'failed').length;
  const deadCount = items.filter(i => i.dead).length;

  return (
    <main className="min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 pb-32 transition-colors duration-300">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={() => router.push('/')} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <FlaskConical className="w-7 h-7 text-violet-500" />
          <h1 className="text-2xl font-bold">API 源测试</h1>
        </div>

        {/* 设置面板 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 p-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
              <Gauge className="w-4 h-4" /> 并发数: <span className="font-bold text-slate-700 dark:text-slate-300">{concurrency}</span>
            </div>
            <input type="range" min="1" max="10" value={concurrency}
              onChange={e => setConcurrency(Number(e.target.value))}
              className="w-full accent-violet-500" disabled={testing} />
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 p-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
              <Clock className="w-4 h-4" /> 超时: <span className="font-bold text-slate-700 dark:text-slate-300">{timeoutMs}ms</span>
            </div>
            <input type="range" min="2000" max="15000" step="1000" value={timeoutMs}
              onChange={e => setTimeoutMs(Number(e.target.value))}
              className="w-full accent-violet-500" disabled={testing} />
          </div>
        </div>

        {/* Platform Selector */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {PLATFORM_OPTIONS.map(p => (
            <button key={p.key}
              onClick={() => { if (!testing) { setPlatform(p.key); setItems([]); setProgress(0); setSaved(false); } }}
              className={cn('px-5 py-2 rounded-full text-sm font-medium transition-all',
                platform === p.key
                  ? 'bg-violet-500 text-white shadow-lg shadow-violet-200 dark:shadow-none'
                  : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700 hover:border-violet-300'
              )}>{p.label}</button>
          ))}
        </div>

        {/* Progress */}
        {total > 0 && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2 text-slate-500">
              <span>{completed}/{liveTotal || total} 已测</span><span>{progress}%</span>
            </div>
            <div className="h-3 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
              <motion.div className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full"
                initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 mb-8 flex-wrap">
          {!testing ? (
            <button onClick={startTest}
              className="flex items-center gap-2 px-6 py-2.5 bg-violet-500 hover:bg-violet-600 text-white rounded-full font-medium transition-colors shadow-lg shadow-violet-200 dark:shadow-none">
              <Play className="w-4 h-4" /> 开始测试
            </button>
          ) : (
            <button onClick={stopTest}
              className="flex items-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-full font-medium transition-colors">
              <Loader2 className="w-4 h-4 animate-spin" /> 停止
            </button>
          )}
          {items.length > 0 && !testing && (
            <button onClick={saveOrder} disabled={saved}
              className={cn('flex items-center gap-2 px-6 py-2.5 rounded-full font-medium transition-colors',
                saved ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-200 dark:shadow-none')}>
              {saved ? <><Check className="w-4 h-4" /> 已保存</> : <><Save className="w-4 h-4" /> 保存排序</>}
            </button>
          )}
          {/* 排序模式切换 */}
          {items.length > 0 && !testing && (
            <button
              onClick={() => setSortMode(m => m === 'quality' ? 'speed' : 'quality')}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-colors',
                sortMode === 'quality'
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-200 dark:shadow-none'
                  : 'bg-white dark:bg-slate-900 text-slate-500 border border-slate-200 dark:border-slate-700'
              )}
            >
              <Zap className="w-4 h-4" />
              {sortMode === 'quality' ? '音质优先' : '速度优先'}
            </button>
          )}
        </div>

        {/* Stats */}
        {items.length > 0 && !testing && (
          <div className="flex gap-4 mb-6 text-sm flex-wrap items-center">
            <span className="text-emerald-600 dark:text-emerald-400"><Check className="w-4 h-4 inline mr-1" />{successCount} 可用</span>
            <span className="text-red-500"><X className="w-4 h-4 inline mr-1" />{failedCount} 不可用</span>
            {deadCount > 0 && (
              <span className="text-slate-400 dark:text-slate-500"><FlaskConical className="w-4 h-4 inline mr-1" />{deadCount} 已屏蔽</span>
            )}
            {saved && <span className="text-violet-500"><Zap className="w-4 h-4 inline mr-1" />排序已应用</span>}
            {!testing && failedCount > 0 && (
              <button onClick={markAllFailedAsDead}
                className="px-3 py-1 text-xs rounded-full bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors border border-red-200 dark:border-red-800/30">
                全部标记为屏蔽
              </button>
            )}
            {!testing && deadCount > 0 && (
              <button onClick={clearDeadList}
                className="px-3 py-1 text-xs rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700">
                清空屏蔽列表
              </button>
            )}
            {!testing && deadCount > 0 && (
              <button onClick={handleRevive} disabled={reviving}
                className={cn(
                  'px-3 py-1 text-xs rounded-full transition-colors border flex items-center gap-1',
                  reviving
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-wait'
                    : 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 border-amber-200 dark:border-amber-800/30'
                )}>
                {reviving ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                检测屏蔽源
              </button>
            )}
          </div>
        )}

        {/* Revive Result */}
        {reviveResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 rounded-xl border text-sm"
          >
            {reviveResult.revived.length > 0 && (
              <p className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-1">
                <Check className="w-4 h-4" />
                已恢复 {reviveResult.revived.length} 个源：{reviveResult.revived.join(', ')}
              </p>
            )}
            {reviveResult.stillDead.length > 0 && (
              <p className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Ban className="w-4 h-4" />
                仍不可用 {reviveResult.stillDead.length} 个源：{reviveResult.stillDead.join(', ')}
              </p>
            )}
            {reviveResult.revived.length === 0 && reviveResult.stillDead.length === 0 && (
              <p className="text-slate-400">没有需要检测的屏蔽源</p>
            )}
          </motion.div>
        )}

        {/* Adapter List */}
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
                    item.dead && 'opacity-50 bg-slate-50 dark:bg-slate-800/50'
                  )}>
                  {/* 拖拽手柄 */}
                  <div className="w-5 h-5 flex-shrink-0 text-slate-300 dark:text-slate-600 cursor-grab active:cursor-grabbing">
                    <GripVertical className="w-4 h-4" />
                  </div>
                  {/* 序号 */}
                  <span className="w-6 text-xs text-slate-400 dark:text-slate-500 text-right flex-shrink-0 font-mono">
                    {i + 1}
                  </span>
                  {/* 状态 */}
                  <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                    {item.dead && <Ban className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                    {!item.dead && item.status === 'pending' && <div className="w-3 h-3 rounded-full bg-slate-200 dark:bg-slate-700" />}
                    {!item.dead && item.status === 'testing' && <Loader2 className="w-4 h-4 text-violet-500 animate-spin" />}
                    {!item.dead && item.status === 'success' && <Check className="w-4 h-4 text-emerald-500" />}
                    {!item.dead && item.status === 'failed' && <X className="w-4 h-4 text-red-400" />}
                  </div>
                  {/* 名称 */}
                  <span className={cn('font-mono flex-1 min-w-0 truncate',
                    item.dead ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-300'
                  )}>{item.name}</span>
                  {/* 详情 */}
                  {!item.dead && item.status === 'success' && (
                    <span className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 text-xs">{item.ext?.toUpperCase()} · {item.time}ms</span>
                  )}
                  {!item.dead && item.status === 'failed' && item.time !== undefined && (
                    <span className="text-slate-400 flex-shrink-0 text-xs">{item.time}ms</span>
                  )}
                  {/* 死名单切换 */}
                  {!testing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleDead(i); }}
                      className={cn(
                        'w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors flex-shrink-0',
                        item.dead
                          ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:text-emerald-600'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500'
                      )}
                      title={item.dead ? '取消屏蔽' : '加入屏蔽'}
                    >
                      {item.dead ? '⊗' : '⊘'}
                    </button>
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
