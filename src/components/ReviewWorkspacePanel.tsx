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
  /** 当侧栏已提供 tab 导航时，隐藏面板内的 tab 栏 */
  hideTabBar?: boolean;
}

export function ReviewWorkspacePanel({
  reviewWorkspaceTabs,
  reviewTab,
  onReviewTabChange,
  selectedAnchor,
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
  hideTabBar = false,
}: ReviewWorkspacePanelProps) {
  return (
    <div className="h-full flex flex-col bg-white border-r border-[#E9E9E7]">
      {!hideTabBar && (
      <>
        {/* 下划线风格 tab 栏——与 DesktopVideoReviewLayout 的视频态 tab 保持一致。
            零渐变、零阴影、纯平涂，只靠字重和下划线表达激活态。 */}
        <div className="shrink-0 px-5 pt-4 flex items-center gap-5 overflow-x-auto relative z-10">
          {reviewWorkspaceTabs.map((tab) => (
            <button
              key={tab.key}
              data-testid={tab.testId}
              onClick={() => onReviewTabChange(tab.key)}
              className={`relative flex items-center gap-1.5 pb-3 text-[13px] transition-colors whitespace-nowrap ${
                reviewTab === tab.key
                  ? 'text-[#232322] font-medium'
                  : 'text-[#A3A39E] hover:text-[#787774]'
              }`}
            >
              {tab.LucideIcon && <tab.LucideIcon size={iconTabSize} strokeWidth={iconTabStroke} />}
              {tab.label}
              {tab.key === 'anchor-detail' && selectedAnchor && !selectedAnchor.resolved && (
                <span className="ml-0.5 w-1.5 h-1.5 bg-[#FADEC9] rounded-full inline-block animate-pulse" />
              )}
              {reviewTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#232322] rounded-full" />
              )}
            </button>
          ))}
        </div>
        <div className="mx-5 h-px bg-[#E9E9E7]" />
      </>
      )}

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

        {reviewTab === 'timeline' && !timelineForView && (
          <div className="flex h-full flex-col items-center justify-center px-6">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F7F5]">
              <svg className="h-6 w-6 text-[#A3A39E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="mb-1 text-[13px] font-medium text-[#787774]">这条内容没有时间轴</p>
            <p className="text-center text-[12px] leading-relaxed text-[#A3A39E]">
              音频和视频类的内容才会生成时间轴。<br />
              试试「应用」来和这条内容互动吧。
            </p>
            <button
              type="button"
              onClick={() => onReviewTabChange('apps')}
              className="mt-4 rounded-lg bg-[#232322] px-4 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#111111]"
            >
              打开应用
            </button>
          </div>
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
