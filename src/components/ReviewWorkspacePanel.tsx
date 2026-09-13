'use client';

import type { ReactNode } from 'react';
import { MomentList } from '@/components/review/MomentList';
import { TimelineView } from '@/components/TimelineView';
import { AnchorDetailPanel } from '@/components/AnchorDetailPanel';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { useOctoMood } from '@/lib/hooks/useOctoMood';
import { formatTime } from '@/lib/utils/page-utils';
import { COPY } from '@/lib/ui/copy';
import type { Anchor, Timeline, TranscriptSegment } from '@/types';
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
  /** 非音视频类型的原文（文章/笔记），无时间轴时展示 */
  sourceFullText?: string;
  /** 非音视频类型的正文图片 URL 列表 */
  sourceImageUrls?: string[];
  /** 课中「截取这一页」关键帧（按时间轴插入转录流） */
  keyframes?: Array<{ timestampMs: number; src: string }>;
  /** 时间轴 tab 顶部的一块（2026-09-13：同学讲的课 → 这节课的材料卡）；没有就不占位 */
  headerSlot?: ReactNode;
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
  sourceFullText,
  sourceImageUrls,
  keyframes,
  headerSlot,
}: ReviewWorkspacePanelProps) {
  // v7 Octo IP：复习态空态。ctx='review-empty'（默认 idle，凌晨切 sleeping）
  const { mood: octoMoodEmpty } = useOctoMood({ ctx: 'review-empty' });
  return (
    <div className="h-full flex flex-col bg-card border-r border-divider">
      {!hideTabBar && (
      <>
        {/* v7 tab 栏：激活态用 pine 主签名色（"AI 在场"信号），不再纯黑下划线。
            未激活态保持安静；hover 走 pine 微提示。 */}
        <div className="shrink-0 px-5 pt-4 flex items-center gap-5 overflow-x-auto relative z-10">
          {reviewWorkspaceTabs.map((tab) => (
            <button
              key={tab.key}
              data-testid={tab.testId}
              onClick={() => onReviewTabChange(tab.key)}
              className={`relative flex items-center gap-1.5 pb-3 text-[13px] transition-colors whitespace-nowrap ${
                reviewTab === tab.key
                  ? 'text-pine font-semibold'
                  : 'text-ink-muted hover:text-pine/75'
              }`}
            >
              {tab.LucideIcon && <tab.LucideIcon size={iconTabSize} strokeWidth={iconTabStroke} />}
              {tab.label}
              {tab.key === 'anchor-detail' && selectedAnchor && !selectedAnchor.resolved && (
                <span className="ml-0.5 w-1.5 h-1.5 bg-vermilion/65 rounded-full inline-block animate-pulse" />
              )}
              {reviewTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-pine rounded-full" />
              )}
            </button>
          ))}
        </div>
        <div className="mx-5 h-px bg-divider" />
      </>
      )}

      {reviewTab === 'timeline' && headerSlot ? <div className="shrink-0">{headerSlot}</div> : null}
      <div className="flex-1 min-h-0 overflow-hidden">
        {reviewTab === 'timeline' && timelineForView && (
          <TimelineView
            timeline={timelineForView}
            currentTime={currentTime}
            onTimeClick={onTimelineClick}
            onBreakpointClick={(bp) => {
              const anchor = anchors.find((item) => item.id === bp.id);
              if (anchor) onBreakpointSelect(anchor);
            }}
            onSegmentTextUpdate={onSegmentTextUpdate}
            enableWordExplainer={true}
            keyframes={keyframes}
            fullContextText={segments.map((segment) => `[${formatTime(segment.startMs)}] ${segment.text}`).join('\n')}
          />
        )}

        {reviewTab === 'timeline' && !timelineForView && sourceFullText && (
          <div className="h-full overflow-y-auto px-6 py-5">
            {/* 文章图片：最多展示 3 张，避免过长 */}
            {sourceImageUrls && sourceImageUrls.length > 0 && (
              <div className="mb-5 flex flex-col gap-3">
                {sourceImageUrls.slice(0, 3).map((imgUrl, i) => (
                  <img
                    key={i}
                    src={imgUrl}
                    alt=""
                    className="max-h-[240px] w-full rounded-lg object-cover shadow-soft"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ))}
              </div>
            )}
            <div className="prose prose-sm max-w-none text-[13.5px] leading-[1.8] text-ink">
              {sourceFullText.split('\n').map((paragraph, i) => (
                paragraph.trim() ? (
                  <p key={i} className="mb-4">
                    {paragraph}
                  </p>
                ) : (
                  <div key={i} className="h-2" />
                )
              ))}
            </div>
          </div>
        )}

        {reviewTab === 'timeline' && !timelineForView && !sourceFullText && (
          // 空态一句 + 一个动作；此前三处衬线斜体强调与硬编码中文（2026-09-10 收进 COPY.reviewTutor.noTimeline）
          <div className="flex h-full flex-col items-center justify-center px-6">
            <OctoAvatar mood={octoMoodEmpty === 'sleeping' ? 'sleeping' : 'thinking'} size="lg" aura className="mb-4" />
            <p className="mb-1 text-[15px] font-semibold text-ink">{COPY.reviewTutor.noTimeline.title}</p>
            <p className="max-w-[18rem] text-center text-[12.5px] leading-relaxed text-ink-muted">
              {octoMoodEmpty === 'sleeping' ? COPY.reviewTutor.noTimeline.bodyNight : COPY.reviewTutor.noTimeline.body}
            </p>
            <button
              type="button"
              onClick={() => onReviewTabChange('apps')}
              className="mm-press mt-5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white shadow-soft hover:opacity-85"
            >
              {COPY.reviewTutor.noTimeline.action}
            </button>
          </div>
        )}

        {reviewTab === 'anchor-detail' && !selectedAnchor && (
          // 没选中任何一处：按名字列出这节课标下的每一刻（此前是让人去波形上找红点的空态）
          <MomentList anchors={anchors} segments={segments} onSelect={onBreakpointSelect} />
        )}
        {reviewTab === 'anchor-detail' && selectedAnchor && (
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
