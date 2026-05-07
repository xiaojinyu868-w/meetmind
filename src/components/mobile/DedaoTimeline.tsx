'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { TranscriptSegment } from '@/types';
import type { Anchor } from '@/types';
import { TranscriptFlowView } from '../TranscriptFlowView';

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
  onEntryTextUpdate?: (entry: DedaoTimelineEntry, text: string) => void;
  className?: string;
}

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
  onConfusionClick: _onConfusionClick,
  onEntryTextUpdate,
  className,
}: DedaoTimelineProps) {
  // Convert entries back to TranscriptSegment format for TranscriptFlowView
  const segments: TranscriptSegment[] = entries.map((entry) => ({
    id: entry.id,
    text: entry.content,
    startMs: entry.startMs,
    endMs: entry.endMs,
    confidence: 1,
  }));

  const confusionTimestamps = entries
    .filter((e) => e.hasConfusion)
    .map((e) => ({
      timestamp: e.startMs,
      resolved: e.confusionResolved ?? false,
    }));

  return (
    <div
      className={cn(
        'overflow-y-auto overflow-x-hidden',
        'bg-[var(--dedao-bg)]',
        className
      )}
    >
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
          editable={!!onEntryTextUpdate}
          onSegmentTextUpdate={
            onEntryTextUpdate
              ? (segmentId, text) => {
                  const entry = entries.find((e) => e.id === segmentId);
                  if (entry) onEntryTextUpdate(entry, text);
                }
              : undefined
          }
          confusionTimestamps={confusionTimestamps}
          defaultExpanded={true}
          showHeader={true}
          headerTitle="课堂时间轴"
          className="h-full"
          enableWordExplainer={true}
        />

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
