'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { TranscriptSegment } from '@/types';

// 时间轴条目接口
export interface TimelineEntry {
  id: string;
  content: string;
  startMs: number;
  endMs: number;
  hasConfusion: boolean;
  confusionResolved?: boolean;
  speaker?: string;
  type?: 'lecture' | 'qa' | 'exercise';
}

export interface MobileTimelineProps {
  entries: TimelineEntry[];
  currentTime: number;           // 当前播放时间（毫秒）
  onEntryClick: (entry: TimelineEntry) => void;
  onConfusionClick?: (entry: TimelineEntry) => void;
  selectedEntryId?: string;
  className?: string;
  autoScroll?: boolean;          // 是否自动滚动到当前播放位置
}

// 格式化时间
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 单个时间轴条目
function TimelineItem({
  entry,
  isActive,
  isSelected,
  onClick,
  onConfusionClick,
}: {
  entry: TimelineEntry;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  onConfusionClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 transition-all duration-200",
        "border-l-2 focus:outline-none",
        isActive
          ? "bg-amber-500/10 border-l-amber-500"
          : "bg-transparent border-l-transparent hover:bg-slate-800/50",
        isSelected && "ring-1 ring-amber-500/50 rounded-r-lg"
      )}
    >
      <div className="flex items-start gap-3">
        {/* 时间标签 */}
        <div className={cn(
          "flex-shrink-0 text-xs font-mono px-2 py-0.5 rounded",
          isActive ? "bg-amber-500/20 text-amber-300" : "bg-slate-800 text-slate-500"
        )}>
          {formatTime(entry.startMs)}
        </div>

        {/* 内容区域 */}
        <div className="flex-1 min-w-0">
          {/* 发言人标签 */}
          {entry.speaker && (
            <span className="text-xs text-slate-500 mb-1 block">
              {entry.speaker}
            </span>
          )}
          
          {/* 内容文本 */}
          <p className={cn(
            "text-sm line-clamp-2",
            isActive ? "text-slate-200" : "text-slate-400"
          )}>
            {entry.content}
          </p>
        </div>

        {/* 困惑点标记 */}
        {entry.hasConfusion && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onConfusionClick?.();
            }}
            className={cn(
              "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center",
              "transition-all",
              entry.confusionResolved
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-rose-500/20 text-rose-400 animate-pulse"
            )}
            aria-label={entry.confusionResolved ? '已解决的困惑点' : '点击查看困惑点'}
          >
            {entry.confusionResolved ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" />
              </svg>
            )}
          </button>
        )}
      </div>
    </button>
  );
}

export function MobileTimeline({
  entries,
  currentTime,
  onEntryClick,
  onConfusionClick,
  selectedEntryId,
  className,
  autoScroll = true,
}: MobileTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);
  const lastScrollTime = useRef<number>(0);

  // 找出当前播放的条目
  const activeEntryId = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (currentTime >= entries[i].startMs) {
        return entries[i].id;
      }
    }
    return entries[0]?.id;
  }, [entries, currentTime]);

  // 自动滚动到当前播放位置
  useEffect(() => {
    if (!autoScroll || !activeItemRef.current || !containerRef.current) return;

    // 节流：避免频繁滚动
    const now = Date.now();
    if (now - lastScrollTime.current < 2000) return;
    lastScrollTime.current = now;

    activeItemRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeEntryId, autoScroll]);

  if (entries.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-12", className)}>
        <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p className="text-slate-500 text-sm">暂无时间轴内容</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("overflow-y-auto", className)}
    >
      {/* 列表标题 */}
      <div className="sticky top-0 z-10 px-4 py-2 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <h3 className="text-sm font-medium text-slate-300">课堂时间轴</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          共 {entries.length} 段 · {entries.filter(e => e.hasConfusion && !e.confusionResolved).length} 个待解决困惑
        </p>
      </div>

      {/* 时间轴列表 */}
      <div className="divide-y divide-slate-800/50">
        {entries.map((entry) => {
          const isActive = entry.id === activeEntryId;
          const isSelected = entry.id === selectedEntryId;
          
          return (
            <div
              key={entry.id}
              ref={isActive ? activeItemRef : undefined}
            >
              <TimelineItem
                entry={entry}
                isActive={isActive}
                isSelected={isSelected}
                onClick={() => onEntryClick(entry)}
                onConfusionClick={() => onConfusionClick?.(entry)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 从 TranscriptSegment 转换为 TimelineEntry 的工具函数
export function segmentsToTimelineEntries(
  segments: TranscriptSegment[],
  anchors: Array<{ id: string; timestamp: number; resolved: boolean }>
): TimelineEntry[] {
  return segments.map((segment) => {
    // 查找该片段内的困惑点
    const confusion = anchors.find(
      a => a.timestamp >= segment.startMs && a.timestamp <= segment.endMs
    );
    
    return {
      id: segment.id,
      content: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      hasConfusion: !!confusion,
      confusionResolved: confusion?.resolved,
      // speaker: segment.speakerId,  // 暂时隐藏，直到有真正的 diarization
    };
  });
}

export default MobileTimeline;
