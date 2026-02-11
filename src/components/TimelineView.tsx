'use client';

import type { Timeline, Breakpoint } from '@/lib/services/meetmind-service';
import { formatTimestamp } from '@/lib/services/longcut-utils';
import { TranscriptFlowView } from './TranscriptFlowView';

interface TimelineViewProps {
  timeline: Timeline;
  currentTime: number;
  selectedBreakpoint: Breakpoint | null;
  onTimeClick: (timeMs: number) => void;
  onBreakpointClick: (breakpoint: Breakpoint) => void;
  onSegmentTextUpdate?: (segmentId: string, text: string) => void;
  /** 启用选词解释功能 */
  enableWordExplainer?: boolean;
  /** 完整转录上下文（用于 AI 解释时的参考） */
  fullContextText?: string;
}

export function TimelineView({
  timeline,
  currentTime,
  selectedBreakpoint,
  onTimeClick,
  onBreakpointClick,
  onSegmentTextUpdate,
  enableWordExplainer = false,
  fullContextText,
}: TimelineViewProps) {
  const totalDuration = timeline.segments[timeline.segments.length - 1]?.endMs || 1;
  const progressPercent = (currentTime / totalDuration) * 100;
  const unresolvedCount = timeline.breakpoints.filter((bp) => !bp.resolved).length;

  const confusionTimestamps = timeline.breakpoints.map((bp) => ({
    timestamp: bp.timestamp,
    resolved: bp.resolved,
  }));

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-navy">课堂时间轴</h2>
          {unresolvedCount > 0 && (
            <span className="badge badge-streaming">{unresolvedCount} 待解决</span>
          )}
        </div>

        <div className="relative">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
            <span className="font-mono">{formatTimestamp(currentTime)}</span>
            <span className="font-mono">{formatTimestamp(totalDuration)}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full relative overflow-visible">
            <div
              className="absolute left-0 top-0 h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-100"
              style={{ width: `${progressPercent}%` }}
            />
            {timeline.breakpoints.map((bp) => (
              <button
                key={bp.id}
                onClick={() => onBreakpointClick(bp)}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white shadow-md transition-all hover:scale-125 z-10 ${
                  bp.resolved ? 'bg-mint' : 'bg-coral animate-pulse'
                } ${selectedBreakpoint?.id === bp.id ? 'ring-2 ring-amber-300 scale-125' : ''}`}
                style={{ left: `${(bp.timestamp / totalDuration) * 100}%` }}
                title={`${formatTimestamp(bp.timestamp)} - ${bp.resolved ? '已解决' : '待解决'}`}
              />
            ))}
          </div>
        </div>
      </div>

      {timeline.topics.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">知识点</h3>
          <div className="flex gap-1.5 flex-wrap">
            {timeline.topics.map((topic, index) => {
              const isActive = currentTime >= topic.startMs && currentTime < topic.endMs;
              return (
                <button
                  key={topic.id}
                  onClick={() => onTimeClick(topic.startMs)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg transition-all ${
                    isActive
                      ? 'bg-amber-100 text-amber-700 font-medium shadow-sm'
                      : 'bg-gray-50 text-gray-600 hover:bg-amber-50'
                  }`}
                >
                  {index + 1}. {topic.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
          defaultExpanded={true}
          showHeader={true}
          headerTitle="课堂转录"
          className="h-full flex flex-col"
        />
      </div>

      <div className="px-4 py-3 border-t border-gray-100">
        <div className="flex gap-2">
          <button
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
