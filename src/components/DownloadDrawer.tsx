import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, CheckCircle2, AlertCircle, Trash2, Music, Loader2, Search, ChevronDown, Pause, Play } from 'lucide-react';
import { DownloadTask } from '@/types/download';
import { cn } from '@/lib/utils';
import Image from 'next/image';

interface DownloadDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: DownloadTask[];
  onRemoveTask: (taskId: string) => void;
  onClearTasks: (type: 'all' | 'pending' | 'completed' | 'error') => void;
  isPaused: boolean;
  onTogglePause: () => void;
  pendingCount: number;
  downloadingCount: number;
  hasSavePath?: boolean;
  saveToDisk?: boolean;
  onToggleSaveToDisk?: () => void;
}

type FilterTab = 'all' | 'pending' | 'completed' | 'error';
type ClearType = 'all' | 'pending' | 'completed' | 'error';

export function DownloadDrawer({
  isOpen,
  onClose,
  tasks,
  onRemoveTask,
  onClearTasks,
  isPaused,
  onTogglePause,
  pendingCount,
  downloadingCount,
  hasSavePath,
  saveToDisk,
  onToggleSaveToDisk,
}: DownloadDrawerProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [clearMenuOpen, setClearMenuOpen] = useState(false);

  const sortedTasks = [...tasks].sort((a, b) => {
    const order = { downloading: 0, completed: 1, error: 1, pending: 2 };
    const diff = order[a.status] - order[b.status];
    if (diff !== 0) return diff;
    // pending: 老的先（asc）；完成/失败: 最近完成的先（desc finishedTime）
    if (a.status === 'pending') return a.startTime - b.startTime;
    return (b.finishedTime || b.startTime) - (a.finishedTime || a.startTime);
  });

  const filteredTasks = filter === 'all'
    ? sortedTasks
    : filter === 'pending'
      ? sortedTasks.filter(t => t.status === 'pending' || t.status === 'downloading')
      : sortedTasks.filter(t => t.status === filter);

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const errorCount = tasks.filter(t => t.status === 'error').length;

  const handleFailedClick = (task: DownloadTask) => {
    const q = `${task.musicItem.artist} - ${task.musicItem.title}`.replace(/\s+/g, ' ').trim();
    window.dispatchEvent(new CustomEvent('trigger-coco-search', { detail: q }));
    onClose();
  };

  const executeClear = (type: ClearType) => {
    const labelMap: Record<ClearType, string> = {
      all: '全部', pending: '待下载', completed: '仅成功', error: '仅失败',
    };
    if (!confirm(`确定清空「${labelMap[type]}」任务吗？此操作不可撤销。`)) return;
    onClearTasks(type);
    setClearMenuOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white dark:bg-slate-900 shadow-2xl z-[70] border-l border-slate-100 dark:border-slate-800 flex flex-col pb-24"
          >
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Download className="w-5 h-5 text-sky-500" />
                    {downloadingCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                    )}
                  </div>
                  <h2 className="font-bold text-slate-800 dark:text-slate-100">下载任务</h2>
                </div>
                <div className="flex items-center gap-1">
                  {/* 暂停/继续 */}
                  {(pendingCount > 0 || downloadingCount > 0) && (
                    <button
                      onClick={onTogglePause}
                      className={cn(
                        'p-2 rounded-full transition-colors text-sm',
                        isPaused
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'
                      )}
                      title={isPaused ? '继续下载' : '暂停下载'}
                    >
                      {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>
                  )}
                  {/* NAS 存盘切换 */}
                  {hasSavePath && onToggleSaveToDisk && (
                    <button
                      onClick={onToggleSaveToDisk}
                      className={cn(
                        'px-2 py-1 rounded-full text-[10px] font-medium transition-colors border',
                        saveToDisk
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 border-emerald-200 dark:border-emerald-800/30'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                      )}
                      title={saveToDisk ? '存到 NAS' : '浏览器下载'}
                    >
                      {saveToDisk ? '💾' : '🌐'}
                    </button>
                  )}
                  {/* 清空菜单 */}
                  {tasks.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setClearMenuOpen(!clearMenuOpen)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors flex items-center gap-0.5 text-xs cursor-pointer"
                        title="清空"
                      >
                        <Trash2 className="w-4 h-4" />
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      {clearMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-lg z-50 py-1 min-w-[120px]">
                          {([['all','全部'], ['pending','待下载'], ['completed','仅成功'], ['error','仅失败']] as [ClearType, string][]).map(([type, label]) => (
                            <button
                              key={type}
                              onClick={() => executeClear(type)}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
                            >
                              清空 {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                {([
                  { label: '总计', count: tasks.length, color: 'text-slate-600 dark:text-slate-300' },
                  { label: '成功', count: completedCount, color: 'text-green-500' },
                  { label: '失败', count: errorCount, color: 'text-red-500' },
                  { label: '待下', count: pendingCount + downloadingCount, color: 'text-sky-500' },
                ]).map(s => (
                  <div key={s.label} className="text-center bg-white dark:bg-slate-800 rounded-lg py-1.5 border border-slate-100 dark:border-slate-700">
                    <div className={cn("text-lg font-bold", s.color)}>{s.count}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-1 mt-3">
                {([
                  { key: 'all' as FilterTab, label: '全部' },
                  { key: 'pending' as FilterTab, label: '待下载' },
                  { key: 'completed' as FilterTab, label: '已完成' },
                  { key: 'error' as FilterTab, label: '失败' },
                ]).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setFilter(tab.key)}
                    className={cn(
                      "flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors cursor-pointer",
                      filter === tab.key
                        ? "bg-sky-500 text-white shadow-sm shadow-sky-500/20"
                        : "bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
                    )}
                  >
                    {tab.label}
                    {(tab.key === 'pending' && (pendingCount + downloadingCount) > 0) && (
                      <span className="ml-1 text-[10px] opacity-70">{pendingCount + downloadingCount}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Pause Banner */}
            {isPaused && (pendingCount > 0 || downloadingCount > 0) && (
              <div className="mx-4 mt-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-lg text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                <Pause className="w-3.5 h-3.5" />
                下载已暂停 · {pendingCount + downloadingCount} 首待处理
                <button onClick={onTogglePause} className="ml-auto px-2 py-0.5 bg-amber-500 text-white rounded-md text-xs hover:bg-amber-600 transition-colors">继续</button>
              </div>
            )}

            {/* Task List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredTasks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 space-y-4">
                  <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center">
                    <Download className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  </div>
                  <p>{tasks.length === 0 ? '还没有下载任务哦' : '暂无此类任务'}</p>
                </div>
              ) : (
                filteredTasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 flex gap-3 items-center group relative border border-transparent hover:border-sky-100 dark:hover:border-slate-700 transition-colors"
                  >
                    <div className="w-12 h-12 rounded-lg bg-slate-200 dark:bg-slate-700 overflow-hidden flex-shrink-0 relative">
                      {task.musicItem.cover ? (
                        <Image src={task.musicItem.cover} alt={task.musicItem.title} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><Music className="w-6 h-6 text-slate-400" /></div>
                      )}
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                        {task.status === 'completed' && <CheckCircle2 className="w-5 h-5 text-green-400" />}
                        {task.status === 'error' && <AlertCircle className="w-5 h-5 text-red-400" />}
                        {task.status === 'downloading' && <Loader2 className="w-5 h-5 text-white animate-spin" />}
                        {task.status === 'pending' && isPaused && <Pause className="w-4 h-4 text-amber-300" />}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-medium text-sm text-slate-700 dark:text-slate-200 truncate pr-2">{task.musicItem.title}</h3>
                        <span className={cn("text-xs font-medium flex-shrink-0",
                          task.status === 'completed' && "text-green-500",
                          task.status === 'error' && "text-red-500",
                          task.status === 'downloading' && "text-sky-500",
                          task.status === 'pending' && (isPaused ? "text-amber-500" : "text-slate-400")
                        )}>
                          {task.status === 'completed' ? '已完成' :
                           task.status === 'error' ? '失败' :
                           task.status === 'downloading' ? `${Math.round(task.progress)}%` :
                           isPaused ? '已暂停' : '等待中'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{task.musicItem.artist}</p>
                      <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-1">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${task.progress}%` }}
                          transition={{ duration: 0.2 }}
                          className={cn("h-full rounded-full",
                            task.status === 'completed' ? "bg-green-500" : task.status === 'error' ? "bg-red-500" : "bg-sky-500"
                          )}
                        />
                      </div>
                      {task.error && <p className="text-[10px] text-red-400 mt-1 truncate">{task.error}</p>}
                    </div>

                    <div className="flex flex-col gap-1">
                      {task.status === 'error' && (
                        <button onClick={() => handleFailedClick(task)}
                          className="p-1.5 text-slate-400 hover:text-sky-500 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-lg transition-colors" title="去单曲搜索">
                          <Search className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => onRemoveTask(task.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100" title="删除记录">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
