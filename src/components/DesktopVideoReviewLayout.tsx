'use client';

import { type RefObject } from 'react';
import dynamic from 'next/dynamic';
import { MessageCircle, AlertCircle, Clock, Boxes, FileText } from 'lucide-react';
import { useUIStore, useUIActions } from '@/stores/ui-store';
import { usePlayerStore, usePlayerActions } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useMobileAIStore } from '@/stores/mobile-ai-store';
import { ResizablePanel } from '@/components/layout/ResizablePanel';
import { formatTime } from '@/lib/utils/page-utils';
import type { Anchor } from '@/lib/services/anchor-service';
import type { TranscriptSegment, ActionItem, Breakpoint, Timeline, NoteSource, NoteMetadata } from '@/types';
import type {
  SharedWorkspaceTab,
  VideoWorkspaceTab,
  ReviewTab,
  WorkspaceTabConfig,
} from '@/types/page-types';

// ── Dynamic imports (match page.tsx) ───────────────────────────
const VideoReviewPlayer = dynamic(() => import('@/components/VideoReviewPlayer').then(m => ({ default: m.VideoReviewPlayer })), { ssr: false });
const AITutor = dynamic(() => import('@/components/SafeAITutor').then(m => ({ default: m.SafeAITutor })), { ssr: false });
const TranscriptFlowView = dynamic(() => import('@/components/TranscriptFlowView').then(m => ({ default: m.TranscriptFlowView })), { ssr: false });
const VideoInsightTimeline = dynamic(() => import('@/components/VideoInsightTimeline').then(m => ({ default: m.VideoInsightTimeline })), { ssr: false });
const ReviewWorkspacePanel = dynamic(() => import('@/components/ReviewWorkspacePanel').then(m => ({ default: m.ReviewWorkspacePanel })), { ssr: false });
const ReviewTutorPanel = dynamic(() => import('@/components/ReviewTutorPanel').then(m => ({ default: m.ReviewTutorPanel })), { ssr: false });
const ActionSidebar = dynamic(() => import('@/components/ActionSidebar').then(m => ({ default: m.ActionSidebar })), { ssr: false });
const ActionDrawer = dynamic(() => import('@/components/ActionDrawer').then(m => ({ default: m.ActionDrawer })), { ssr: false });

import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
import type { WaveformPlayerRef, WaveformAnchor } from '@/components/WaveformPlayer';

// ── Constants (mirror page.tsx) ────────────────────────────────
const ICON_TAB = 14;
const ICON_TAB_STROKE = 1.75;

const SHARED_WORKSPACE_TABS: WorkspaceTabConfig<SharedWorkspaceTab>[] = [
  { key: 'apps', label: 'AI工坊', icon: '坊', LucideIcon: Boxes, testId: 'review-tab-apps' },
];

const VIDEO_WORKSPACE_TABS: WorkspaceTabConfig<VideoWorkspaceTab>[] = [
  { key: 'transcript', label: '转录原文', icon: '录', LucideIcon: FileText },
  { key: 'chat', label: 'AI同桌', icon: '聊', LucideIcon: MessageCircle },
  { key: 'confusion', label: '困惑点', icon: '疑', LucideIcon: AlertCircle },
  ...SHARED_WORKSPACE_TABS,
];

const REVIEW_WORKSPACE_TABS: WorkspaceTabConfig<ReviewTab>[] = [
  { key: 'timeline', label: '时间轴', icon: '轴', LucideIcon: Clock },
  { key: 'anchor-detail', label: '困惑点', icon: '疑', LucideIcon: AlertCircle },
  ...SHARED_WORKSPACE_TABS,
];

function isSharedWorkspaceTab(tab: string): tab is SharedWorkspaceTab {
  return tab === 'apps';
}

// ── Props ──────────────────────────────────────────────────────

export interface DesktopVideoReviewLayoutProps {
  /** Computed from page.tsx: Math.max(lastSegEnd, sessionMediaDurationMs) */
  totalDuration: number;
  /** user?.id || 'anonymous' */
  studentId: string;
  /** Computed from buildTutorSupportContextText */
  tutorSupportContextText: string;
  /** Computed from selectedAnchor → breakpoint object */
  selectedBreakpoint: Breakpoint | null;
  /** Computed timeline for review panel */
  timelineForView: Timeline | null;
  /** Ref to WaveformPlayer */
  waveformRef: RefObject<WaveformPlayerRef | null>;

  // ── Callbacks ──
  handleUnifiedSeek: (timeMs: number, autoPlay?: boolean) => void;
  handleAnchorMark: (timeMs: number) => void;
  handleAnchorSelect: (anchor: Anchor) => void;
  handleResolveAnchor: () => void;
  handleTranscriptTextUpdate: (segmentId: string, text: string) => void;
  handleActionItemsUpdate: (items: ActionItem[]) => void;
  handleActionComplete: (actionId: string) => void;
  handleStartNextAction: () => void;
  handleTimelineClick: (timeMs: number) => void;
  handlePlaybackAnchorAdd: (timeMs: number) => void;
  handleAddNote: (text: string, source?: NoteSource, metadata?: NoteMetadata) => void;
  renderSharedWorkspacePanel: (tab: SharedWorkspaceTab) => React.ReactNode;
  consumeMobileAIQuestion: () => void;
  /** 手动触发检查点测验（从时间轴点击） */
  onTriggerCheckpoint?: (checkpointIndex: number) => void;
  /** LLM plan 正在加载中（用于骨架屏） */
  isPlanLoading?: boolean;
  /** 受控的 onTimeUpdate 回调（外部可在随堂测验激活时屏蔽更新） */
  onVideoTimeUpdate?: (timeMs: number) => void;
  /** 播放/暂停状态变化回调 — 同步给父组件 */
  onPlayingChange?: (isPlaying: boolean) => void;
}

// ── Component ──────────────────────────────────────────────────

export function DesktopVideoReviewLayout(props: DesktopVideoReviewLayoutProps) {
  const {
    totalDuration,
    studentId,
    tutorSupportContextText,
    selectedBreakpoint,
    timelineForView,
    waveformRef,
    handleUnifiedSeek,
    handleAnchorMark,
    handleAnchorSelect,
    handleResolveAnchor,
    handleTranscriptTextUpdate,
    handleActionItemsUpdate,
    handleActionComplete,
    handleStartNextAction,
    handleTimelineClick,
    handlePlaybackAnchorAdd,
    handleAddNote,
    renderSharedWorkspacePanel,
    consumeMobileAIQuestion,
    onTriggerCheckpoint,
    isPlanLoading,
    onVideoTimeUpdate,
    onPlayingChange,
  } = props;

  // ── Store reads ──
  const uiActions = useUIActions();
  const videoWorkspaceTab = useUIStore((s) => s.videoWorkspaceTab);
  const reviewTab = useUIStore((s) => s.reviewTab);
  const isActionDrawerOpen = useUIStore((s) => s.isActionDrawerOpen);
  const showConversationHistory = useUIStore((s) => s.showConversationHistory);

  const playerActions = usePlayerActions();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  const sessionActions = useSessionStore((s) => s.actions);
  const sessionId = useSessionStore((s) => s.sessionId);
  const videoSeekNonce = useSessionStore((s) => s.videoSeekNonce);
  const videoPlayNonce = useSessionStore((s) => s.videoPlayNonce);
  const videoPauseNonce = useSessionStore((s) => s.videoPauseNonce);
  const selectedAnchor = useSessionStore((s) => s.selectedAnchor);
  const selectedHistoryConversation = useSessionStore((s) => s.selectedHistoryConversation);

  const captureEditorActions = useCaptureEditorStore((s) => s.actions);
  const videoSource = useCaptureEditorStore((s) => s.videoSource);
  const segments = useCaptureEditorStore((s) => s.segments);
  const anchors = useCaptureEditorStore((s) => s.anchors);
  const confusionChatAnchor = useCaptureEditorStore((s) => s.confusionChatAnchor);
  const videoInsightItems = useCaptureEditorStore((s) => s.videoInsightItems);
  const activeVideoInsightId = useCaptureEditorStore((s) => s.activeVideoInsightId);
  const actionItems = useCaptureEditorStore((s) => s.actionItems);
  const audioBlob = useCaptureEditorStore((s) => s.audioBlob);
  const audioUrl = useCaptureEditorStore((s) => s.audioUrl);

  const mobileAIQuestion = useMobileAIStore((s) => s.mobileAIQuestion);
  const mobileAIDisplayQuestion = useMobileAIStore((s) => s.mobileAIDisplayQuestion);
  const mobileAILaunchImages = useMobileAIStore((s) => s.mobileAILaunchImages);
  const mobileAIQuestionNonce = useMobileAIStore((s) => s.mobileAIQuestionNonce);
  const mobileAIConsumedQuestionNonce = useMobileAIStore((s) => s.mobileAIConsumedQuestionNonce);
  const mobileAIPreferSelectedContext = useMobileAIStore((s) => s.mobileAIPreferSelectedContext);
  const mobileAILaunchTarget = useMobileAIStore((s) => s.mobileAILaunchTarget);

  // ── Action aliases ──
  const setVideoWorkspaceTab = uiActions.setVideoWorkspaceTab;
  const setReviewTab = uiActions.setReviewTab;
  const setIsActionDrawerOpen = uiActions.setActionDrawerOpen;
  const setShowConversationHistory = uiActions.setShowConversationHistory;

  const setCurrentTime = playerActions.setCurrentTime;
  const setIsPlaying = playerActions.setIsPlaying;

  const setSelectedAnchor = sessionActions.setSelectedAnchor;
  const setSelectedHistoryConversation = sessionActions.setSelectedHistoryConversation;

  const setConfusionChatAnchor = captureEditorActions.setConfusionChatAnchor;
  const setActiveVideoInsightId = captureEditorActions.setActiveVideoInsightId;

  return (
    <div
      className={`flex-1 min-h-0 flex page-enter ${videoSource ? 'overflow-visible' : 'overflow-hidden'}`}
      style={{ background: '#FFFFFF' }}
    >
      {videoSource ? (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* ── 左列：视频 + 时间轴 + 章节列表 ── */}
          <div className="min-h-0 flex flex-col lg:w-[55%] xl:w-[58%] bg-white">
            {/* 视频播放器 — 圆角容器 + 充分留白 */}
            <div className="shrink-0 p-5 pb-0">
              <div className="overflow-hidden rounded-2xl bg-[#0F0F0F]">
                <VideoReviewPlayer
                  source={videoSource}
                  className="w-full"
                  seekToMs={currentTime}
                  seekNonce={videoSeekNonce}
                  playNonce={videoPlayNonce}
                  pauseNonce={videoPauseNonce}
                  onTimeUpdate={onVideoTimeUpdate || setCurrentTime}
                  onPlayingChange={onPlayingChange}
                  totalDurationMs={totalDuration}
                />
              </div>
            </div>

            {/* 视频下方：时间轴 + 章节列表 */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-5 pt-4 pb-5">
                <VideoInsightTimeline
                  items={videoInsightItems}
                  activeItemId={activeVideoInsightId}
                  totalDuration={totalDuration}
                  formatTime={formatTime}
                  onSelectItem={setActiveVideoInsightId}
                  onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
                  onTriggerCheckpoint={onTriggerCheckpoint}
                  currentTimeMs={currentTime}
                  isPlanLoading={isPlanLoading}
                />
              </div>
            </div>
          </div>

          {/* ── 右列：Transcript / Chat / 困惑点 / AI工坊 ── */}
          <div className="min-h-0 flex flex-col flex-1 bg-white border-l border-[#E9E9E7] overflow-hidden">
            {/* 下划线风格 tab 栏（Longcut 风格） */}
            <div className="shrink-0 px-5 pt-4 flex items-center gap-5 overflow-x-auto">
              {VIDEO_WORKSPACE_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setVideoWorkspaceTab(tab.key);
                    if (tab.key !== 'confusion') setConfusionChatAnchor(null);
                  }}
                  className={`relative flex items-center gap-1.5 pb-3 text-[13px] transition-colors whitespace-nowrap ${
                    videoWorkspaceTab === tab.key
                      ? 'text-[#232322] font-medium'
                      : 'text-[#A3A39E] hover:text-[#787774]'
                  }`}
                >
                  {tab.LucideIcon && <tab.LucideIcon size={ICON_TAB} strokeWidth={ICON_TAB_STROKE} />}
                  {tab.label}
                  {tab.key === 'confusion' && anchors.filter(a => !a.resolved).length > 0 && (
                    <span className="ml-0.5 w-1.5 h-1.5 bg-[#FADEC9] rounded-full inline-block animate-pulse" />
                  )}
                  {/* 下划线指示器 */}
                  {videoWorkspaceTab === tab.key && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#232322] rounded-full" />
                  )}
                </button>
              ))}
            </div>
            <div className="mx-5 h-px bg-[#E9E9E7]" />

            <div className="flex-1 min-h-0 overflow-hidden">
              {/* Transcript tab */}
              {videoWorkspaceTab === 'transcript' && (
                <div className="h-full overflow-y-auto">
                  <TranscriptFlowView
                    segments={segments}
                    variant="video"
                    currentTime={currentTime}
                    editable={true}
                    onSegmentTextUpdate={handleTranscriptTextUpdate}
                    enableWordExplainer={true}
                    enableEnToZhTranslation={true}
                    fullContextText={segments.map(s => `[${formatTime(s.startMs)}] ${s.text}`).join('\n')}
                    onTimestampClick={(timeMs) => handleUnifiedSeek(timeMs, true)}
                    onMarkConfusion={(timeMs, _segmentId) => {
                      handleAnchorMark(timeMs);
                    }}
                    confusionTimestamps={anchors.map(a => ({ timestamp: a.timestamp, resolved: a.resolved }))}
                    defaultExpanded={true}
                    showHeader={false}
                  />
                </div>
              )}

              {/* Chat tab */}
              <div className={`h-full min-h-0 ${videoWorkspaceTab === 'chat' ? '' : 'hidden'}`}>
                  <AITutor
                    breakpoint={null}
                    segments={segments}
                    isLoading={false}
                    onResolve={() => {}}
                    sessionId={sessionId}
                    supportContextText={tutorSupportContextText}
                    preferSupportContext={videoWorkspaceTab === 'chat' && mobileAILaunchTarget === 'video-chat' ? mobileAIPreferSelectedContext : false}
                    launchQuestion={videoWorkspaceTab === 'chat' && mobileAILaunchTarget === 'video-chat' && mobileAIConsumedQuestionNonce !== mobileAIQuestionNonce ? mobileAIQuestion : ''}
                    launchDisplayText={videoWorkspaceTab === 'chat' && mobileAILaunchTarget === 'video-chat' ? mobileAIDisplayQuestion : ''}
                    launchImages={videoWorkspaceTab === 'chat' && mobileAILaunchTarget === 'video-chat' ? mobileAILaunchImages : []}
                    launchQuestionNonce={videoWorkspaceTab === 'chat' && mobileAILaunchTarget === 'video-chat' ? mobileAIQuestionNonce : 0}
                    onLaunchQuestionConsumed={videoWorkspaceTab === 'chat' && mobileAILaunchTarget === 'video-chat' ? consumeMobileAIQuestion : undefined}
                    onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
                  />
              </div>

              {/* Confusion tab */}
              {videoWorkspaceTab === 'confusion' && (
                <div className="h-full overflow-hidden flex flex-col">
                  {confusionChatAnchor ? (
                    <>
                      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[#E9E9E7] bg-[#F7F7F5]">
                        <button
                          onClick={() => setConfusionChatAnchor(null)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#E9E9E7] transition-colors text-[#787774]"
                          title="返回列表"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${confusionChatAnchor.resolved ? 'bg-green-400' : 'bg-[#FADEC9] animate-pulse'}`} />
                          <span className="text-xs font-mono text-gray-500">{formatTime(confusionChatAnchor.timestamp)}</span>
                          {confusionChatAnchor.note && (
                            <span className="text-xs text-gray-600 truncate">{confusionChatAnchor.note}</span>
                          )}
                        </div>
                        {!confusionChatAnchor.resolved && (
                          <button
                            onClick={() => {
                              setSelectedAnchor(confusionChatAnchor);
                              handleResolveAnchor();
                              setConfusionChatAnchor({ ...confusionChatAnchor, resolved: true });
                            }}
                            className="shrink-0 px-2.5 py-1 text-xs rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                          >
                            标记已解决
                          </button>
                        )}
                      </div>
                      <div className="flex-1 min-h-0">
                        <AITutor
                          key={`confusion-${confusionChatAnchor.id}`}
                          breakpoint={{
                            id: confusionChatAnchor.id,
                            lessonId: sessionId,
                            studentId: studentId,
                            timestamp: confusionChatAnchor.timestamp,
                            type: confusionChatAnchor.type as 'confusion' | 'important' | 'question',
                            resolved: confusionChatAnchor.resolved,
                            createdAt: confusionChatAnchor.createdAt,
                          }}
                          segments={segments}
                          isLoading={false}
                          onResolve={() => {
                            setSelectedAnchor(confusionChatAnchor);
                            handleResolveAnchor();
                            setConfusionChatAnchor({ ...confusionChatAnchor, resolved: true });
                          }}
                          sessionId={sessionId}
                          supportContextText={tutorSupportContextText}
                          onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="h-full overflow-y-auto p-4">
                      <button
                        onClick={() => {
                          handleAnchorMark(currentTime);
                        }}
                        className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-[#E9E9E7] text-[#787774] hover:bg-[#EFEFEF] hover:border-[#232322] transition-all text-sm font-medium"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        在当前位置标记困惑 ({formatTime(currentTime)})
                      </button>

                      {anchors.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-[#A3A39E]">{anchors.length} 个困惑点</span>
                            {anchors.filter(a => !a.resolved).length > 0 && (
                              <span className="text-xs text-[#787774]">{anchors.filter(a => !a.resolved).length} 个待解决</span>
                            )}
                          </div>
                          {anchors.map((anchor, index) => (
                            <button
                              key={anchor.id}
                              onClick={() => {
                                setConfusionChatAnchor(anchor);
                                setSelectedAnchor(anchor);
                                handleUnifiedSeek(anchor.timestamp, true);
                              }}
                              className={`w-full text-left p-3 rounded-lg border transition-all group ${
                                anchor.resolved
                                  ? 'border-[#E9E9E7] bg-[#F7F7F5]/50'
                                  : 'border-[#E9E9E7] bg-[#FDF3C0]/10 hover:bg-[#FDF3C0]/20'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${anchor.resolved ? 'bg-[#A3A39E]' : 'bg-[#FADEC9]'}`} />
                                <span className="text-xs font-mono text-[#A3A39E]">{formatTime(anchor.timestamp)}</span>
                                <span className="text-xs text-[#787774]">困惑点 #{index + 1}</span>
                                {anchor.resolved ? (
                                  <span className="text-xs text-[#A3A39E] ml-auto">已解决</span>
                                ) : (
                                <span className="ml-auto text-xs text-[#787774]">点击对话</span>
                                )}
                              </div>
                              {anchor.note && (
                                <p className="mt-1.5 text-[13px] text-[#787774] line-clamp-2 pl-4">{anchor.note}</p>
                              )}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="py-10 text-center">
                          <div className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center bg-[#F7F7F5]">
                            <svg className="w-7 h-7 text-[#A3A39E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <p className="mb-1 text-[13px] text-[#787774]">暂时还没有困惑点</p>
                          <p className="text-[12px] text-[#A3A39E]">点击上方按钮，标记你没听懂的地方。</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isSharedWorkspaceTab(videoWorkspaceTab) && renderSharedWorkspacePanel(videoWorkspaceTab)}
            </div>
          </div>
        </div>
      ) : (
        <>
          <ResizablePanel
            className="flex-1"
            defaultLeftWidth={480}
            minLeftWidth={320}
            maxLeftWidth={820}
            storageKey="meetmind-left-panel-width"
            leftPanel={
              <ReviewWorkspacePanel
                reviewWorkspaceTabs={REVIEW_WORKSPACE_TABS}
                reviewTab={reviewTab}
                onReviewTabChange={setReviewTab}
                selectedAnchor={selectedAnchor}
                iconTabSize={ICON_TAB}
                iconTabStroke={ICON_TAB_STROKE}
                timelineForView={timelineForView}
                currentTime={currentTime}
                selectedBreakpoint={selectedBreakpoint}
                anchors={anchors}
                segments={segments}
                onTimelineClick={handleTimelineClick}
                onBreakpointSelect={handleAnchorSelect}
                onSegmentTextUpdate={handleTranscriptTextUpdate}
                onSeek={handleUnifiedSeek}
                onPlay={(startMs: number) => {
                  waveformRef.current?.seekTo(startMs);
                  waveformRef.current?.play();
                }}
                onResolveAnchor={handleResolveAnchor}
                onAddAnchorNote={(text: string, anchorId: string) => {
                  handleAddNote(text, 'anchor', {
                    anchorId,
                    timestamp: selectedAnchor?.timestamp,
                  });
                }}
                sharedWorkspaceContent={isSharedWorkspaceTab(reviewTab) ? renderSharedWorkspacePanel(reviewTab) : null}
              />
            }
            rightPanel={
              <ReviewTutorPanel
                audioSrc={audioBlob || audioUrl || undefined}
                waveformRef={waveformRef}
                waveformAnchors={anchors.map((anchor) => ({
                  id: anchor.id,
                  timestamp: anchor.timestamp,
                  resolved: anchor.resolved,
                  type: anchor.type,
                } as WaveformAnchor))}
                anchors={anchors}
                selectedAnchor={selectedAnchor}
                onTimeUpdate={setCurrentTime}
                onPlayStateChange={setIsPlaying}
                onAnchorSelect={handleAnchorSelect}
                onAnchorAdd={handlePlaybackAnchorAdd}
                showConversationHistory={showConversationHistory}
                selectedHistoryConversation={selectedHistoryConversation}
                onBackToHistoryList={() => setSelectedHistoryConversation(null)}
                onCloseHistory={() => {
                  setShowConversationHistory(false);
                  setSelectedHistoryConversation(null);
                }}
                onSelectHistoryConversation={setSelectedHistoryConversation}
                onClearSelectedAnchor={() => setSelectedAnchor(null)}
                sessionId={sessionId}
                tutorSupportContextText={tutorSupportContextText}
                onSeek={(timeMs: number) => {
                  handleUnifiedSeek(timeMs, true);
                }}
                tutorBreakpoint={mobileAIPreferSelectedContext && mobileAILaunchTarget === 'review-panel' ? null : selectedBreakpoint}
                segments={segments}
                onResolve={handleResolveAnchor}
                onActionItemsUpdate={handleActionItemsUpdate}
                preferSupportContext={mobileAILaunchTarget === 'review-panel' ? mobileAIPreferSelectedContext : false}
                launchQuestion={mobileAILaunchTarget === 'review-panel' && mobileAIConsumedQuestionNonce !== mobileAIQuestionNonce ? mobileAIQuestion : ''}
                launchDisplayText={mobileAILaunchTarget === 'review-panel' ? mobileAIDisplayQuestion : ''}
                launchImages={mobileAILaunchTarget === 'review-panel' ? mobileAILaunchImages : []}
                launchQuestionNonce={mobileAILaunchTarget === 'review-panel' ? mobileAIQuestionNonce : 0}
                onLaunchQuestionConsumed={mobileAILaunchTarget === 'review-panel' ? consumeMobileAIQuestion : undefined}
              />
            }
          />

          <ActionSidebar
            actionCount={actionItems.filter(i => !i.completed).length}
            totalCount={actionItems.length}
            isDrawerOpen={isActionDrawerOpen}
            onToggleDrawer={() => setIsActionDrawerOpen(!isActionDrawerOpen)}
            onShowHistory={() => {
              setShowConversationHistory(!showConversationHistory);
              if (showConversationHistory) {
                setSelectedHistoryConversation(null);
              }
            }}
            isHistoryActive={showConversationHistory}
          />

          {/* 动作抽屉 */}
          <ActionDrawer
            isOpen={isActionDrawerOpen}
            onClose={() => setIsActionDrawerOpen(false)}
            items={actionItems}
            onComplete={handleActionComplete}
            onStartNext={handleStartNextAction}
          />
        </>
      )}
    </div>
  );
}
