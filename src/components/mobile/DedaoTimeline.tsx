'use client';

import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { TranscriptSegment } from '@/types';
import type { Anchor } from '@/lib/services/anchor-service';

export interface DedaoTimelineEntry {
  id: string;
  content: string;
  startMs: number;
  endMs: number;
  hasConfusion: boolean;
  confusionResolved?: boolean;
}

export interface DedaoTimelineProps {
  entries: DedaoTimelineEntry[];
  currentTime: number;
  onEntryClick: (entry: DedaoTimelineEntry) => void;
  onConfusionClick?: (entry: DedaoTimelineEntry) => void;
  className?: string;
  'data-onboarding'?: string;  // 支持引导系统标记
}

// 格式化时间
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 将 TranscriptSegment + Anchor 转换为时间轴条目
export function toDedaoEntries(
  segments: TranscriptSegment[],
  anchors: Anchor[]
): DedaoTimelineEntry[] {
  return segments.map((segment) => {
    const anchor = anchors.find(
      (a) => a.timestamp >= segment.startMs && a.timestamp <= segment.endMs
    );
    return {
      id: segment.id,
      content: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      hasConfusion: !!anchor,
      confusionResolved: anchor?.resolved,
    };
  });
}

export function DedaoTimeline({
  entries,
  currentTime,
  onEntryClick,
  onConfusionClick,
  className,
  'data-onboarding': dataOnboarding,
}: DedaoTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeEntryRef = useRef<HTMLDivElement>(null);

  // 自动滚动到当前播放位置
  useEffect(() => {
    if (activeEntryRef.current && containerRef.current) {
      const container = containerRef.current;
      const entry = activeEntryRef.current;
      
      const containerRect = container.getBoundingClientRect();
      const entryRect = entry.getBoundingClientRect();
      
      // 如果当前条目不在可视区域内，滚动到中间
      if (entryRect.top < containerRect.top || entryRect.bottom > containerRect.bottom) {
        entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime]);

  // 找到当前播放的条目
  const activeEntryId = entries.find(
    (e) => currentTime >= e.startMs && currentTime <= e.endMs
  )?.id;

  return (
    <div
      ref={containerRef}
      data-onboarding={dataOnboarding}
      className={cn(
        'overflow-y-auto overflow-x-hidden',
        'bg-[var(--dedao-bg)]',
        className
      )}
    >
      <div className="px-4 py-3">
        <h3 className="text-sm font-medium text-[var(--dedao-text-secondary)] mb-3">
          课堂时间轴
        </h3>
        
        <div className="space-y-2">
          {entries.map((entry) => {
            const isActive = entry.id === activeEntryId;
            
            return (
              <div
                key={entry.id}
                ref={isActive ? activeEntryRef : undefined}
                onClick={() => onEntryClick(entry)}
                className={cn(
                  'relative p-3 rounded-xl cursor-pointer',
                  'transition-all duration-200',
                  isActive
                    ? 'bg-white shadow-sm border border-[var(--dedao-gold-light)]'
                    : 'bg-[var(--dedao-bg-card)] hover:bg-white hover:shadow-sm'
                )}
              >
                {/* 时间标签 */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span 
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium tabular-nums',
                      isActive
                        ? 'bg-[var(--dedao-gold)] text-white'
                        : 'bg-[var(--dedao-bg-warm)] text-[var(--dedao-text-secondary)]'
                    )}
                  >
                    {formatTime(entry.startMs)}
                  </span>
                  
                  {/* 困惑点标记 */}
                  {entry.hasConfusion && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onConfusionClick?.(entry);
                      }}
                      className={cn(
                        'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
                        'transition-colors duration-150',
                        entry.confusionResolved
                          ? 'bg-green-50 text-green-600'
                          : 'bg-red-50 text-red-500 hover:bg-red-100'
                      )}
                    >
                      <span className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        entry.confusionResolved ? 'bg-green-500' : 'bg-red-500'
                      )} />
                      {entry.confusionResolved ? '已解决' : '困惑点'}
                    </button>
                  )}
                </div>

                {/* 内容文本 */}
                <p className={cn(
                  'text-sm leading-relaxed',
                  isActive 
                    ? 'text-[var(--dedao-text)]' 
                    : 'text-[var(--dedao-text-secondary)]'
                )}>
                  {entry.content}
                </p>

                {/* 播放中指示器 */}
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[var(--dedao-gold)] rounded-r-full" />
                )}
              </div>
            );
          })}
        </div>

        {entries.length === 0 && (
          <div className="py-12 text-center text-[var(--dedao-text-muted)]">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
            <p className="text-sm">开始录音后，内容将显示在这里</p>
          </div>
        )}
      </div>
    </div>
  );
}
