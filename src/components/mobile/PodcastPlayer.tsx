'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

// 困惑点标记接口
export interface ConfusionMarker {
  id: string;
  timestamp: number;      // 毫秒
  content?: string;
  resolved: boolean;
}

export interface PodcastPlayerProps {
  currentTime: number;           // 当前时间（毫秒）
  duration: number;              // 总时长（毫秒）
  isPlaying: boolean;
  markers?: ConfusionMarker[];   // 困惑点标记
  onSeek: (timeMs: number) => void;
  onPlayPause: () => void;
  onMarkerClick?: (marker: ConfusionMarker) => void;
  selectedMarkerId?: string;
  className?: string;
}

// 格式化时间
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 困惑点标记组件
function ConfusionMarkerDot({
  marker,
  position,
  isSelected,
  onClick,
}: {
  marker: ConfusionMarker;
  position: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute -translate-x-1/2 transition-all duration-200",
        "w-3 h-3 rounded-full",
        "focus:outline-none focus:ring-2 focus:ring-offset-1",
        marker.resolved
          ? "bg-emerald-400 focus:ring-emerald-400/50"
          : "bg-rose-500 focus:ring-rose-500/50",
        isSelected && "scale-150 ring-2 ring-white/50",
        !marker.resolved && "animate-pulse"
      )}
      style={{ left: `${position}%`, bottom: '100%', marginBottom: '8px' }}
      aria-label={marker.resolved ? '已解决的困惑点' : '待解决的困惑点'}
    />
  );
}

export function PodcastPlayer({
  currentTime,
  duration,
  isPlaying,
  markers = [],
  onSeek,
  onPlayPause,
  onMarkerClick,
  selectedMarkerId,
  className,
}: PodcastPlayerProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // 计算进度百分比
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // 处理进度条点击/拖拽
  const handleProgressInteraction = useCallback(
    (clientX: number) => {
      if (!progressRef.current || duration <= 0) return;
      
      const rect = progressRef.current.getBoundingClientRect();
      const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newTime = percentage * duration;
      onSeek(newTime);
    },
    [duration, onSeek]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handleProgressInteraction(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    handleProgressInteraction(e.touches[0].clientX);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleProgressInteraction(e.clientX);
    };

    const handleTouchMove = (e: TouchEvent) => {
      handleProgressInteraction(e.touches[0].clientX);
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, handleProgressInteraction]);

  // 计算标记位置
  const getMarkerPosition = (timestamp: number) => {
    if (duration <= 0) return 0;
    return (timestamp / duration) * 100;
  };

  return (
    <div className={cn("w-full", className)}>
      {/* 播放控制行 */}
      <div className="flex items-center justify-center gap-4 mb-4">
        {/* 播放/暂停按钮 */}
        <button
          onClick={onPlayPause}
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center",
            "bg-gradient-to-br from-amber-400 to-amber-500",
            "text-white shadow-lg shadow-amber-500/30",
            "active:scale-95 transition-transform",
            "focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 focus:ring-offset-slate-900"
          )}
          aria-label={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
      </div>

      {/* 进度条区域 */}
      <div className="relative px-2">
        {/* 困惑点标记层 */}
        <div className="relative h-4">
          {markers.map((marker) => (
            <ConfusionMarkerDot
              key={marker.id}
              marker={marker}
              position={getMarkerPosition(marker.timestamp)}
              isSelected={selectedMarkerId === marker.id}
              onClick={() => onMarkerClick?.(marker)}
            />
          ))}
        </div>

        {/* 进度条 */}
        <div
          ref={progressRef}
          className={cn(
            "relative h-2 rounded-full cursor-pointer",
            "bg-slate-700/50"
          )}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
        >
          {/* 已播放进度 */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
            style={{ width: `${progress}%` }}
          />
          
          {/* 进度指示器 */}
          <div
            className={cn(
              "absolute top-1/2 -translate-y-1/2 -translate-x-1/2",
              "w-4 h-4 rounded-full bg-white shadow-md",
              "border-2 border-amber-500",
              isDragging && "scale-125"
            )}
            style={{ left: `${progress}%` }}
          />
        </div>

        {/* 时间显示 */}
        <div className="flex justify-between mt-2 text-xs text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* 困惑点统计 */}
      {markers.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span className="text-slate-400">
              {markers.filter(m => !m.resolved).length} 待解决
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-400">
              {markers.filter(m => m.resolved).length} 已解决
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PodcastPlayer;
