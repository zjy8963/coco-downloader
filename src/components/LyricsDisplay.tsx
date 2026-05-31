'use client';

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface LyricLine { time: number; text: string; }

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const re = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
  for (const raw of lrc.split('\n')) {
    const text = raw.replace(re, '').trim();
    if (!text) continue;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const ms = m[3].length === 2 ? parseInt(m[3]) * 10 : parseInt(m[3]);
      lines.push({ time: parseInt(m[1]) * 60 + parseInt(m[2]) + ms / 1000, text });
    }
    re.lastIndex = 0;
  }
  return lines.sort((a, b) => a.time - b.time);
}

interface Props {
  lrc: string;
  currentTime: number;
  onSeek?: (time: number) => void;
  visible: boolean;
  onToggle: () => void;
}

export function LyricsDisplay({ lrc, currentTime, onSeek, visible, onToggle }: Props) {
  const lines = useMemo(() => parseLrc(lrc), [lrc]);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const lastIdx = useRef(-1);

  const activeIndex = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i--) if (currentTime >= lines[i].time) return i;
    return 0;
  }, [lines, currentTime]);

  const scrollTo = useCallback((idx: number) => {
    if (!containerRef.current || idx === lastIdx.current) return;
    lastIdx.current = idx;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      (containerRef.current?.children[idx] as HTMLElement)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  useEffect(() => { if (visible) scrollTo(activeIndex); }, [activeIndex, visible, scrollTo]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={visible ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed bottom-24 left-0 right-0 z-40 flex justify-center pointer-events-none"
    >
      <div className="pointer-events-auto w-full max-w-lg mx-4 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 dark:border-slate-700/30 overflow-hidden" style={{ maxHeight: '45vh' }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100/50 dark:border-slate-800/50">
          <span className="text-xs font-medium text-slate-400 tracking-wide">歌词</span>
          <button onClick={onToggle} className="text-xs text-slate-300 hover:text-slate-500 transition-colors">收起</button>
        </div>

        {/* 歌词区 */}
        <div ref={containerRef} className="overflow-y-auto px-5" style={{
          scrollBehavior: 'smooth', height: 'calc(45vh - 40px)',
          maskImage: 'linear-gradient(transparent 0%, black 10%, black 90%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(transparent 0%, black 10%, black 90%, transparent 100%)',
        }}>
          <div className="h-[18vh]" />
          {lines.length === 0 && <p className="text-center text-slate-400 text-sm py-8">纯音乐，请欣赏</p>}
          {lines.map((line, i) => (
            <motion.p
              key={i}
              onClick={() => onSeek?.(line.time)}
              animate={{ scale: i === activeIndex ? 1.04 : 1, opacity: i === activeIndex ? 1 : 0.35 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={cn('text-center cursor-pointer select-none py-2 leading-relaxed',
                i === activeIndex ? 'text-sky-600 dark:text-sky-400 font-bold text-base' : 'text-slate-600 dark:text-slate-400 text-sm hover:opacity-60')}
            >
              {line.text}
            </motion.p>
          ))}
          <div className="h-[18vh]" />
        </div>
      </div>
    </motion.div>
  );
}
