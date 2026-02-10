'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Timeline, Breakpoint } from '@/lib/services/meetmind-service';
import { formatTimestamp } from '@/lib/services/longcut-utils';

interface TimelineViewProps {
  timeline: Timeline;
  currentTime: number;
  selectedBreakpoint: Breakpoint | null;
  onTimeClick: (timeMs: number) => void;
  onBreakpointClick: (breakpoint: Breakpoint) => void;
  onSegmentTextUpdate?: (segmentId: string, text: string) => void;
}

export function TimelineView({
  timeline,
  currentTime,
  selectedBreakpoint,
  onTimeClick,
  onBreakpointClick,
  onSegmentTextUpdate,
}: TimelineViewProps) {
  const t = useTranslations();
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  const [editingOriginalText, setEditingOriginalText] = useState('');

  const startEditing = useCallback((segmentId: string, currentText: string) => {
    if (!onSegmentTextUpdate) return;
    setEditingSegmentId(segmentId);
    setDraftText(currentText);
    setEditingOriginalText(currentText);
  }, [onSegmentTextUpdate]);

  const cancelEditing = useCallback(() => {
    setEditingSegmentId(null);
    setDraftText('');
    setEditingOriginalText('');
  }, []);

  const saveEditing = useCallback(() => {
    if (!editingSegmentId || !onSegmentTextUpdate) {
      cancelEditing();
      return;
    }

    const normalized = draftText.trim();
    if (!normalized || normalized === editingOriginalText.trim()) {
      cancelEditing();
      return;
    }

    onSegmentTextUpdate(editingSegmentId, normalized);
    cancelEditing();
  }, [cancelEditing, draftText, editingOriginalText, editingSegmentId, onSegmentTextUpdate]);

  const totalDuration = timeline.segments[timeline.segments.length - 1]?.endMs || 1;
  const progressPercent = (currentTime / totalDuration) * 100;
  const unresolvedCount = timeline.breakpoints.filter((bp) => !bp.resolved).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-navy">{t('timeline.title')}</h2>
          {unresolvedCount > 0 && (
            <span className="badge badge-streaming">{t('timeline.unresolvedCount', { count: unresolvedCount })}</span>
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
                title={`${formatTimestamp(bp.timestamp)} - ${bp.resolved ? t('timeline.resolved') : t('timeline.unresolved')}`}
              />
            ))}
          </div>
        </div>
      </div>

      {timeline.topics.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">{t('timeline.topics')}</h3>
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

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 py-3">
          <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">{t('timeline.transcript')}</h3>
          <div className="space-y-0.5">
            {timeline.segments.map((segment, index) => {
              const isActive = currentTime >= segment.startMs && currentTime < segment.endMs;
              const breakpoint = timeline.breakpoints.find(
                (bp) => bp.timestamp >= segment.startMs && bp.timestamp < segment.endMs
              );

              const prevSegment = index > 0 ? timeline.segments[index - 1] : null;
              const showTimestamp = !prevSegment || segment.startMs - prevSegment.startMs > 3000;
              const isEditing = editingSegmentId === segment.id;

              return (
                <div
                  key={segment.id}
                  onClick={() => {
                    if (isEditing) return;
                    onTimeClick(segment.startMs);
                  }}
                  className={`relative py-1 px-2 rounded cursor-pointer transition-colors ${
                    isActive ? 'bg-lilac-100/50 text-navy' : 'hover:bg-surface-soft text-gray-700'
                  }`}
                >
                  {breakpoint && (
                    <div
                      className={`absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${
                        breakpoint.resolved ? 'bg-mint' : 'bg-coral'
                      }`}
                    />
                  )}

                  <div className="flex items-baseline gap-2 pl-3">
                    {showTimestamp && (
                      <span className="flex-shrink-0 text-xs font-mono text-gray-400 w-10">
                        {formatTimestamp(segment.startMs)}
                      </span>
                    )}

                    <div className={`flex-1 min-w-0 ${!showTimestamp ? 'ml-12' : ''}`}>
                      {isEditing ? (
                        <textarea
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          onBlur={saveEditing}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEditing();
                            }
                          }}
                          className="w-full min-h-[80px] rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-200"
                          autoFocus
                        />
                      ) : onSegmentTextUpdate ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(segment.id, segment.text);
                          }}
                          className="w-full text-left text-sm leading-relaxed rounded-md px-1 py-0.5 -mx-1 hover:bg-white/70 transition-colors cursor-text"
                          title={t('timeline.clickToEdit')}
                        >
                          {segment.text}
                        </button>
                      ) : (
                        <p className="text-sm leading-relaxed">{segment.text}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
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
            {t('timeline.jumpToNextConfusion')}
          </button>
        </div>
      </div>
    </div>
  );
}
