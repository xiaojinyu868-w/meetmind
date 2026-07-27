'use client';

import type { Timeline, Breakpoint } from '@/types';
import { TranscriptFlowView } from './TranscriptFlowView';

interface TimelineViewProps {
  timeline: Timeline;
  currentTime: number;
  onTimeClick: (timeMs: number) => void;
  onBreakpointClick: (breakpoint: Breakpoint) => void;
  onSegmentTextUpdate?: (segmentId: string, text: string) => void;
  /** Enable word explanation for selected transcript text. */
  enableWordExplainer?: boolean;
  /** Full transcript context for word explanation. */
  fullContextText?: string;
  /** 课中「截取这一页」关键帧（按时间轴插入转录流） */
  keyframes?: Array<{ timestampMs: number; src: string }>;
}

export function TimelineView({
  timeline,
  currentTime,
  onTimeClick,
  onBreakpointClick,
  onSegmentTextUpdate,
  enableWordExplainer = false,
  fullContextText,
  keyframes,
}: TimelineViewProps) {
  const unresolvedCount = timeline.breakpoints.filter((bp) => !bp.resolved).length;

  const confusionTimestamps = timeline.breakpoints.map((bp) => ({
    timestamp: bp.timestamp,
    resolved: bp.resolved,
  }));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden px-4 py-3">
        <TranscriptFlowView
          segments={timeline.segments}
          variant="review"
          currentTime={currentTime}
          onTimestampClick={onTimeClick}
          editable={!!onSegmentTextUpdate}
          onSegmentTextUpdate={onSegmentTextUpdate}
          enableWordExplainer={enableWordExplainer}
          fullContextText={fullContextText}
          confusionTimestamps={confusionTimestamps}
          keyframes={keyframes}
          defaultExpanded={true}
          showHeader={false}
          headerTitle="课堂转录"
          className="h-full flex flex-col"
        />
      </div>

      <div className="px-4 py-3 border-t border-divider-light">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const firstUnresolved = timeline.breakpoints.find((bp) => !bp.resolved);
              if (firstUnresolved) onBreakpointClick(firstUnresolved);
            }}
            disabled={unresolvedCount === 0}
            className="flex-1 btn btn-secondary py-2 text-sm disabled:opacity-50"
          >
            跳转下一个困惑点
          </button>
        </div>
      </div>
    </div>
  );
}
