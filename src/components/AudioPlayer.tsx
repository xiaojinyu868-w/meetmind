'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { formatTimestamp } from '@/lib/services/longcut-utils';

interface AudioPlayerProps {
  /** 音频 URL 或 Blob */
  src?: string | Blob;
  /** 当前播放时间（毫秒），用于外部控制 */
  currentTime?: number;
  /** 时间轴总时长（毫秒） */
  duration?: number;
  /** 断点时间戳列表 */
  breakpoints?: number[];
  /** 时间变化回调 */
  onTimeUpdate?: (timeMs: number) => void;
  /** 点击断点回调 */
  onBreakpointClick?: (timeMs: number) => void;
  /** 是否显示波形 */
  showWaveform?: boolean;
  /** 是否紧凑模式 */
  compact?: boolean;
}

export function AudioPlayer({
  src,
  currentTime: externalTime,
  duration: externalDuration,
  breakpoints = [],
  onTimeUpdate,
  onBreakpointClick,
  showWaveform: _showWaveform = false,
  compact = false,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(externalDuration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isLoaded, setIsLoaded] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // 处理音频源
  useEffect(() => {
    if (!src) {
      setAudioUrl(null);
      return;
    }

    if (typeof src === 'string') {
      setAudioUrl(src);
    } else if (src instanceof Blob) {
      const url = URL.createObjectURL(src);
      setAudioUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [src]);

  // 外部时间控制
  useEffect(() => {
    if (externalTime !== undefined && audioRef.current && isLoaded) {
      const timeSec = externalTime / 1000;
      if (Math.abs(audioRef.current.currentTime - timeSec) > 0.5) {
        audioRef.current.currentTime = timeSec;
      }
    }
  }, [externalTime, isLoaded]);

  // 外部时长
  useEffect(() => {
    if (externalDuration) {
      setDuration(externalDuration);
    }
  }, [externalDuration]);

  // 音频事件处理
  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration * 1000);
      setIsLoaded(true);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      const timeMs = audioRef.current.currentTime * 1000;
      setCurrentTime(timeMs);
      onTimeUpdate?.(timeMs);
    }
  }, [onTimeUpdate]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // 播放控制
  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  // 跳转
  const seek = useCallback((timeMs: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = timeMs / 1000;
      setCurrentTime(timeMs);
      onTimeUpdate?.(timeMs);
    }
  }, [onTimeUpdate]);

  // 进度条点击
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const timeMs = percent * duration;
    seek(timeMs);
  }, [duration, seek]);

  // 快进/快退
  const skipForward = useCallback(() => {
    seek(Math.min(currentTime + 10000, duration));
  }, [currentTime, duration, seek]);

  const skipBackward = useCallback(() => {
    seek(Math.max(currentTime - 10000, 0));
  }, [currentTime, seek]);

  // 音量控制
  const toggleMute = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setVolume(value);
    if (audioRef.current) {
      audioRef.current.volume = value;
    }
  }, []);

  // 播放速度
  const cyclePlaybackRate = useCallback(() => {
    const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const currentIndex = rates.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % rates.length;
    const newRate = rates[nextIndex];
    
    setPlaybackRate(newRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = newRate;
    }
  }, [playbackRate]);

  // 计算进度百分比
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // 无音频时的占位 UI
  if (!audioUrl && !externalDuration) {
    return (
      <div className={`bg-gray-100 rounded-lg ${compact ? 'p-2' : 'p-4'}`}>
        <div className="flex items-center justify-center gap-2 text-gray-400">
          <span>🔇</span>
          <span className="text-sm">暂无音频</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${compact ? 'p-2' : 'p-4'}`}>
      {/* 隐藏的音频元素 */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* 进度条 */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        className="relative h-2 bg-gray-200 rounded-full cursor-pointer group mb-3"
      >
        {/* 播放进度 */}
        <div
          className="absolute top-0 left-0 h-full bg-primary-500 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
        
        {/* 断点标记 */}
        {breakpoints.map((bp, i) => {
          const bpPercent = duration > 0 ? (bp / duration) * 100 : 0;
          return (
            <div
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                seek(bp);
                onBreakpointClick?.(bp);
              }}
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-red-500 rounded-full cursor-pointer hover:scale-125 transition-transform z-10"
              style={{ left: `${bpPercent}%`, marginLeft: '-6px' }}
              title={`困惑点 ${formatTimestamp(bp)}`}
            />
          );
        })}

        {/* 播放头 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-primary-500 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${progress}%`, marginLeft: '-8px' }}
        />
      </div>

      {/* 控制栏 */}
      <div className="flex items-center gap-3">
        {/* 时间显示 */}
        <span className="text-xs font-mono text-gray-500 w-20">
          {formatTimestamp(currentTime)} / {formatTimestamp(duration)}
        </span>

        {/* 播放控制 */}
        <div className="flex items-center gap-1">
          {/* 后退 10s */}
          <button
            onClick={skipBackward}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="后退 10 秒"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.5 3C17.15 3 21.08 6.03 22.47 10.22L20.1 11C19.05 7.81 16.04 5.5 12.5 5.5C10.54 5.5 8.77 6.22 7.38 7.38L10 10H3V3L5.6 5.6C7.45 4 9.85 3 12.5 3M10 12L12 10H8V12H10M6 13H8V15H6V13M12.5 21C7.85 21 3.92 17.97 2.53 13.78L4.9 13C5.95 16.19 8.96 18.5 12.5 18.5C14.46 18.5 16.23 17.78 17.62 16.62L15 14H22V21L19.4 18.4C17.55 20 15.15 21 12.5 21Z" />
            </svg>
          </button>

          {/* 播放/暂停 */}
          <button
            onClick={togglePlay}
            disabled={!isLoaded && !!audioUrl}
            className="p-2 bg-primary-500 text-white rounded-full hover:bg-primary-600 disabled:opacity-50 transition-colors"
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
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="前进 10 秒"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.5 3C6.85 3 2.92 6.03 1.53 10.22L3.9 11C4.95 7.81 7.96 5.5 11.5 5.5C13.46 5.5 15.23 6.22 16.62 7.38L14 10H21V3L18.4 5.6C16.55 4 14.15 3 11.5 3M14 12L12 10H16V12H14M16 13H18V15H16V13M11.5 21C16.15 21 20.08 17.97 21.47 13.78L19.1 13C18.05 16.19 15.04 18.5 11.5 18.5C9.54 18.5 7.77 17.78 6.38 16.62L9 14H2V21L4.6 18.4C6.45 20 8.85 21 11.5 21Z" />
            </svg>
          </button>
        </div>

        {/* 右侧控制 */}
        <div className="flex-1" />

        {!compact && (
          <>
            {/* 播放速度 */}
            <button
              onClick={cyclePlaybackRate}
              className="px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded transition-colors"
              title="播放速度"
            >
              {playbackRate}x
            </button>

            {/* 音量 */}
            <div className="flex items-center gap-1">
              <button
                onClick={toggleMute}
                className="p-1 text-gray-500 hover:text-gray-700 rounded transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                  </svg>
                )}
              </button>
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
          </>
        )}
      </div>
    </div>
  );
}
