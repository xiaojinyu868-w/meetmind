'use client';

// wavesurfer.js 音频播放器组件
// 复用 wavesurfer.js (10k stars) 实现波形可视化
// 支持离线回放时添加红点标注

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle, type Ref } from 'react';
import { HelpCircle } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import { formatTimestampMs } from '@/lib/longcut';
import { cn } from '@/lib/utils';
import { db } from '@/lib/db';
import { COPY } from '@/lib/ui/copy';

// 简化的 Anchor 类型，兼容不同来源
export interface WaveformAnchor {
  id?: string | number;
  timestamp: number;
  status?: 'active' | 'resolved' | 'pending';
  resolved?: boolean;
  type?: 'confusion' | 'important' | 'question';
}

export interface WaveformPlayerRef {
  play: () => void;
  pause: () => void;
  playPause: () => void;
  seekTo: (timeMs: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setPlaybackRate: (rate: number) => void;
  isPlaying: () => boolean;
}

export interface WaveformPlayerProps {
  /** 音频 URL 或 Blob */
  src?: string | Blob;
  /** 困惑点列表 */
  anchors?: WaveformAnchor[];
  /** 时间变化回调 */
  onTimeUpdate?: (timeMs: number) => void;
  /** 点击困惑点回调 */
  onAnchorClick?: (anchor: WaveformAnchor) => void;
  /** 播放状态变化回调 */
  onPlayStateChange?: (isPlaying: boolean) => void;
  /** 加载完成回调 */
  onReady?: (duration: number) => void;
  /** 新增困惑点回调（回放时标注） */
  onAnchorAdd?: (timestamp: number) => void;
  /** 波形颜色 */
  waveColor?: string;
  /** 进度颜色 */
  progressColor?: string;
  /** 高度 */
  height?: number;
  /** 是否显示控制栏 */
  showControls?: boolean;
  /** 是否允许回放时添加标注 */
  allowAddAnchor?: boolean;
  /** 当前选中的困惑点 ID */
  selectedAnchorId?: string | number;
  /** 紧凑模式 - 高度减半，隐藏图例 */
  compact?: boolean;
  /** dynamic() 外壳不能接 React ref；用普通 prop 穿过 LoadableComponent。 */
  playerRef?: Ref<WaveformPlayerRef>;
  /** 波形峰值缓存键（sessionId）：命中缓存或云端 peaks 时跳过整段解码 */
  peaksCacheKey?: string;
}

export const WaveformPlayer = forwardRef<WaveformPlayerRef, WaveformPlayerProps>(({
  src,
  anchors = [],
  onTimeUpdate,
  onAnchorClick,
  onPlayStateChange,
  onReady,
  onAnchorAdd,
  waveColor = '#6D9C89',      // v7 --mm-pine-light（声波 = AI 沉淀的轨迹）
  progressColor = '#2F6B55',  // v7 --mm-pine 主签名（已播放部分 = 已沉淀）
  height: heightProp,
  showControls = true,
  allowAddAnchor = false,
  selectedAnchorId,
  compact = false,
  playerRef,
  peaksCacheKey,
}, forwardedRef) => {
  // 紧凑模式下高度减半
  const height = heightProp ?? (compact ? 40 : 80);
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [isPlayingState, setIsPlayingState] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showAddHint, setShowAddHint] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0); // 新增：加载进度
  const peaksCacheKeyRef = useRef<string | undefined>(peaksCacheKey);
  peaksCacheKeyRef.current = peaksCacheKey;
  /** 本次加载是否用了预生成 peaks（用了就不需要在 ready 后再解码导出） */
  const usedProvidedPeaksRef = useRef(false);

  // 暴露方法给父组件
  useImperativeHandle(playerRef ?? forwardedRef, () => ({
    play: () => wavesurferRef.current?.play(),
    pause: () => wavesurferRef.current?.pause(),
    playPause: () => wavesurferRef.current?.playPause(),
    seekTo: (timeMs: number) => {
      if (wavesurferRef.current && duration > 0) {
        const ws = wavesurferRef.current;
        const wasPlaying = ws.isPlaying();
        if (wasPlaying) {
          ws.pause();
        }
        ws.seekTo(timeMs / 1000 / (duration / 1000));
        if (wasPlaying) {
          ws.play();
        }
      }
    },
    getCurrentTime: () => (wavesurferRef.current?.getCurrentTime() ?? 0) * 1000,
    getDuration: () => (wavesurferRef.current?.getDuration() ?? 0) * 1000,
    setPlaybackRate: (rate: number) => {
      wavesurferRef.current?.setPlaybackRate(rate);
      setPlaybackRateState(rate);
    },
    isPlaying: () => wavesurferRef.current?.isPlaying() ?? false,
  }));

  // 初始化 wavesurfer - 组件挂载后立即初始化
  useEffect(() => {
    if (!containerRef.current) return;

    // 创建 Regions 插件
    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    // 创建 WaveSurfer 实例
    // 优化：使用 MediaElement 后端，支持流式加载（边下边播）
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor,
      progressColor,
      cursorColor: '#C45E4C',  // v7 --mm-vermilion 朱批红（光标 = 此刻）
      height,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      normalize: true,
      backend: 'MediaElement', // 使用 MediaElement 后端，支持流式加载
      plugins: [regions],
    });

    // 事件监听
    ws.on('ready', () => {
      const dur = ws.getDuration() * 1000;
      setDuration(dur);
      setIsReady(true);
      setLoadError(false);
      setLoadProgress(100);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      // 首次解码完成后导出波形峰值写入缓存——下次进复习页直接跳过整段解码
      const cacheKey = peaksCacheKeyRef.current;
      if (cacheKey && !usedProvidedPeaksRef.current) {
        try {
          const exported = ws.exportPeaks({ channels: 1, maxLength: 800, precision: 1000 });
          const peaks = exported[0];
          if (peaks?.length) {
            void db.audioSessions.where('sessionId').equals(cacheKey).modify({
              waveformPeaks: peaks,
              waveformPeaksDurationSec: ws.getDuration(),
            });
          }
        } catch {
          // best effort：缓存写不进去不影响播放
        }
      }
      onReady?.(dur);
    });

    // 加载失败兜底：audioUrl 失效 / 跨域 / 网络错误时，wavesurfer 默认只抛 console，
    // isReady 永远 false 会卡死在"加载音频..."。这里捕获 error 让 UI 能跳出。
    ws.on('error', () => {
      setIsReady(false);
      setLoadProgress(0);
      setLoadError(true);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    });

    // 监听加载进度
    ws.on('loading', (percent: number) => {
      setLoadProgress(percent);
    });

    ws.on('timeupdate', (time) => {
      const timeMs = time * 1000;
      setCurrentTime(timeMs);
      onTimeUpdate?.(timeMs);
    });

    ws.on('play', () => {
      setIsPlayingState(true);
      onPlayStateChange?.(true);
    });

    ws.on('pause', () => {
      setIsPlayingState(false);
      onPlayStateChange?.(false);
    });

    ws.on('finish', () => {
      setIsPlayingState(false);
      onPlayStateChange?.(false);
    });

    // 点击波形跳转并播放
    ws.on('interaction', () => {
      ws.play();
    });

    wavesurferRef.current = ws;

    // 清理函数
    return () => {
      const wsInstance = wavesurferRef.current;
      wavesurferRef.current = null;
      regionsRef.current = null;
      
      if (wsInstance) {
        // 静默暂停
        try {
          if (wsInstance.isPlaying()) {
            wsInstance.pause();
          }
        } catch {
          // 忽略暂停时的错误
        }
        
        // 使用全局事件监听器捕获并静默处理 AbortError
        const handleAbortError = (event: PromiseRejectionEvent) => {
          const reason = event.reason;
          if (
            reason?.name === 'AbortError' ||
            (reason instanceof DOMException && reason.name === 'AbortError') ||
            (typeof reason === 'string' && reason.includes('abort')) ||
            reason?.message?.includes('abort')
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
        
        // 捕获同步错误的处理器
        const handleError = (event: ErrorEvent) => {
          if (event.message?.includes('abort') || event.message?.includes('AbortError')) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
        
        window.addEventListener('unhandledrejection', handleAbortError);
        window.addEventListener('error', handleError);
        
        // 使用 setTimeout 延迟销毁，给异步操作更多时间完成或取消
        setTimeout(() => {
          try {
            wsInstance.destroy();
          } catch {
            // 静默忽略所有销毁时的错误
          }
          
          // 延迟移除监听器
          setTimeout(() => {
            window.removeEventListener('unhandledrejection', handleAbortError);
            window.removeEventListener('error', handleError);
          }, 300);
        }, 50);
      }
    };
  }, [waveColor, progressColor, height, onReady, onTimeUpdate, onPlayStateChange]);

  // 加载音频
  useEffect(() => {
    if (!wavesurferRef.current || !src) return;

    // 清理旧的 URL
    if (audioUrlRef.current && audioUrlRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(audioUrlRef.current);
    }

    setIsReady(false);
    setLoadError(false);
    setCurrentTime(0);
    setDuration(0);

    // 处理 Blob 或 URL
    let url: string;
    if (src instanceof Blob) {
      url = URL.createObjectURL(src);
      audioUrlRef.current = url;
    } else {
      // 关键修复（2026-06-04）：跳过失效的 blob: URL。
      // blob: URL 只在创建它的那次页面会话有效；刷新/换设备后变成死链，
      // 直接喂给 WaveSurfer.load 会 fetch 失败抛 "ERR_FILE_NOT_FOUND / Failed to fetch"
      // 的 unhandled rejection，污染控制台也可能拖慢/卡住渲染。
      // 这种录音的可播放源应来自 IndexedDB blob（useReviewSession 会重建 objectURL）
      // 或档位2 上云后的 /api/workspace/audio URL；死 blob: 直接忽略不加载。
      if (src.startsWith('blob:')) {
        // 失效的 blob: 死链——不加载，但必须置 loadError 让 UI 显示失败态，
        // 否则 isReady=false + src 有值会永远卡在"加载音频..."（页面灰、不可点击）。
        setIsReady(false);
        setLoadError(true);
        return;
      }
      url = src;
      audioUrlRef.current = null;
    }

    let cancelled = false;
    usedProvidedPeaksRef.current = false;
    const wsInstance = wavesurferRef.current;

    void (async () => {
      // 1) 云端音频：先拿服务端预生成的 peaks，命中即跳过整段解码
      if (typeof src === 'string' && src.startsWith('/api/workspace/audio/')) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4_000);
          const resp = await fetch(
            src.replace('/api/workspace/audio/', '/api/workspace/audio-peaks/'),
            { signal: controller.signal },
          );
          clearTimeout(timer);
          if (cancelled) return;
          if (resp.ok) {
            const data = await resp.json() as { peaks?: number[]; durationSec?: number };
            if (Array.isArray(data.peaks) && data.peaks.length > 0) {
              usedProvidedPeaksRef.current = true;
              await wsInstance.load(url, [data.peaks], data.durationSec);
              return;
            }
          }
        } catch {
          // peaks 拿不到就走缓存/解码路径
        }
        if (cancelled) return;
      }

      // 2) IndexedDB 缓存的 peaks（首次解码后写入）
      const cacheKey = peaksCacheKeyRef.current;
      if (cacheKey) {
        try {
          const cached = await db.audioSessions.where('sessionId').equals(cacheKey).first();
          if (cancelled) return;
          if (cached?.waveformPeaks?.length) {
            usedProvidedPeaksRef.current = true;
            await wsInstance.load(url, [cached.waveformPeaks], cached.waveformPeaksDurationSec);
            return;
          }
        } catch {
          // 缓存读不到就走解码路径
        }
        if (cancelled) return;
      }

      // 3) 常规加载（整段解码；ready 后会把 peaks 写进缓存）
      try {
        await wsInstance.load(url);
      } catch (error: unknown) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setIsReady(false);
        setLoadProgress(0);
        setLoadError(true);
      }
    })();

    // 超时兜底：wavesurfer 的 MediaElement backend 加载失败不一定触发 'error' 事件
    // （audio onerror 可能不冒泡），导致 isReady 永远 false 卡在"加载音频..."大片灰。
    // 15s 未 ready 判定失败，让 UI 跳出失败态而非永远转圈。
    if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
    loadingTimeoutRef.current = setTimeout(() => {
      setIsReady(false);
      setLoadProgress(0);
      setLoadError(true);
    }, 15000);

    return () => {
      cancelled = true;
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      if (audioUrlRef.current && audioUrlRef.current.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
    };
  }, [src]);

  // 更新困惑点标记（红点）
  useEffect(() => {
    if (!regionsRef.current || !isReady || duration === 0) return;

    // 清除现有区域
    regionsRef.current.clearRegions();

    // 添加困惑点区域（红点标记）
    anchors.forEach((anchor, index) => {
      const startSec = anchor.timestamp / 1000;
      const endSec = Math.min(startSec + 5, duration / 1000); // 5秒区域
      
      // 判断是否已解决
      const isResolved = anchor.status === 'resolved' || anchor.resolved === true;
      // 判断是否选中
      const isSelected = selectedAnchorId !== undefined && anchor.id === selectedAnchorId;

      const region = regionsRef.current!.addRegion({
        start: startSec,
        end: endSec,
        color: isSelected
          ? 'rgba(255, 138, 128, 0.5)'  // 选中状态 - coral 珊瑚粉
          : isResolved 
            ? 'rgba(168, 230, 207, 0.4)'  // mint 薄荷绿 - 已解决
            : 'rgba(255, 138, 128, 0.3)', // coral 珊瑚粉 - 未解决
        drag: false,
        resize: false,
        id: `anchor-${anchor.id || index}`,
      });

      // 点击区域
      region.on('click', () => {
        onAnchorClick?.(anchor);
      });
    });
  }, [anchors, isReady, duration, onAnchorClick, selectedAnchorId]);

  // 播放控制
  const togglePlay = useCallback(() => {
    wavesurferRef.current?.playPause();
  }, []);

  const skipForward = useCallback(() => {
    if (wavesurferRef.current) {
      const newTime = Math.min(currentTime + 10000, duration);
      wavesurferRef.current.seekTo(newTime / duration);
    }
  }, [currentTime, duration]);

  const skipBackward = useCallback(() => {
    if (wavesurferRef.current) {
      const newTime = Math.max(currentTime - 10000, 0);
      wavesurferRef.current.seekTo(newTime / duration);
    }
  }, [currentTime, duration]);

  // 添加困惑点标注（回放时）
  const handleAddAnchor = useCallback(() => {
    if (!allowAddAnchor || !onAnchorAdd) return;
    onAnchorAdd(currentTime);
    setShowAddHint(true);
    setTimeout(() => setShowAddHint(false), 2000);
  }, [allowAddAnchor, onAnchorAdd, currentTime]);

  const cyclePlaybackRate = useCallback(() => {
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % rates.length;
    const newRate = rates[nextIndex];
    
    wavesurferRef.current?.setPlaybackRate(newRate);
    setPlaybackRateState(newRate);
  }, [playbackRate]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setVolume(value);
    setIsMuted(value === 0);
    wavesurferRef.current?.setVolume(value);
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) {
      wavesurferRef.current?.setVolume(volume || 1);
      setIsMuted(false);
    } else {
      wavesurferRef.current?.setVolume(0);
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  // 无音频时的占位
  if (!src) {
    return (
      <div className="bg-paper rounded-2xl p-8">
        <div className="flex flex-col items-center justify-center gap-3 text-ink-muted">
          <div className="w-16 h-16 bg-divider rounded-full flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          </div>
          <span className="text-sm font-medium">暂无音频</span>
          <span className="text-xs">录制课堂后将在此显示波形</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "bg-white rounded-2xl border border-divider shadow-sm overflow-hidden",
      compact && "rounded-xl"
    )}>
      {/* 波形容器 */}
      <div className={cn(
        "bg-paper relative",
        compact ? "p-2" : "p-4"
      )}>
        <div 
          ref={containerRef} 
          className="rounded-xl overflow-hidden cursor-pointer"
          style={{ minHeight: height }}
        />
        
        {/* 红点标记指示器（在波形上方显示） */}
        {isReady && anchors.length > 0 && (
          <div className="absolute top-2 left-4 right-4 h-2 pointer-events-none">
            {anchors.map((anchor, index) => {
              const position = (anchor.timestamp / duration) * 100;
              const isResolved = anchor.status === 'resolved' || anchor.resolved === true;
              const isSelected = selectedAnchorId !== undefined && anchor.id === selectedAnchorId;
              return (
                <div
                  key={anchor.id || index}
                  className={`absolute w-3 h-3 rounded-full transform -translate-x-1/2 transition-all cursor-pointer pointer-events-auto ${
                    isSelected 
                      ? 'bg-coral ring-2 ring-coral-300 ring-offset-1 scale-125 z-10' 
                      : isResolved 
                        ? 'bg-mint hover:scale-110' 
                        : 'bg-coral hover:scale-110'
                  }`}
                  style={{ left: `${position}%` }}
                  onClick={() => onAnchorClick?.(anchor)}
                  title={`困惑点 ${formatTimestampMs(anchor.timestamp)}${isResolved ? ' (已解决)' : ''}`}
                />
              );
            })}
          </div>
        )}
        
        {/* 添加标注成功提示 */}
        {showAddHint && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-coral text-white px-4 py-2 rounded-full text-sm font-medium animate-bounce">
            已标记困惑点
          </div>
        )}
      </div>

      {/* 困惑点图例 - 紧凑模式下隐藏 */}
      {!compact && anchors.length > 0 && (
        <div className="px-4 py-2 bg-paper-warm border-t border-divider-light flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-coral/30 rounded border border-coral-300" />
            <span className="text-ink-secondary">未解决困惑点</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-mint/30 rounded border border-mint-300" />
            <span className="text-ink-secondary">已解决</span>
          </div>
          <div className="flex-1" />
          <span className="text-ink-muted font-medium">共 {anchors.length} 个困惑点</span>
        </div>
      )}

      {/* 控制栏 */}
      {showControls && (
        <div className={cn(
          "bg-white border-t border-divider-light",
          compact ? "px-3 py-2" : "px-4 py-3"
        )}>
          <div className="flex items-center gap-3">
            {/* 播放控制 */}
            <div className="flex items-center gap-1">
              {/* 后退 10s - 紧凑模式下隐藏 */}
              {!compact && (
                <button
                  onClick={skipBackward}
                  disabled={!isReady}
                  className="w-10 h-10 flex items-center justify-center text-ink-muted hover:text-ink-secondary hover:bg-paper-deep rounded-xl transition-all disabled:opacity-50"
                  title="后退 10 秒"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
                  </svg>
                </button>
              )}

              {/* 播放/暂停 */}
              <button
                onClick={togglePlay}
                disabled={!isReady}
                className={cn(
                  'text-white disabled:opacity-50 transition-all flex items-center justify-center',
                  compact ? 'w-8 h-8 rounded-lg' : 'w-12 h-12 rounded-xl'
                )}
                style={compact
                  ? { background: '#1A3327' }
                  : {
                      background: 'linear-gradient(135deg, #2D4F3E 0%, #1A3327 100%)',
                      boxShadow: '0 4px 12px rgba(212, 165, 116, 0.35)'
                    }}
              >
                {isPlayingState ? (
                  <svg className={cn(compact ? "w-4 h-4" : "w-6 h-6")} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className={cn(compact ? "w-4 h-4 ml-0.5" : "w-6 h-6 ml-0.5")} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* 前进 10s - 紧凑模式下隐藏 */}
              {!compact && (
                <button
                  onClick={skipForward}
                  disabled={!isReady}
                  className="w-10 h-10 flex items-center justify-center text-ink-muted hover:text-ink-secondary hover:bg-paper-deep rounded-xl transition-all disabled:opacity-50"
                  title="前进 10 秒"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
                  </svg>
                </button>
              )}
            </div>

            {/* 时间显示 */}
            <div className={cn(
              "flex items-center gap-1.5",
              compact ? "text-xs" : "text-sm"
            )}>
              <span data-testid="waveform-current-time" className="font-mono text-ink font-medium">
                {formatTimestampMs(currentTime)}
              </span>
              <span className="text-ink-muted">/</span>
              <span className="font-mono text-ink-muted">
                {formatTimestampMs(duration)}
              </span>
            </div>

            <div className="flex-1" />

            {/* 添加困惑点按钮（回放时标注） */}
            {allowAddAnchor && onAnchorAdd && (
              <button
                onClick={handleAddAnchor}
                disabled={!isReady}
                className={cn(
                  'flex items-center gap-1.5 text-white font-medium rounded-xl disabled:opacity-50 transition-all active:scale-95',
                  compact ? 'px-2 py-1 text-xs' : 'px-4 py-2 text-sm'
                )}
                style={{ background: '#8E3328' }}
                title="标记当前位置为困惑点"
              >
                <HelpCircle size={compact ? 13 : 15} strokeWidth={1.9} aria-hidden />
                <span>标记困惑</span>
              </button>
            )}

            {/* 播放速度 */}
            <button
              onClick={cyclePlaybackRate}
              disabled={!isReady}
              className={cn(
                "font-medium text-ink-secondary hover:text-ink hover:bg-paper-deep rounded-lg transition-all disabled:opacity-50 border border-divider",
                compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
              )}
              title="播放速度"
            >
              {playbackRate}x
            </button>

            {/* 音量控制 - 紧凑模式下隐藏 */}
            {!compact && (
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMute}
                  className="w-8 h-8 flex items-center justify-center text-ink-muted hover:text-ink-secondary rounded-lg transition-colors"
                >
                  {isMuted || volume === 0 ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-20 h-1.5 bg-divider rounded-full appearance-none cursor-pointer accent-[#1C1B19]"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 加载失败兜底：避免永远卡在"加载音频..." */}
      {loadError && src ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 rounded-2xl">
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <p className="text-sm font-medium text-vermilion">{COPY.player.loadFailed}</p>
            <p className="text-xs text-ink-muted">{COPY.player.loadFailedHint}</p>
          </div>
        </div>
      ) : null}

      {/* 加载状态 - 显示进度 */}
      {!isReady && src && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 rounded-2xl">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 border-4 rounded-full" style={{ borderColor: '#E8E2D5' }} />
              <div 
                className="absolute inset-0 border-4 rounded-full animate-spin"
                style={{ 
                  clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin(loadProgress / 100 * Math.PI * 2)}% ${50 - 50 * Math.cos(loadProgress / 100 * Math.PI * 2)}%, 50% 50%)`,
                  borderColor: 'transparent',
                  borderTopColor: '#2D4F3E',
                }}
              />
            </div>
            <span className="text-sm text-ink-secondary font-medium">
              {loadProgress >= 100
                ? COPY.player.preparingWaveform
                : `${COPY.player.loadingAudio} ${loadProgress > 0 ? `${loadProgress}%` : '...'}`}
            </span>
            {/* 进度条 */}
            {loadProgress > 0 && (
              <div className="w-32 h-1.5 bg-divider rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-300"
                  style={{ 
                    width: `${loadProgress}%`,
                    background: 'linear-gradient(90deg, #2D4F3E 0%, #6B9080 100%)'
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

WaveformPlayer.displayName = 'WaveformPlayer';
