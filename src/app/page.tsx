"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Search, Loader2, Play, Pause, Download, Check, Music, Trash2, Flame, Zap, ShieldCheck, Headphones, ExternalLink, ListMusic, Link } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { MusicItem } from "@/types/music";
import { PlayerBar } from "@/components/PlayerBar";
import { DownloadDrawer } from "@/components/DownloadDrawer";
import { DownloadTask } from "@/types/download";
import axios from "axios";

const SourceLinkButton = ({ item }: { item: MusicItem }) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    
    setLoading(true);
    try {
      const res = await fetch(`/api/url?id=${item.id}&provider=${item.provider || 'gequbao'}`);
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        alert('无法获取源链接');
      }
    } catch (error) {
      console.error(error);
      alert('获取链接失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="p-2 text-slate-400 dark:text-slate-500 hover:text-sky-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer flex items-center justify-center"
      title="打开源文件链接"
    >
      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ExternalLink className="w-5 h-5" />}
    </button>
  );
};

type PlayMode = "order" | "shuffle" | "single";
type AppMode = "search" | "playlist";

export default function Home() {
  const [mode, setMode] = useState<AppMode>("search");
  const [query, setQuery] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [playlistInfo, setPlaylistInfo] = useState<{ name: string; trackCount: number; cover?: string } | null>(null);
  const [provider, setProvider] = useState("official");
  const [results, setResults] = useState<MusicItem[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Playback State
  const [activeMusic, setActiveMusic] = useState<MusicItem | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string>('');
  const [currentLyric, setCurrentLyric] = useState<string>('');
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>("order");
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const [shuffleIndex, setShuffleIndex] = useState(-1);

  const [searched, setSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloadingCount, setDownloadingCount] = useState(0);

  // 分平台标签页
  type PlatformTab = 'netease' | 'qq' | 'kuwo' | 'kugou';
  const [byPlatform, setByPlatform] = useState<Record<string, MusicItem[]>>({});
  const [activePlatformTab, setActivePlatformTab] = useState<PlatformTab>('netease');

  // 切换标签时同步 results
  useEffect(() => {
    setResults(byPlatform[activePlatformTab] || []);
    setSelectedIds(new Set());
  }, [byPlatform, activePlatformTab]);
  
  // Pagination State（-1 表示「全部」）
  const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState(1);

  // 结果变化时回到第 1 页
  useEffect(() => { setCurrentPage(1); }, [results]);

  const isAll = pageSize === -1 || pageSize >= results.length;
  const effectivePageSize = isAll ? results.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(results.length / effectivePageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedResults = isAll
    ? results
    : results.slice((safePage - 1) * effectivePageSize, safePage * effectivePageSize);

  // Download Manager State
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [downloadEnabled, setDownloadEnabled] = useState(true);

  const openSourceUrl = async (item: MusicItem) => {
    const res = await fetch(
      `/api/url?id=${encodeURIComponent(item.id)}&provider=${encodeURIComponent(item.provider || "gequbao")}`
    );
    const data = await res.json();
    if (data?.url) {
      window.open(data.url, "_blank");
      return;
    }
    throw new Error("Failed to get source url");
  };

  const buildShuffleOrder = (ids: string[]) => {
    const next = [...ids];
    for (let i = next.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    setSearched(true);
    setResults([]);
    setSelectedIds(new Set());
    setPlaylistInfo(null);
    
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&provider=${provider}`);
      const data = await res.json();
      setResults(data.items || []);
      // 分平台结果，默认切换到第一个有结果的平台
      if (data.byPlatform) {
        setByPlatform(data.byPlatform);
        const firstWithResults = (['netease', 'qq', 'kuwo', 'kugou'] as const)
          .find(p => data.byPlatform[p]?.length > 0);
        if (firstWithResults) setActivePlatformTab(firstWithResults);
      } else {
        setByPlatform({});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ── 歌单解析 ──
  const handlePlaylistParse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playlistUrl.trim()) return;
    
    setLoading(true);
    setSearched(true);
    setResults([]);
    setSelectedIds(new Set());
    setPlaylistInfo(null);
    
    try {
      const res = await fetch(`/api/playlist?url=${encodeURIComponent(playlistUrl)}`);
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      setPlaylistInfo(data.info);
      setResults(data.items || []);
    } catch (err) {
      console.error(err);
      alert('歌单解析失败，请检查链接是否有效');
    } finally {
      setLoading(false);
    }
  };

  const syncShuffleIndex = (id: string) => {
    const index = shuffleOrder.indexOf(id);
    if (index >= 0) {
      setShuffleIndex(index);
      return;
    }
    if (results.length > 0) {
      const ids = results.map(r => r.id);
      const nextOrder = buildShuffleOrder(ids);
      setShuffleOrder(nextOrder);
      setShuffleIndex(nextOrder.indexOf(id));
    } else {
      setShuffleIndex(-1);
    }
  };

  const getNextIndexById = (id: string) => {
    if (playMode === "shuffle") {
      const order = shuffleOrder.length > 0 ? shuffleOrder : results.map(r => r.id);
      const orderIndex = order.indexOf(id);
      if (orderIndex >= 0 && orderIndex < order.length - 1) {
        const nextId = order[orderIndex + 1];
        return results.findIndex(r => r.id === nextId);
      }
      return -1;
    }
    const index = results.findIndex(r => r.id === id);
    if (index >= 0 && index < results.length - 1) {
      return index + 1;
    }
    return -1;
  };

  const handlePlay = async (item: MusicItem) => {
    if (activeMusic?.id === item.id) {
      if (playing) {
        audioRef.current?.pause();
        setPlaying(false);
      } else {
        audioRef.current?.play();
        setPlaying(true);
      }
      return;
    }

    try {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      setActiveMusic(item);
      setCurrentLyric('');
      syncShuffleIndex(item.id);
      setPlaying(false); // Wait for load
      setCurrentTime(0);
      setCurrentLyric('');

      // 歌单曲目用 POST 传 extra（歌曲信息用于歌词解析）
      const isPlaylist = item.id.match(/^(netease|qq|kugou|kuwo):/);
      let data;
      if (isPlaylist && item.extra) {
        const res = await fetch('/api/url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, provider: item.provider || 'gequbao', extra: item.extra }),
        });
        data = await res.json();
      } else {
        const res = await fetch(`/api/url?id=${item.id}&provider=${item.provider || 'gequbao'}`);
        data = await res.json();
      }
      
      if (data.url && audioRef.current) {
        // 如果返回了封面，更新当前播放歌曲的封面
        if (data.cover) {
          setActiveMusic(prev => prev ? { ...prev, cover: data.cover } : item);
        }
        
        // 缓存已解析的 URL，下载时复用
        setResolvedUrl(data.url);
        if (data.lyric) { setCurrentLyric(data.lyric); }
        audioRef.current.src = data.url;
        audioRef.current.load();
        audioRef.current.play()
          .then(() => setPlaying(true))
          .catch(e => {
            console.error("Play failed", e);
            const nextIndex = getNextIndexById(item.id);
            if (nextIndex >= 0) {
              handlePlay(results[nextIndex]);
            } else {
              setActiveMusic(null);
              setPlaying(false);
            }
          });
      } else {
        const nextIndex = getNextIndexById(item.id);
        if (nextIndex >= 0) {
          handlePlay(results[nextIndex]);
        } else {
          setActiveMusic(null);
          setPlaying(false);
        }
      }
    } catch (err) {
      console.error(err);
      const nextIndex = getNextIndexById(item.id);
      if (nextIndex >= 0) {
        handlePlay(results[nextIndex]);
      } else {
        setActiveMusic(null);
        setPlaying(false);
      }
    }
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  useEffect(() => {
    const ids = results.map(r => r.id);
    if (ids.length === 0) {
      setShuffleOrder([]);
      setShuffleIndex(-1);
      return;
    }
    setShuffleOrder(buildShuffleOrder(ids));
  }, [results]);

  useEffect(() => {
    if (!activeMusic) {
      setShuffleIndex(-1);
      return;
    }
    const index = shuffleOrder.indexOf(activeMusic.id);
    setShuffleIndex(index);
  }, [activeMusic, shuffleOrder]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const env = (window as Window & { __COCO_ENV?: { ENABLE_DOWNLOAD?: string } }).__COCO_ENV;
    if (env?.ENABLE_DOWNLOAD === "0") {
      setDownloadEnabled(false);
      return;
    }
    if (env?.ENABLE_DOWNLOAD === "1") {
      setDownloadEnabled(true);
    }
  }, []);

  const listGridTemplate = downloadEnabled
    ? "grid-cols-[40px_1fr_40px] md:grid-cols-[50px_2fr_1.5fr_120px]"
    : "grid-cols-[1fr_40px] md:grid-cols-[2fr_1.5fr_80px]";

  /** 从 Content-Disposition 头解析文件名 */
  const extractFilename = (disposition: string | undefined, fallback: string): string => {
    if (!disposition) return fallback;
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/);
    if (utf8Match) return decodeURIComponent(utf8Match[1]);
    const plainMatch = disposition.match(/filename="([^"]+)"/);
    return plainMatch ? plainMatch[1] : fallback;
  };

  const executeDownload = async (task: DownloadTask) => {
    try {
      setDownloadTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: 'downloading' } : t
      ));

      if (!downloadEnabled) {
        await openSourceUrl(task.musicItem);
        setDownloadTasks(prev =>
          prev.map(t => (t.id === task.id ? { ...t, status: "completed", progress: 100 } : t))
        );
        return;
      }

      // 构造元数据
      const item = task.musicItem;
      const meta: Record<string, string | undefined> = {
        title: item.title,
        artist: item.artist,
        album: item.album,
        coverUrl: item.cover,
      };
      // 如果是当前播放的歌曲且 URL 已解析，直接复用
      if (activeMusic?.id === item.id && resolvedUrl) {
        meta._preResolvedUrl = resolvedUrl;
      }
      // 如果是当前播放的歌曲，附上已获取的歌词
      if (activeMusic?.id === item.id && currentLyric) {
        meta.lyric = currentLyric;
      }

      // 统一走 POST，后端嵌入元数据
      const response = await axios.post('/api/download', {
        id: item.id,
        provider: item.provider || 'gequbao',
        filename: task.fileName,
        meta,
      }, {
        responseType: 'blob',
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = (progressEvent.loaded / progressEvent.total) * 100;
            setDownloadTasks(prev => prev.map(t =>
              t.id === task.id ? { ...t, progress: percent } : t
            ));
          }
        },
      });

      // 用后端返回的文件名（含正确扩展名）
      const disposition = response.headers['content-disposition'] as string | undefined;
      const downloadFilename = extractFilename(disposition, task.fileName);

      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = downloadFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

      setDownloadTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: 'completed', progress: 100 } : t
      ));

    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'Download failed';
      setDownloadTasks(prev => prev.map(t => 
        t.id === task.id ? { ...t, status: 'error', error: errorMessage } : t
      ));
    }
  };

  const downloadOne = async (item: MusicItem) => {
    const taskId = `${item.id}-${Date.now()}`;
    const cleanTitle = item.title.replace(/\s+/g, ' ').trim();
    const cleanArtist = (item.artist && item.artist !== '未知歌手') ? item.artist.replace(/\s+/g, ' ').trim() : '';
    const filename = cleanArtist ? `${cleanTitle} - ${cleanArtist}.mp3` : `${cleanTitle}.mp3`;

    // Add initial task
    const newTask: DownloadTask = {
      id: taskId,
      musicItem: item,
      status: 'pending',
      progress: 0,
      fileName: filename,
      startTime: Date.now()
    };

    setDownloadTasks(prev => [newTask, ...prev]);
    setIsDrawerOpen(true);
    
    // Execute immediately for single download
    await executeDownload(newTask);
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === results.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.map(r => r.id)));
    }
  };

  const handleBatchDownload = async () => {
    const items = results.filter(r => selectedIds.has(r.id));
    if (items.length === 0) return;
    
    if (items.length > 5) {
      if (!confirm(`即将下载 ${items.length} 首歌曲，可能需要一些时间，是否继续？`)) return;
    }

    // 1. Create all tasks immediately
    const newTasks: DownloadTask[] = items.map(item => {
      const cleanTitle = item.title.replace(/\s+/g, ' ').trim();
      const cleanArtist = (item.artist && item.artist !== '未知歌手') ? item.artist.replace(/\s+/g, ' ').trim() : '';
      return {
        id: `${item.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        musicItem: item,
        status: 'pending',
        progress: 0,
        fileName: cleanArtist ? `${cleanTitle} - ${cleanArtist}.mp3` : `${cleanTitle}.mp3`,
        startTime: Date.now()
      };
    });

    // 2. Add to state
    setDownloadTasks(prev => [...newTasks, ...prev]);
    setIsDrawerOpen(true);
    setDownloadingCount(items.length);

    // 3. Process with concurrency limit
    const CONCURRENCY_LIMIT = 3;
    const queue = [...newTasks];
    const activePromises: Promise<void>[] = [];

    const processQueue = async () => {
      while (queue.length > 0) {
        if (activePromises.length >= CONCURRENCY_LIMIT) {
          await Promise.race(activePromises);
        }
        
        const task = queue.shift();
        if (task) {
          const promise = executeDownload(task).then(() => {
            setDownloadingCount(prev => Math.max(0, prev - 1));
            // Remove self from active promises
            const index = activePromises.indexOf(promise);
            if (index > -1) activePromises.splice(index, 1);
          });
          activePromises.push(promise);
        }
      }
      // Wait for remaining
      await Promise.all(activePromises);
    };

    await processQueue();
    setDownloadingCount(0);
  };

  const currentIndex = activeMusic ? results.findIndex(r => r.id === activeMusic.id) : -1;
  const getNextIndex = () => {
    if (!activeMusic) return -1;
    if (playMode === "shuffle") {
      if (shuffleIndex >= 0 && shuffleIndex < shuffleOrder.length - 1) {
        const nextId = shuffleOrder[shuffleIndex + 1];
        return results.findIndex(r => r.id === nextId);
      }
      return -1;
    }
    if (currentIndex >= 0 && currentIndex < results.length - 1) {
      return currentIndex + 1;
    }
    return -1;
  };

  const getPrevIndex = () => {
    if (!activeMusic) return -1;
    if (playMode === "shuffle") {
      if (shuffleIndex > 0) {
        const prevId = shuffleOrder[shuffleIndex - 1];
        return results.findIndex(r => r.id === prevId);
      }
      return -1;
    }
    if (currentIndex > 0) {
      return currentIndex - 1;
    }
    return -1;
  };

  const canNext = getNextIndex() >= 0;
  const canPrev = getPrevIndex() >= 0;

  const handleNext = () => {
    const nextIndex = getNextIndex();
    if (nextIndex >= 0) handlePlay(results[nextIndex]);
  };
  const handlePrev = () => {
    const prevIndex = getPrevIndex();
    if (prevIndex >= 0) handlePlay(results[prevIndex]);
  };

  const togglePlayMode = () => {
    setPlayMode(prev => {
      if (prev === "order") return "shuffle";
      if (prev === "shuffle") return "single";
      return "order";
    });
  };

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      if (playing) audio.play().catch(() => setPlaying(false));
    };
    const handleEnded = () => {
      if (playMode === "single") {
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play()
            .then(() => setPlaying(true))
            .catch(() => setPlaying(false));
        }
        return;
      }
      const nextIndex = getNextIndex();
      if (nextIndex >= 0) {
        handlePlay(results[nextIndex]);
      } else {
        setPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [playing, playMode, results, activeMusic, shuffleIndex, shuffleOrder, getNextIndex, handlePlay]);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 font-sans selection:bg-sky-100 dark:selection:bg-sky-900 pb-32 transition-colors duration-300">
      <div className="container mx-auto px-4 py-12 flex flex-col items-center">
        
        {/* Header Area */}
        <motion.div 
          layout
          className={cn(
            "flex flex-col items-center justify-center transition-all duration-500 w-full",
            searched ? "mt-0 mb-8" : "mt-[10vh] mb-12"
          )}
        >
          <div className="flex items-center gap-3 mb-4">
             <span className="px-3 py-1 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-600 dark:text-sky-300 text-xs font-bold tracking-wider uppercase">
               v3.0 畅享版
             </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-slate-800 dark:text-slate-100 tracking-tight mb-4 text-center">
            COCO音乐下载站
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-lg mb-8 max-w-lg text-center leading-relaxed hidden md:block">
            您的专属高品质音乐获取助手，支持多平台搜索，
            <br />
            极速解析，批量下载，纯净无广。
          </p>
          
          {/* ── 模式切换 Pill ── */}
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-full p-1 mb-6">
            <button
              onClick={() => { setMode("search"); setSearched(false); setResults([]); setPlaylistInfo(null); }}
              className={cn(
                "px-6 py-2 rounded-full text-sm font-medium transition-all duration-200",
                mode === "search"
                  ? "bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              <Search className="w-4 h-4 inline mr-1.5" />搜索
            </button>
            <button
              onClick={() => { setMode("playlist"); setSearched(false); setResults([]); setPlaylistInfo(null); }}
              className={cn(
                "px-6 py-2 rounded-full text-sm font-medium transition-all duration-200",
                mode === "playlist"
                  ? "bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              <ListMusic className="w-4 h-4 inline mr-1.5" />歌单
            </button>
          </div>

          {/* ── 搜索模式 ── */}
          {mode === "search" && <>
          
          {/* Provider Selector */}
          <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">
             <Music className="w-4 h-4" />
             <span>选择搜索来源:</span>
          </div>
          <div className="flex justify-center mb-6 gap-3 flex-wrap">
            {[
              { id: 'official', name: '⚡ 官方聚合', special: true },
              { id: 'gequbao', name: '歌曲宝' },
              { id: 'gequhai', name: '歌曲海' },
              { id: 'bugu', name: '布谷' },
              { id: 'qq', name: 'QQ音乐' },
              { id: 'qqmp3', name: 'QQMP3' },
              { id: 'migu', name: '咪咕' },
              { id: 'livepoo', name: '力音' },
              { id: 'jianbin-netease', name: '煎饼-网易' },
              { id: 'jianbin-qq', name: '煎饼-qq' },
              { id: 'jianbin-kugou', name: '煎饼-酷狗' },
              { id: 'jianbin-kuwo', name: '煎饼-酷我' }
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 cursor-pointer",
                  provider === p.id
                    ? (p.special
                        ? "bg-gradient-to-r from-violet-500 to-purple-500 text-white shadow-lg shadow-purple-200 dark:shadow-none ring-2 ring-purple-200 dark:ring-purple-800 ring-offset-2 dark:ring-offset-slate-900"
                        : "bg-sky-500 text-white shadow-lg shadow-sky-200 dark:shadow-none ring-2 ring-sky-200 dark:ring-sky-800 ring-offset-2 dark:ring-offset-slate-900")
                    : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-100 dark:border-slate-800 hover:border-sky-200 dark:hover:border-sky-700"
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
          
          {/* Search Bar */}
          <form onSubmit={handleSearch} className="relative w-full max-w-2xl group mb-6">
            <div className="absolute inset-0 bg-sky-200 dark:bg-sky-900 rounded-full blur-xl opacity-30 group-hover:opacity-50 transition-opacity duration-300"></div>
            <div className="relative bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/50 dark:shadow-none rounded-full flex items-center p-2 pr-2 border border-slate-100 dark:border-slate-800 transition-transform duration-300 hover:scale-[1.01]">
              <Search className="w-6 h-6 text-slate-400 dark:text-slate-500 ml-4" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索歌曲、歌手..."
                className="flex-1 bg-transparent border-none outline-none px-4 text-lg text-slate-700 dark:text-slate-200 placeholder:text-slate-300 dark:placeholder:text-slate-600 h-12"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-sky-500 hover:bg-sky-600 text-white rounded-full px-8 h-12 font-medium transition-all active:scale-95 disabled:opacity-70 flex items-center gap-2 cursor-pointer"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "搜索"}
              </button>
            </div>
          </form>

          {/* Hot Tags */}
          <AnimatePresence>
            {!searched && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap justify-center gap-3 text-sm text-slate-500 dark:text-slate-400"
              >
                <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span>热门搜索:</span>
                </div>
                {["周杰伦", "林俊杰", "抖音热歌", "陈奕迅", "古典音乐"].map((tag) => (
                  <span 
                    key={tag}
                    onClick={() => setQuery(tag)}
                    className="px-3 py-1 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-full cursor-pointer hover:bg-sky-50 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-sky-400 hover:border-sky-100 dark:hover:border-sky-900 transition-colors shadow-sm dark:shadow-none"
                  >
                    {tag}
                  </span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

        </>}

        </motion.div>

        {/* ── 歌单模式 ── */}
        {mode === "playlist" && <>
          <form onSubmit={handlePlaylistParse} className="relative w-full max-w-2xl group mb-6">
            <div className="absolute inset-0 bg-violet-200 dark:bg-violet-900 rounded-full blur-xl opacity-30 group-hover:opacity-50 transition-opacity duration-300"></div>
            <div className="relative flex items-center bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 rounded-full shadow-lg shadow-violet-50 dark:shadow-none px-6 py-3 overflow-hidden transition-all duration-300 group-hover:border-violet-300 dark:group-hover:border-violet-700">
              <Link className="w-5 h-5 text-violet-400 dark:text-violet-500 mr-3 flex-shrink-0" />
              <input
                type="url"
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                placeholder="粘贴歌单链接...（支持网易云/QQ/酷狗/酷我）"
                className="flex-1 bg-transparent border-none outline-none text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 text-sm"
              />
              <button
                type="submit"
                disabled={loading || !playlistUrl.trim()}
                className="ml-3 px-5 py-1.5 bg-violet-500 hover:bg-violet-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded-full text-sm font-medium transition-colors disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                解析
              </button>
            </div>
          </form>
        </>}

        {/* Features Grid - Only show when not searched */}
        <AnimatePresence>
            {!searched && results.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ delay: 0.1 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full mt-8"
              >
                 {[
                   { icon: Headphones, title: "全网聚合", desc: "支持主流音乐平台搜索，海量曲库一网打尽" },
                   { icon: Zap, title: "极速解析", desc: "毫秒级解析响应，多线程并发下载，拒绝等待" },
                   { icon: ShieldCheck, title: "纯净无广", desc: "无任何广告干扰，还原最纯粹的音乐体验" }
                 ].map((feature, i) => (
                   <div key={i} className="bg-white/50 dark:bg-slate-900/50 backdrop-blur-sm border border-slate-100 dark:border-slate-800 p-6 rounded-2xl flex flex-col items-center text-center hover:bg-white dark:hover:bg-slate-900 hover:shadow-lg hover:shadow-slate-100/50 dark:hover:shadow-none transition-all duration-300 group cursor-default">
                     <div className="w-12 h-12 bg-sky-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-sky-500 dark:text-sky-400 mb-4 group-hover:scale-110 transition-transform duration-300">
                       <feature.icon className="w-6 h-6" />
                     </div>
                     <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">{feature.title}</h3>
                     <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed">{feature.desc}</p>
                   </div>
                 ))}
              </motion.div>
            )}
        </AnimatePresence>

        {/* Footer Info - Only show when not searched */}
        <AnimatePresence>
          {!searched && results.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.2 }}
              className="mt-16 text-center text-slate-400 dark:text-slate-500 text-sm"
            >
              <p>© 2026 COCO Music v3.0</p>
              <p className="mt-2 text-xs text-slate-300 dark:text-slate-600">仅供个人学习交流使用，请勿用于商业用途</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 歌单信息横幅 ── */}
        <AnimatePresence>
          {playlistInfo && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-4xl mx-auto mb-6"
            >
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-violet-100 dark:border-violet-900/30 p-4 flex items-center gap-4 shadow-sm">
                {playlistInfo.cover ? (
                  <Image
                    src={playlistInfo.cover}
                    alt={playlistInfo.name}
                    width={64}
                    height={64}
                    className="rounded-xl object-cover flex-shrink-0"
                    unoptimized
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                    <ListMusic className="w-7 h-7 text-violet-500" />
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {playlistInfo.name}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {playlistInfo.trackCount} 首歌曲
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results List */}
        <div className="w-full max-w-4xl mx-auto flex-1">
          {/* 平台标签页 */}
          {searched && Object.keys(byPlatform).length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-1 mb-4"
            >
              {(['netease', 'qq', 'kuwo', 'kugou'] as const).map((p) => {
                const count = (byPlatform[p] || []).length;
                const isActive = activePlatformTab === p;
                return (
                  <button
                    key={p}
                    onClick={() => setActivePlatformTab(p)}
                    className={cn(
                      "relative px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer",
                      "flex items-center gap-2 border",
                      isActive
                        ? p === 'netease'
                          ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400"
                          : p === 'qq'
                          ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400"
                          : p === 'kuwo'
                          ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400"
                          : "bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800 text-sky-600 dark:text-sky-400"
                        : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:border-slate-200 dark:hover:border-slate-700",
                    )}
                  >
                    {isActive && (
                      <span className={cn(
                        "absolute inset-0 rounded-xl opacity-10",
                        p === 'netease' && "bg-red-500",
                        p === 'qq' && "bg-emerald-500",
                        p === 'kuwo' && "bg-amber-500",
                        p === 'kugou' && "bg-sky-500",
                      )} />
                    )}
                    <span className="relative">
                      {p === 'netease' ? '网易云' : p === 'qq' ? 'QQ' : p === 'kuwo' ? '酷我' : '酷狗'}
                    </span>
                    <span className={cn(
                      "relative text-xs px-1.5 py-0.5 rounded-full",
                      isActive
                        ? "bg-white/60 dark:bg-white/10"
                        : "bg-slate-100 dark:bg-slate-800",
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          )}
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div 
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-slate-500"
              >
                <Loader2 className="w-10 h-10 animate-spin mb-4 text-sky-400" />
                <p>正在寻找动听旋律...</p>
              </motion.div>
            ) : results.length > 0 ? (
              <motion.div 
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden mb-24"
              >
                {/* List Header */}
                <div
                  className={cn(
                    "grid gap-4 p-4 border-b border-slate-50 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 text-sm font-medium text-slate-500 dark:text-slate-400",
                    listGridTemplate
                  )}
                >
                  {downloadEnabled ? (
                    <div className="flex justify-center items-center">
                      <button 
                        onClick={toggleAll}
                        className={cn(
                          "w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer",
                          selectedIds.size === results.length && results.length > 0
                            ? "bg-sky-500 border-sky-500 text-white" 
                            : "border-slate-300 dark:border-slate-600 hover:border-sky-400 dark:hover:border-sky-500"
                        )}
                      >
                        {selectedIds.size === results.length && results.length > 0 && <Check className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ) : null}
                  <div>歌曲</div>
                  <div className="hidden md:block">歌手</div>
                  <div className="text-right pr-4 md:pr-4">操作</div>
                </div>

                {/* List Items */}
                <div className="divide-y divide-slate-50 dark:divide-slate-800">
                  {pagedResults.map((item) => {
                    const isActive = activeMusic?.id === item.id;
                    const isSelected = selectedIds.has(item.id);
                    
                    return (
                      <motion.div 
                        key={item.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        onDoubleClick={() => handlePlay(item)}
                        className={cn(
                          "grid gap-4 p-4 items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all duration-200 group cursor-pointer select-none active:scale-[0.99] rounded-xl",
                          listGridTemplate,
                          isActive && "bg-sky-50/50 dark:bg-sky-900/20"
                        )}
                      >
                        {downloadEnabled ? (
                          <div className="flex justify-center items-center">
                            <button 
                              onClick={(e) => { e.stopPropagation(); toggleSelection(item.id); }}
                              className={cn(
                                "w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer",
                                isSelected 
                                  ? "bg-sky-500 border-sky-500 text-white" 
                                  : "border-slate-300 dark:border-slate-600 hover:border-sky-400 dark:hover:border-sky-500"
                              )}
                            >
                              {isSelected && <Check className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        ) : null}

                        <div className="flex items-center gap-3 overflow-hidden">
                          <div 
                            onClick={(e) => { e.stopPropagation(); handlePlay(item); }}
                            className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden flex-shrink-0 cursor-pointer relative group/cover"
                          >
                            {item.cover ? (
                              <Image
                                src={item.cover}
                                alt={item.title}
                                fill
                                sizes="40px"
                                className="object-cover"
                                unoptimized
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-500">
                                <Music className="w-5 h-5" />
                              </div>
                            )}
                            <div className={cn(
                              "absolute inset-0 bg-black/20 flex items-center justify-center transition-opacity",
                              isActive ? "opacity-100" : "opacity-0 group-hover/cover:opacity-100"
                            )}>
                              {isActive && playing ? (
                                <Pause className="w-4 h-4 text-white fill-current" />
                              ) : (
                                <Play className="w-4 h-4 text-white fill-current" />
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col min-w-0 overflow-hidden">
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                "font-medium truncate",
                                isActive ? "text-sky-600 dark:text-sky-400" : "text-slate-700 dark:text-slate-200"
                              )}>
                                {item.title}
                              </span>
                            </div>
                            <span className="text-xs text-slate-400 dark:text-slate-500 truncate md:hidden block mt-0.5">
                              {item.artist}
                            </span>
                          </div>
                        </div>

                        <div className="text-slate-500 dark:text-slate-400 truncate text-sm hidden md:block">
                          {item.artist}
                        </div>

                        <div className="flex justify-end pr-2 md:pr-2 gap-2">
                          <SourceLinkButton item={item} />
                          {downloadEnabled ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); downloadOne(item); }}
                              className="p-2 text-slate-400 dark:text-slate-500 hover:text-sky-500 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 rounded-full transition-colors cursor-pointer"
                              title="下载"
                            >
                              <Download className="w-5 h-5" />
                            </button>
                          ) : null}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Pagination Bar */}
                {!isAll && results.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-slate-50 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20">
                    {/* 左侧：每页条数 */}
                    <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                      <span>每页</span>
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="appearance-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-sm text-slate-700 dark:text-slate-300 cursor-pointer hover:border-sky-300 dark:hover:border-sky-600 transition-colors outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30"
                      >
                        {PAGE_SIZE_OPTIONS.map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                        <option value={-1}>全部</option>
                      </select>
                      <span>条</span>
                    </div>

                    {/* 中间：条目信息 */}
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {(safePage - 1) * effectivePageSize + 1}–{Math.min(safePage * effectivePageSize, results.length)} / 共 {results.length} 条
                    </span>

                    {/* 右侧：翻页按钮 */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={safePage <= 1}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                      >
                        ‹
                      </button>
                      {/* 页码按钮 */}
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(p => {
                          // 显示首尾 + 当前页附近
                          if (p === 1 || p === totalPages) return true;
                          if (Math.abs(p - safePage) <= 2) return true;
                          return false;
                        })
                        .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                          if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                            acc.push('ellipsis');
                          }
                          acc.push(p);
                          return acc;
                        }, [])
                        .map((item, idx) =>
                          item === 'ellipsis' ? (
                            <span key={`e-${idx}`} className="w-8 h-8 flex items-center justify-center text-slate-300 dark:text-slate-600 text-xs">…</span>
                          ) : (
                            <button
                              key={item}
                              onClick={() => setCurrentPage(item)}
                              className={`w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-colors ${
                                item === safePage
                                  ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/20'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              {item}
                            </button>
                          )
                        )}
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={safePage >= totalPages}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                      >
                        ›
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            ) : searched ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-20 text-slate-400 dark:text-slate-500"
              >
                <p>未找到相关歌曲，换个关键词试试？</p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      {downloadEnabled ? (
        <DownloadDrawer
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          tasks={downloadTasks}
          onRemoveTask={(taskId) => setDownloadTasks(prev => prev.filter(t => t.id !== taskId))}
          onClearCompleted={() => setDownloadTasks(prev => prev.filter(t => t.status === 'downloading' || t.status === 'pending'))}
        />
      ) : null}

      {/* Floating Download Toggle Button (Bottom Right) */}
      <AnimatePresence>
        {downloadEnabled && !isDrawerOpen && downloadTasks.length > 0 && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onClick={() => setIsDrawerOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-sky-500 hover:bg-sky-600 text-white rounded-full shadow-lg shadow-sky-500/30 flex items-center justify-center transition-all active:scale-95 group"
          >
            <div className="relative">
               <Download className="w-6 h-6" />
               {downloadTasks.some(t => t.status === 'downloading') && (
                 <span className="absolute -top-1 -right-1 flex h-3 w-3">
                   <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                   <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                 </span>
               )}
            </div>
            {/* Tooltip */}
            <span className="absolute right-full mr-4 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              查看下载任务
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Floating Batch Action Bar */}
      <AnimatePresence>
        {downloadEnabled && selectedIds.size > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-24 left-0 right-0 flex justify-center z-40 pointer-events-none"
          >
            <div className="bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 rounded-full px-6 py-3 flex items-center gap-6 pointer-events-auto">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
                已选择 <span className="text-sky-600 dark:text-sky-400 font-bold">{selectedIds.size}</span> 首歌曲
              </span>
              
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700"></div>

              <button 
                onClick={handleBatchDownload}
                disabled={downloadingCount > 0}
                className="flex items-center gap-2 text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 font-medium text-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {downloadingCount > 0 ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    剩余 {downloadingCount} 首...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    批量下载
                  </>
                )}
              </button>

              <button 
                onClick={() => setSelectedIds(new Set())}
                className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Player Bar */}
      <AnimatePresence>
        {activeMusic && (
          <PlayerBar 
            currentMusic={activeMusic}
            lyric={currentLyric}
            isPlaying={playing}
            onPlayPause={() => {
              if (playing) {
                audioRef.current?.pause();
                setPlaying(false);
              } else {
                audioRef.current?.play();
                setPlaying(true);
              }
            }}
            onNext={canNext ? handleNext : undefined}
            onPrev={canPrev ? handlePrev : undefined}
            playMode={playMode}
            onTogglePlayMode={togglePlayMode}
            currentTime={currentTime}
            duration={duration}
            onSeek={handleSeek}
            volume={volume}
            onVolumeChange={setVolume}
            hasLyric={!!currentLyric}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
