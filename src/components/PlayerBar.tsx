"use client";

import Image from "next/image";
import { useMemo, useRef, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Shuffle, Repeat, Repeat1 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MusicItem } from "@/types/music";
import { ConfigProvider, Slider } from "antd";

interface PlayerBarProps {
  currentMusic: MusicItem | null;
  lyric?: string;
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  playMode: "order" | "shuffle" | "single";
  onTogglePlayMode: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  hasLyric?: boolean;
}

export function PlayerBar({
  currentMusic, lyric, isPlaying, onPlayPause, onNext, onPrev,
  playMode, onTogglePlayMode, currentTime, duration, onSeek,
  volume, onVolumeChange, hasLyric,
}: PlayerBarProps) {
  const fmt = (t?: number) => {
    const v = typeof t === "number" ? t : 0;
    if (isNaN(v)) return "00:00";
    return `${Math.floor(v/60).toString().padStart(2,"0")}:${Math.floor(v%60).toString().padStart(2,"0")}`;
  };
  const modeIcon = playMode === "single" ? Repeat1 : playMode === "shuffle" ? Shuffle : Repeat;
  const ModeIcon = modeIcon;

  // LRC 解析
  const lyricLines = useMemo(() => {
    if (!lyric) return [];
    const lines: { time: number; text: string }[] = [];
    const re = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
    for (const raw of lyric.split('\n')) {
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
  }, [lyric]);
  const activeIdx = useMemo(() => {
    for (let i = lyricLines.length - 1; i >= 0; i--) if (currentTime >= lyricLines[i].time) return i;
    return 0;
  }, [lyricLines, currentTime]);
function LrcLine({ lines, activeIdx }: { lines: { time: number; text: string }[]; activeIdx: number }) {
  const prevIdx = useRef(activeIdx);
  const shouldAnimate = prevIdx.current !== activeIdx;
  useEffect(() => { prevIdx.current = activeIdx; }, [activeIdx]);

  return (
    <div className="text-center mt-0.5">
      <div className="h-5 overflow-hidden">
        <AnimatePresence mode="popLayout">
          <motion.p
            key={activeIdx}
            initial={shouldAnimate ? { y: 16, opacity: 0 } : false}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="text-sm text-sky-600 dark:text-sky-400 font-medium truncate"
          >
            {lines[activeIdx]?.text || '\u00A0'}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="h-4 overflow-hidden mt-0.5">
        <AnimatePresence mode="popLayout">
          <motion.p
            key={`next-${activeIdx + 1}`}
            initial={shouldAnimate ? { y: 8, opacity: 0 } : false}
            animate={{ y: 0, opacity: 0.5 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="text-xs text-slate-400 dark:text-slate-500 truncate"
          >
            {lines[activeIdx + 1]?.text || '\u00A0'}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

  return (
    <ConfigProvider theme={{ token: { colorPrimary: "#0ea5e9" } }}>
      <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/40 dark:border-slate-800/40 shadow-2xl shadow-slate-200/20 dark:shadow-none">

        {/* 进度条 */}
        <div className="absolute top-0 left-0 right-0 -mt-2">
          <Slider min={0} max={duration||100} value={currentTime} onChange={onSeek}
            tooltip={{ formatter: fmt }}
            styles={{ track: { background: "#0ea5e9" }, rail: { background: "rgba(0,0,0,0.04)" } }}
            style={{ margin: 0, padding: 0, height: 3 }} />
        </div>

        <div className="flex items-center justify-center px-4 py-3 max-w-3xl mx-auto gap-4">
          {/* 封面 */}
          <div className={cn("w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden relative flex-shrink-0 shadow-sm", isPlaying && "animate-spin-slow")} style={{ animationDuration: '8s' }}>
            {currentMusic?.cover ? (
              <Image src={currentMusic.cover} alt="" fill sizes="48px" className="object-cover" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-sky-100 dark:bg-sky-900 text-sky-500 font-bold">{currentMusic?.title[0]}</div>
            )}
          </div>

          {/* 中间：信息 + 歌词 */}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2 justify-center">
              <span className="font-semibold text-slate-800 dark:text-slate-100 text-sm truncate max-w-[200px]">{currentMusic?.title}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-[120px]">{currentMusic?.artist}</span>
            </div>
            {hasLyric && <LrcLine lines={lyricLines} activeIdx={activeIdx} />}
          </div>

          {/* 播放控制 */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onPrev} disabled={!onPrev} className="p-1 text-slate-400 hover:text-sky-500 disabled:opacity-30"><SkipBack className="w-4 h-4" /></button>
            <button onClick={onPlayPause} className="w-9 h-9 rounded-full bg-sky-500 hover:bg-sky-600 text-white flex items-center justify-center active:scale-95 shadow-md shadow-sky-500/20">
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>
            <button onClick={onNext} disabled={!onNext} className="p-1 text-slate-400 hover:text-sky-500 disabled:opacity-30"><SkipForward className="w-4 h-4" /></button>
            <button onClick={onTogglePlayMode} className="p-1 text-slate-400 hover:text-sky-500" title={{ single: '单曲循环', shuffle: '随机', order: '顺序' }[playMode]}><ModeIcon className="w-3.5 h-3.5" /></button>
          </div>

          {/* 音量 + 时间 */}
          <div className="hidden md:flex items-center gap-3 flex-shrink-0">
            <button onClick={() => onVolumeChange(volume > 0 ? 0 : 1)} className="text-slate-400 hover:text-sky-500">
              {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <Slider min={0} max={1} step={0.01} value={volume} onChange={onVolumeChange}
              styles={{ track: { background: "#0ea5e9" }, rail: { background: "rgba(0,0,0,0.05)" } }} style={{ width: 60 }} />
            <span className="text-[11px] text-slate-400 tabular-nums w-20 text-right">{fmt(currentTime)} / {fmt(duration)}</span>
          </div>
        </div>
      </motion.div>
    </ConfigProvider>
  );
}
