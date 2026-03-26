'use client';

// wavesurfer.js 音频播放器组件
// 复用 wavesurfer.js (10k stars) 实现波形可视化
// 支持离线回放时添加红点标注

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/plugins/regions';
import { formatTimestampMs } from '@/lib/longcut';
import { cn } from '@/lib/utils';

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

interface WaveformPlayerProps {
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
}

export const WaveformPlayer = forwardRef<WaveformPlayerRef, WaveformPlayerProps>(({
  src,
  anchors = [],
  onTimeUpdate,
  onAnchorClick,
  onPlayStateChange,
  onReady,
  onAnchorAdd,
  waveColor = '#D4A574',      // dedao-gold 教育金色
  progressColor = '#F5E6D3',  // 暖米色
  height: heightProp,
  showControls = true,
  allowAddAnchor = false,
  selectedAnchorId,
  compact = false,
}, ref) => {
  // 紧凑模式下高度减半
  const height = heightProp ?? (compact ? 40 : 80);
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  
  const [isPlayingState, setIsPlayingState] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [showAddHint, setShowAddHint] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0); // 新增：加载进度

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
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
      cursorColor: '#FF8A80',  // coral 珊瑚粉
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
      setLoadProgress(100);
      onReady?.(dur);
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
    setCurrentTime(0);
    setDuration(0);

    // 处理 Blob 或 URL
    let url: string;
    if (src instanceof Blob) {
      url = URL.createObjectURL(src);
      audioUrlRef.current = url;
    } else {
      url = src;
      audioUrlRef.current = null;
    }

    wavesurferRef.current.load(url);

    return () => {
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
      <div className="bg-[#F7F7F5] rounded-2xl p-8">
        <div className="flex flex-col items-center justify-center gap-3 text-gray-400">
          <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center">
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
      "bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden",
      compact && "rounded-xl"
    )}>
      {/* 波形容器 */}
      <div className={cn(
        "bg-[#F7F7F5] relative",
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
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-coral/30 rounded border border-coral-300" />
            <span className="text-gray-600">未解决困惑点</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-mint/30 rounded border border-mint-300" />
            <span className="text-gray-600">已解决</span>
          </div>
          <div className="flex-1" />
          <span className="text-gray-400 font-medium">共 {anchors.length} 个困惑点</span>
        </div>
      )}

      {/* 控制栏 */}
      {showControls && (
        <div className={cn(
          "bg-white border-t border-gray-100",
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
                  className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-all disabled:opacity-50"
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
                  ? { background: '#CFA16E' }
                  : {
                      background: 'linear-gradient(135deg, #D4A574 0%, #C49A6C 100%)',
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
                  className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition-all disabled:opacity-50"
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
              <span data-testid="waveform-current-time" className="font-mono text-gray-900 font-medium">
                {formatTimestampMs(currentTime)}
              </span>
              <span className="text-gray-400">/</span>
              <span className="font-mono text-gray-500">
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
                style={compact
                  ? { background: '#F08E83' }
                  : {
                      background: 'linear-gradient(135deg, #FF8A80 0%, #FF574A 100%)',
                      boxShadow: '0 4px 12px rgba(255, 138, 128, 0.35)'
                    }}
                title="标记当前位置为困惑点"
              >
                <span>🎯</span>
                <span>标记困惑</span>
              </button>
            )}

            {/* 播放速度 */}
            <button
              onClick={cyclePlaybackRate}
              disabled={!isReady}
              className={cn(
                "font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-50 border border-gray-200",
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
                  className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 rounded-lg transition-colors"
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
                  className="w-20 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#232322]"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 加载状态 - 显示进度 */}
      {!isReady && src && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 rounded-2xl">
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 border-4 rounded-full" style={{ borderColor: '#F5E6D3' }} />
              <div 
                className="absolute inset-0 border-4 rounded-full animate-spin"
                style={{ 
                  clipPath: `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin(loadProgress / 100 * Math.PI * 2)}% ${50 - 50 * Math.cos(loadProgress / 100 * Math.PI * 2)}%, 50% 50%)`,
                  borderColor: 'transparent',
                  borderTopColor: '#D4A574',
                }}
              />
            </div>
            <span className="text-sm text-gray-600 font-medium">
              加载音频 {loadProgress > 0 ? `${loadProgress}%` : '...'}
            </span>
            {/* 进度条 */}
            {loadProgress > 0 && (
              <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full transition-all duration-300"
                  style={{ 
                    width: `${loadProgress}%`,
                    background: 'linear-gradient(90deg, #D4A574 0%, #E8B88C 100%)'
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
