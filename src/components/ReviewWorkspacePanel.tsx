'use client';

import type { ReactNode } from 'react';
import { TimelineView } from '@/components/TimelineView';
import { AnchorDetailPanel } from '@/components/AnchorDetailPanel';
import { formatTime } from '@/lib/utils/page-utils';
import type { Anchor, Breakpoint, Timeline, TranscriptSegment } from '@/types';
import type { ReviewTab, WorkspaceTabConfig } from '@/types/page-types';

interface ReviewWorkspacePanelProps {
  reviewWorkspaceTabs: WorkspaceTabConfig<ReviewTab>[];
  reviewTab: ReviewTab;
  onReviewTabChange: (tab: ReviewTab) => void;
  selectedAnchor: Anchor | null;
  highlightTopicCount: number;
  hasSummary: boolean;
  notesCount: number;
  iconTabSize: number;
  iconTabStroke: number;
  timelineForView: Timeline | null;
  currentTime: number;
  selectedBreakpoint: Breakpoint | null;
  anchors: Anchor[];
  segments: TranscriptSegment[];
  onTimelineClick: (timeMs: number) => void;
  onBreakpointSelect: (anchor: Anchor) => void;
  onSegmentTextUpdate: (segmentId: string, text: string) => void;
  onSeek: (timeMs: number) => void;
  onPlay: (startMs: number) => void;
  onResolveAnchor: () => void;
  onAddAnchorNote: (text: string, anchorId: string) => void;
  sharedWorkspaceContent: ReactNode;
}

export function ReviewWorkspacePanel({
  reviewWorkspaceTabs,
  reviewTab,
  onReviewTabChange,
  selectedAnchor,
  highlightTopicCount,
  hasSummary,
  notesCount,
  iconTabSize,
  iconTabStroke,
  timelineForView,
  currentTime,
  selectedBreakpoint,
  anchors,
  segments,
  onTimelineClick,
  onBreakpointSelect,
  onSegmentTextUpdate,
  onSeek,
  onPlay,
  onResolveAnchor,
  onAddAnchorNote,
  sharedWorkspaceContent,
}: ReviewWorkspacePanelProps) {
  return (
    <div className="h-full flex flex-col bg-white" style={{ borderRight: '1px solid var(--edu-border-light)' }}>
      <div
        className="flex items-center gap-1 px-3 py-2.5 border-b overflow-x-auto flex-shrink-0 relative z-10 tab-buttons-container"
        style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}
      >
        {reviewWorkspaceTabs.map((tab) => (
          <button
            key={tab.key}
            data-testid={tab.testId}
            onClick={() => onReviewTabChange(tab.key)}
            className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-all whitespace-nowrap tab-button ${
              reviewTab === tab.key
                ? 'bg-white text-[#787774] font-medium'
                : 'text-gray-500 hover:text-navy hover:bg-white/50'
            }`}
          >
            {tab.LucideIcon && <tab.LucideIcon size={iconTabSize} strokeWidth={iconTabStroke} />}
            {tab.label}
            {tab.key === 'anchor-detail' && selectedAnchor && !selectedAnchor.resolved && (
              <span className="ml-1 w-2 h-2 bg-[#FADEC9] rounded-full inline-block animate-pulse" />
            )}
            {tab.key === 'highlights' && highlightTopicCount > 0 && (
              <span className="ml-1 text-xs text-skyblue-600">({highlightTopicCount})</span>
            )}
            {tab.key === 'summary' && hasSummary && <span className="ml-1 text-xs text-mint-600">OK</span>}
            {tab.key === 'notes' && notesCount > 0 && (
              <span className="ml-1 text-xs text-[#787774]">({notesCount})</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {reviewTab === 'timeline' && timelineForView && (
          <TimelineView
            timeline={timelineForView}
            currentTime={currentTime}
            selectedBreakpoint={selectedBreakpoint}
            onTimeClick={onTimelineClick}
            onBreakpointClick={(bp) => {
              const anchor = anchors.find((item) => item.id === bp.id);
              if (anchor) onBreakpointSelect(anchor);
            }}
            onSegmentTextUpdate={onSegmentTextUpdate}
            enableWordExplainer={true}
            fullContextText={segments.map((segment) => `[${formatTime(segment.startMs)}] ${segment.text}`).join('\n')}
          />
        )}

        {reviewTab === 'anchor-detail' && (
          <AnchorDetailPanel
            anchor={selectedAnchor}
            segments={segments}
            onSeek={onSeek}
            onPlay={(startMs) => {
              onPlay(startMs);
            }}
            onResolve={onResolveAnchor}
            onAddNote={onAddAnchorNote}
            onClose={() => onReviewTabChange('timeline')}
          />
        )}

        {sharedWorkspaceContent}
      </div>
    </div>
  );
}
