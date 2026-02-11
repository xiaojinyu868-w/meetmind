'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { TranscriptSegment } from '@/types';
import { TranscriptFlowView } from '../TranscriptFlowView';

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

export function MobileTimeline({
  entries,
  currentTime,
  onEntryClick,
  onConfusionClick,
  selectedEntryId,
  className,
  autoScroll = true,
}: MobileTimelineProps) {
  // Convert entries to TranscriptSegment format
  const segments: TranscriptSegment[] = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        text: entry.content,
        startMs: entry.startMs,
        endMs: entry.endMs,
        confidence: 1,
      })),
    [entries]
  );

  const confusionTimestamps = useMemo(
    () =>
      entries
        .filter((e) => e.hasConfusion)
        .map((e) => ({
          timestamp: e.startMs,
          resolved: e.confusionResolved ?? false,
        })),
    [entries]
  );

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
    <div className={cn("overflow-y-auto", className)}>
      {/* 列表标题 */}
      <div className="sticky top-0 z-10 px-4 py-2 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <h3 className="text-sm font-medium text-slate-300">课堂时间轴</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          共 {entries.length} 段 · {entries.filter(e => e.hasConfusion && !e.confusionResolved).length} 个待解决困惑
        </p>
      </div>

      <div className="px-4 py-3">
        <TranscriptFlowView
          segments={segments}
          variant="review"
          currentTime={currentTime}
          onTimestampClick={(timeMs) => {
            const entry = entries.find(
              (e) => timeMs >= e.startMs && timeMs <= e.endMs
            );
            if (entry) onEntryClick(entry);
          }}
          confusionTimestamps={confusionTimestamps}
          defaultExpanded={true}
          showHeader={false}
        />
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
    };
  });
}

export default MobileTimeline;
