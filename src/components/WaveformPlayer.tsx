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
  waveColor = '#4F46E5',
  progressColor = '#818CF8',
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
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
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
    wavesurferRef.current?.setVolume(value);
  }, []);

  // 无音频时的占位
  if (!src) {
    return (
      <div className="bg-gray-100 rounded-lg p-4">
        <div className="flex items-center justify-center gap-2 text-gray-400">
          <span>🔇</span>
          <span className="text-sm">暂无音频</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      {/* 波形容器 */}
      <div 
        ref={containerRef} 
        className="rounded-lg overflow-hidden mb-3"
        style={{ minHeight: height }}
      />

      {/* 困惑点图例 */}
      {anchors.length > 0 && (
        <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500/30 rounded" />
            <span>未解决困惑点</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500/30 rounded" />
            <span>已解决</span>
          </div>
          <span className="text-gray-400">共 {anchors.length} 个</span>
        </div>
      )}

      {/* 控制栏 */}
      {showControls && (
        <div className="flex items-center gap-3">
          {/* 时间显示 */}
          <span className="text-xs font-mono text-gray-500 w-24">
            {formatTimestampMs(currentTime)} / {formatTimestampMs(duration)}
          </span>

          {/* 播放控制 */}
          <div className="flex items-center gap-1">
            {/* 后退 10s */}
            <button
              onClick={skipBackward}
              disabled={!isReady}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
              title="后退 10 秒"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12.5 3C17.15 3 21.08 6.03 22.47 10.22L20.1 11C19.05 7.81 16.04 5.5 12.5 5.5C10.54 5.5 8.77 6.22 7.38 7.38L10 10H3V3L5.6 5.6C7.45 4 9.85 3 12.5 3M10 12L12 10H8V12H10M6 13H8V15H6V13M12.5 21C7.85 21 3.92 17.97 2.53 13.78L4.9 13C5.95 16.19 8.96 18.5 12.5 18.5C14.46 18.5 16.23 17.78 17.62 16.62L15 14H22V21L19.4 18.4C17.55 20 15.15 21 12.5 21Z" />
              </svg>
            </button>

            {/* 播放/暂停 */}
            <button
              onClick={togglePlay}
              disabled={!isReady}
              className="p-2 bg-indigo-500 text-white rounded-full hover:bg-indigo-600 disabled:opacity-50 transition-colors"
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* 前进 10s */}
            <button
              onClick={skipForward}
              disabled={!isReady}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
              title="前进 10 秒"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.5 3C6.85 3 2.92 6.03 1.53 10.22L3.9 11C4.95 7.81 7.96 5.5 11.5 5.5C13.46 5.5 15.23 6.22 16.62 7.38L14 10H21V3L18.4 5.6C16.55 4 14.15 3 11.5 3M14 12L12 10H16V12H14M16 13H18V15H16V13M11.5 21C16.15 21 20.08 17.97 21.47 13.78L19.1 13C18.05 16.19 15.04 18.5 11.5 18.5C9.54 18.5 7.77 17.78 6.38 16.62L9 14H2V21L4.6 18.4C6.45 20 8.85 21 11.5 21Z" />
              </svg>
            </button>
          </div>

          <div className="flex-1" />

          {/* 播放速度 */}
          <button
            onClick={cyclePlaybackRate}
            disabled={!isReady}
            className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
            title="播放速度"
          >
            {playbackRate}x
          </button>

          {/* 音量 */}
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={handleVolumeChange}
              className="w-16 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* 加载状态 */}
      {!isReady && src && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80">
          <div className="flex items-center gap-2 text-gray-500">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm">加载音频...</span>
          </div>
        </div>
      )}
    </div>
  );
});

WaveformPlayer.displayName = 'WaveformPlayer';
