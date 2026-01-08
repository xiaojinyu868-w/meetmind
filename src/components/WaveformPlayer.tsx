'use client';

// wavesurfer.js 音频播放器组件
// 复用 wavesurfer.js (10k stars) 实现波形可视化

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { Region } from 'wavesurfer.js/plugins/regions';
import { formatTimestampMs } from '@/lib/longcut';

// 简化的 Anchor 类型，兼容不同来源
export interface WaveformAnchor {
  id?: string | number;
  timestamp: number;
  status?: 'active' | 'resolved' | 'pending';
  resolved?: boolean;
}

export interface WaveformPlayerRef {
  play: () => void;
  pause: () => void;
  playPause: () => void;
  seekTo: (timeMs: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setPlaybackRate: (rate: number) => void;
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
  /** 波形颜色 */
  waveColor?: string;
  /** 进度颜色 */
  progressColor?: string;
  /** 高度 */
  height?: number;
  /** 是否显示控制栏 */
  showControls?: boolean;
}

export const WaveformPlayer = forwardRef<WaveformPlayerRef, WaveformPlayerProps>(({
  src,
  anchors = [],
  onTimeUpdate,
  onAnchorClick,
  onPlayStateChange,
  onReady,
  waveColor = '#6366F1',
  progressColor = '#A5B4FC',
  height = 80,
  showControls = true,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    play: () => wavesurferRef.current?.play(),
    pause: () => wavesurferRef.current?.pause(),
    playPause: () => wavesurferRef.current?.playPause(),
    seekTo: (timeMs: number) => {
      if (wavesurferRef.current && duration > 0) {
        wavesurferRef.current.seekTo(timeMs / 1000 / (duration / 1000));
      }
    },
    getCurrentTime: () => (wavesurferRef.current?.getCurrentTime() ?? 0) * 1000,
    getDuration: () => (wavesurferRef.current?.getDuration() ?? 0) * 1000,
    setPlaybackRate: (rate: number) => {
      wavesurferRef.current?.setPlaybackRate(rate);
      setPlaybackRateState(rate);
    },
  }));

  // 初始化 wavesurfer
  useEffect(() => {
    if (!containerRef.current) return;

    // 创建 Regions 插件
    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    // 创建 WaveSurfer 实例
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor,
      progressColor,
      cursorColor: '#EF4444',
      height,
      barWidth: 3,
      barGap: 2,
      barRadius: 3,
      normalize: true,
      plugins: [regions],
    });

    // 事件监听
    ws.on('ready', () => {
      const dur = ws.getDuration() * 1000;
      setDuration(dur);
      setIsReady(true);
      onReady?.(dur);
    });

    ws.on('timeupdate', (time) => {
      const timeMs = time * 1000;
      setCurrentTime(timeMs);
      onTimeUpdate?.(timeMs);
    });

    ws.on('play', () => {
      setIsPlaying(true);
      onPlayStateChange?.(true);
    });

    ws.on('pause', () => {
      setIsPlaying(false);
      onPlayStateChange?.(false);
    });

    ws.on('finish', () => {
      setIsPlaying(false);
      onPlayStateChange?.(false);
    });

    // 点击波形跳转并播放
    ws.on('interaction', () => {
      ws.play();
    });

    wavesurferRef.current = ws;

    // 清理
    return () => {
      try {
        // 先暂停播放
        if (ws.isPlaying()) {
          ws.pause();
        }
        // 使用 setTimeout 延迟销毁，避免 AbortError
        setTimeout(() => {
          try {
            ws.destroy();
          } catch (e) {
            // 忽略销毁时的错误
            console.warn('[WaveformPlayer] Error destroying wavesurfer:', e);
          }
        }, 100);
      } catch (e) {
        console.warn('[WaveformPlayer] Error in cleanup:', e);
      }
      wavesurferRef.current = null;
      regionsRef.current = null;
    };
  }, [waveColor, progressColor, height]);

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

  // 更新困惑点标记
  useEffect(() => {
    if (!regionsRef.current || !isReady || duration === 0) return;

    // 清除现有区域
    regionsRef.current.clearRegions();

    // 添加困惑点区域
    anchors.forEach((anchor, index) => {
      const startSec = anchor.timestamp / 1000;
      const endSec = Math.min(startSec + 5, duration / 1000); // 5秒区域
      
      // 判断是否已解决
      const isResolved = anchor.status === 'resolved' || anchor.resolved === true;

      const region = regionsRef.current!.addRegion({
        start: startSec,
        end: endSec,
        color: isResolved 
          ? 'rgba(34, 197, 94, 0.3)'  // 绿色 - 已解决
          : 'rgba(239, 68, 68, 0.3)', // 红色 - 未解决
        drag: false,
        resize: false,
        id: `anchor-${anchor.id || index}`,
      });

      // 点击区域
      region.on('click', () => {
        onAnchorClick?.(anchor);
      });
    });
  }, [anchors, isReady, duration, onAnchorClick]);

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

  // 进度条点击
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!wavesurferRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    wavesurferRef.current.seekTo(percent);
  }, [duration]);

  // 无音频时的占位
  if (!src) {
    return (
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-8">
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
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* 波形容器 */}
      <div className="p-4 bg-gradient-to-br from-gray-50 to-white">
        <div 
          ref={containerRef} 
          className="rounded-xl overflow-hidden cursor-pointer"
          style={{ minHeight: height }}
        />
      </div>

      {/* 困惑点图例 */}
      {anchors.length > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500/30 rounded border border-red-300" />
            <span className="text-gray-600">未解决困惑点</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500/30 rounded border border-green-300" />
            <span className="text-gray-600">已解决</span>
          </div>
          <div className="flex-1" />
          <span className="text-gray-400 font-medium">共 {anchors.length} 个困惑点</span>
        </div>
      )}

      {/* 控制栏 */}
      {showControls && (
        <div className="px-4 py-3 bg-white border-t border-gray-100">
          <div className="flex items-center gap-4">
            {/* 播放控制 */}
            <div className="flex items-center gap-1">
              {/* 后退 10s */}
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

              {/* 播放/暂停 */}
              <button
                onClick={togglePlay}
                disabled={!isReady}
                className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 text-white rounded-xl hover:from-indigo-600 hover:to-purple-600 disabled:opacity-50 transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center"
              >
                {isPlaying ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* 前进 10s */}
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
            </div>

            {/* 时间显示 */}
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-gray-900 font-medium">
                {formatTimestampMs(currentTime)}
              </span>
              <span className="text-gray-400">/</span>
              <span className="font-mono text-gray-500">
                {formatTimestampMs(duration)}
              </span>
            </div>

            <div className="flex-1" />

            {/* 播放速度 */}
            <button
              onClick={cyclePlaybackRate}
              disabled={!isReady}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-50 border border-gray-200"
              title="播放速度"
            >
              {playbackRate}x
            </button>

            {/* 音量控制 */}
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
                className="w-20 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-indigo-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* 加载状态 */}
      {!isReady && src && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin" />
            <span className="text-sm text-gray-600 font-medium">加载音频...</span>
          </div>
        </div>
      )}
    </div>
  );
});

WaveformPlayer.displayName = 'WaveformPlayer';
