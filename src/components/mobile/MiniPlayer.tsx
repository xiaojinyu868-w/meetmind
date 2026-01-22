'use client';

import React, { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface ConfusionMarker {
  id: string;
  timestamp: number;  // 毫秒
  resolved: boolean;
}

export interface MiniPlayerProps {
  currentTime: number;           // 当前时间（毫秒）
  duration: number;              // 总时长（毫秒）
  isPlaying: boolean;
  markers?: ConfusionMarker[];
  onSeek: (timeMs: number) => void;
  onPlayPause: () => void;
  onMarkerClick?: (marker: ConfusionMarker) => void;
  className?: string;
}

// 格式化时间 mm:ss
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function MiniPlayer({
  currentTime,
  duration,
  isPlaying,
  markers = [],
  onSeek,
  onPlayPause,
  onMarkerClick,
  className,
}: MiniPlayerProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  
  // 处理进度条点击
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration <= 0) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    onSeek(percentage * duration);
  };
  
  // 处理触摸拖动
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!progressRef.current || duration <= 0) return;
    
    const rect = progressRef.current.getBoundingClientRect();
    const touch = e.touches[0];
    const x = touch.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    onSeek(percentage * duration);
  };

  return (
    <div 
      className={cn(
        'flex items-center gap-3 px-4 py-2.5',
        'bg-[var(--dedao-bg-warm)] border-b border-[#E8E4DF]',
        className
      )}
      role="region"
      aria-label="音频播放器"
    >
      {/* 播放/暂停按钮 */}
      <button
        onClick={onPlayPause}
        aria-label={isPlaying ? '暂停' : '播放'}
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          'bg-[var(--dedao-gold)] text-white shadow-sm',
          'active:scale-95 transition-transform duration-150 motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dedao-gold)] focus-visible:ring-offset-2'
        )}
      >
        {isPlaying ? (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* 当前时间 */}
      <span className="flex-shrink-0 text-xs font-medium text-[var(--dedao-text)] tabular-nums w-10" aria-live="polite" aria-atomic="true">
        <span className="sr-only">当前播放时间</span>
        {formatTime(currentTime)}
      </span>

      {/* 进度条区域 */}
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        onTouchMove={handleTouchMove}
        role="slider"
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = duration * 0.05; // 5% 步进
          if (e.key === 'ArrowRight') {
            onSeek(Math.min(duration, currentTime + step));
          } else if (e.key === 'ArrowLeft') {
            onSeek(Math.max(0, currentTime - step));
          }
        }}
        className="relative flex-1 h-6 flex items-center cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dedao-gold)] focus-visible:ring-offset-2 rounded"
      >
        {/* 进度条轨道 */}
        <div className="absolute inset-x-0 h-1 bg-[#E0D6CC] rounded-full overflow-hidden">
          {/* 已播放进度 */}
          <div
            className="h-full bg-[var(--dedao-gold)] rounded-full transition-all duration-100 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* 困惑点标记 */}
        {markers.map((marker) => {
          const position = duration > 0 ? (marker.timestamp / duration) * 100 : 0;
          return (
            <button
              key={marker.id}
              onClick={(e) => {
                e.stopPropagation();
                onMarkerClick?.(marker);
              }}
              aria-label={`困惑点 ${marker.resolved ? '已解决' : '待解决'} - ${formatTime(marker.timestamp)}`}
              className={cn(
                'absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 z-10',
                'transition-transform duration-150 hover:scale-125 motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                marker.resolved 
                  ? 'bg-[var(--dedao-resolved)] focus-visible:ring-[var(--dedao-resolved)]' 
                  : 'bg-[var(--dedao-confusion)] focus-visible:ring-[var(--dedao-confusion)]'
              )}
              style={{ left: `${position}%` }}
            />
          );
        })}

        {/* 播放头指示器 */}
        <div
          className="absolute w-3 h-3 rounded-full bg-[var(--dedao-gold)] border-2 border-white shadow-sm -translate-x-1/2 z-20"
          style={{ left: `${progress}%` }}
          aria-hidden="true"
        />
      </div>

      {/* 总时长 */}
      <span className="flex-shrink-0 text-xs text-[var(--dedao-text-muted)] tabular-nums w-10 text-right">
        <span className="sr-only">总时长</span>
        {formatTime(duration)}
      </span>
    </div>
  );
}
