'use client';

import type { Timeline, Breakpoint } from '@/lib/services/meetmind-service';
import { formatTimestamp } from '@/lib/services/longcut-utils';

interface TimelineViewProps {
  timeline: Timeline;
  currentTime: number;
  selectedBreakpoint: Breakpoint | null;
  onTimeClick: (timeMs: number) => void;
  onBreakpointClick: (breakpoint: Breakpoint) => void;
}

export function TimelineView({
  timeline,
  currentTime,
  selectedBreakpoint,
  onTimeClick,
  onBreakpointClick,
}: TimelineViewProps) {
  // 计算进度百分比
  const totalDuration = timeline.segments[timeline.segments.length - 1]?.endMs || 1;
  const progressPercent = (currentTime / totalDuration) * 100;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 进度条 */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>{formatTimestamp(currentTime)}</span>
          <span>{formatTimestamp(totalDuration)}</span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full relative">
          {/* 进度 */}
          <div
            className="absolute left-0 top-0 h-full bg-primary-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
          {/* 断点标记 */}
          {timeline.breakpoints.map((bp) => (
            <button
              key={bp.id}
              onClick={() => onBreakpointClick(bp)}
              className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow transition-transform hover:scale-125 ${
                bp.resolved ? 'bg-green-500' : 'bg-red-500'
              } ${selectedBreakpoint?.id === bp.id ? 'ring-2 ring-primary-300' : ''}`}
              style={{ left: `${(bp.timestamp / totalDuration) * 100}%` }}
              title={`${formatTimestamp(bp.timestamp)} - ${bp.resolved ? '已解决' : '待解决'}`}
            />
          ))}
        </div>
      </div>

      {/* 主题分段 */}
      <div className="px-3 py-2 border-b border-gray-100">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          课堂主题
        </h3>
        <div className="flex gap-1 flex-wrap">
          {timeline.topics.map((topic, index) => (
            <button
              key={topic.id}
              onClick={() => onTimeClick(topic.startMs)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                currentTime >= topic.startMs && currentTime < topic.endMs
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {index + 1}. {topic.title}
            </button>
          ))}
        </div>
      </div>

      {/* 转录文本 */}
      <div className="flex-1 overflow-y-auto p-3">
        <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          课堂转录
        </h3>
        <div className="space-y-1">
          {timeline.segments.map((segment) => {
            const isActive = currentTime >= segment.startMs && currentTime < segment.endMs;
            const hasBreakpoint = timeline.breakpoints.some(
              (bp) => bp.timestamp >= segment.startMs && bp.timestamp < segment.endMs
            );

            return (
              <div
                key={segment.id}
                onClick={() => onTimeClick(segment.startMs)}
                className={`timeline-segment ${isActive ? 'active' : ''}`}
              >
                {hasBreakpoint && <div className="breakpoint-dot" />}
                <div className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 flex-shrink-0 w-10">
                    {formatTimestamp(segment.startMs)}
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {segment.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
