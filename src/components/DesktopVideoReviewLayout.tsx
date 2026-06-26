'use client';

import { useCallback, useMemo, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';
import { MessageCircle, AlertCircle, Clock, Boxes, FileText, ListChecks } from 'lucide-react';
import { useUIStore, useUIActions } from '@/stores/ui-store';
import { usePlayerStore, usePlayerActions } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useMobileAIStore } from '@/stores/mobile-ai-store';
import { ReviewThreePaneLayout } from '@/components/ReviewThreePaneLayout';
import { formatTime } from '@/lib/utils/page-utils';
import { toReviewCurrentTimeSec } from './desktop-video-review-layout-model';
import {
  appendReviewLearningActivity,
  closeReviewLearningApp,
  createReviewLearningBlackboard,
  formatReviewBlackboardForTutorAgent,
  openReviewLearningApp,
} from './review-learning-blackboard';
import type { Anchor } from '@/lib/services/anchor-service';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { TranscriptSegment, ActionItem, Breakpoint, Timeline, NoteSource, NoteMetadata } from '@/types';
import type {
  SharedWorkspaceTab,
  VideoWorkspaceTab,
  ReviewTab,
  WorkspaceTabConfig,
} from '@/types/page-types';

// ── Dynamic imports (match page.tsx) ───────────────────────────
const VideoReviewPlayer = dynamic(() => import('@/components/VideoReviewPlayer').then(m => ({ default: m.VideoReviewPlayer })), { ssr: false });
const SafeAITutor = dynamic(() => import('@/components/SafeAITutor').then(m => ({ default: m.SafeAITutor })), { ssr: false });
const TranscriptFlowView = dynamic(() => import('@/components/TranscriptFlowView').then(m => ({ default: m.TranscriptFlowView })), { ssr: false });
const VideoInsightTimeline = dynamic(() => import('@/components/VideoInsightTimeline').then(m => ({ default: m.VideoInsightTimeline })), { ssr: false });
const ReviewWorkspacePanel = dynamic(() => import('@/components/ReviewWorkspacePanel').then(m => ({ default: m.ReviewWorkspacePanel })), { ssr: false });
const ReviewTutorPanel = dynamic(() => import('@/components/ReviewTutorPanel').then(m => ({ default: m.ReviewTutorPanel })), { ssr: false });
const WaveformPlayer = dynamic(() => import('@/components/WaveformPlayer').then(m => ({ default: m.WaveformPlayer })), { ssr: false });
const ActionSidebar = dynamic(() => import('@/components/ActionSidebar').then(m => ({ default: m.ActionSidebar })), { ssr: false });
const ActionDrawer = dynamic(() => import('@/components/ActionDrawer').then(m => ({ default: m.ActionDrawer })), { ssr: false });

import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
import type { WaveformPlayerRef, WaveformAnchor } from '@/components/WaveformPlayer';

// ── Constants (mirror page.tsx) ────────────────────────────────
const ICON_TAB = 14;
const ICON_TAB_STROKE = 1.75;

const SHARED_WORKSPACE_TABS: WorkspaceTabConfig<SharedWorkspaceTab>[] = [
  { key: 'apps', label: '应用', icon: '坊', LucideIcon: Boxes, testId: 'review-tab-apps' },
];

const VIDEO_WORKSPACE_TABS: WorkspaceTabConfig<VideoWorkspaceTab>[] = [
  { key: 'transcript', label: '转录原文', icon: '录', LucideIcon: FileText },
  { key: 'confusion', label: '困惑点', icon: '疑', LucideIcon: AlertCircle },
  ...SHARED_WORKSPACE_TABS,
];

const REVIEW_WORKSPACE_TABS: WorkspaceTabConfig<ReviewTab>[] = [
  { key: 'timeline', label: '时间轴', icon: '轴', LucideIcon: Clock },
  { key: 'anchor-detail', label: '困惑点', icon: '疑', LucideIcon: AlertCircle },
  { key: 'feed', label: '信息流', icon: '流', LucideIcon: ListChecks, testId: 'review-tab-feed' },
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
  handlePlaybackAnchorAdd: (timeMs: number) => void;
  handleAddNote: (text: string, source?: NoteSource, metadata?: NoteMetadata) => void;
  renderSharedWorkspacePanel: (tab: SharedWorkspaceTab, options?: {
    activeAppKey?: WorkshopAppKey | null;
    onActiveAppChange?: (appKey: WorkshopAppKey | null) => void;
    onLearningActivity?: (line: string) => void;
  }) => React.ReactNode;
  consumeMobileAIQuestion: () => void;
  /** 手动触发检查点测验（从时间轴点击） */
  onTriggerCheckpoint?: (checkpointIndex: number) => void;
  /** LLM plan 正在加载中（用于骨架屏） */
  isPlanLoading?: boolean;
  /** 受控的 onTimeUpdate 回调（外部可在随堂测验激活时屏蔽更新） */
  onVideoTimeUpdate?: (timeMs: number) => void;
  /** 播放/暂停状态变化回调 — 同步给父组件 */
  onPlayingChange?: (isPlaying: boolean) => void;
  /** 非音视频类型的原文（文章/笔记），无时间轴时展示 */
  sourceFullText?: string;
  /** 非音视频类型的正文图片 URL 列表 */
  sourceImageUrls?: string[];
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
    handlePlaybackAnchorAdd,
    handleAddNote,
    renderSharedWorkspacePanel,
    consumeMobileAIQuestion,
    onTriggerCheckpoint,
    isPlanLoading,
    onVideoTimeUpdate,
    onPlayingChange,
    sourceFullText,
    sourceImageUrls,
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
  const currentTimeSec = toReviewCurrentTimeSec(currentTime);
  const effectiveVideoWorkspaceTab = videoWorkspaceTab === 'chat' ? 'transcript' : videoWorkspaceTab;
  const [reviewBlackboard, setReviewBlackboard] = useState(() => createReviewLearningBlackboard());
  const activeReviewAppKey = reviewBlackboard.activeAppKey;
  const learningActivityContext = useMemo(
    () => formatReviewBlackboardForTutorAgent(reviewBlackboard),
    [reviewBlackboard],
  );
  const setActiveReviewApp = useCallback((appKey: WorkshopAppKey | null) => {
    setReviewBlackboard((prev) => (
      appKey ? openReviewLearningApp(prev, appKey, 'workspace') : closeReviewLearningApp(prev)
    ));
  }, []);
  const appendLearningActivity = useCallback((line: string) => {
    setReviewBlackboard((prev) => appendReviewLearningActivity(prev, line));
  }, []);
  const openAppInWorkspace = useCallback((appKey: WorkshopAppKey) => {
    setReviewBlackboard((prev) => openReviewLearningApp(prev, appKey, 'tutor'));
    setReviewTab('apps');
    setVideoWorkspaceTab('apps');
  }, [setReviewTab, setVideoWorkspaceTab]);
  const sharedWorkspace = renderSharedWorkspacePanel('apps', {
    activeAppKey: activeReviewAppKey,
    onActiveAppChange: setActiveReviewApp,
    onLearningActivity: appendLearningActivity,
  });
  const evidenceTabs = REVIEW_WORKSPACE_TABS.filter((tab) => tab.key !== 'apps');

  return (
    <div
      className="flex-1 min-h-0 flex overflow-hidden page-enter"
      style={{ background: '#FFFFFF' }}
    >
      {videoSource ? (
        <ReviewThreePaneLayout
          mode="video"
          storageKey="meetmind-review-three-pane-video"
          sourceLabel="课堂证据"
          workspaceLabel="学习区"
          tutorLabel="同桌"
          source={(
            <div className="min-w-0 min-h-0 flex h-full flex-col bg-white">
          {/* ── 左列：视频 + 时间轴 + 章节列表 ── */}
            {/* 视频播放器 — 圆角容器 + 充分留白 */}
            <div className="shrink-0 p-5 pb-0">
              <div className="overflow-hidden rounded-2xl bg-ink">
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

            {/* 视频下方：时间轴 + 章节列表
                注意：转录原文不在左栏 fallback——中栏 tab "转录原文" 已经承担转录展示，
                左栏再 fallback 一份会造成同一信息双栏重复，违反 UI 第一性原理。 */}
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
          )}
          workspace={(
            <div className="min-w-0 min-h-0 flex h-full flex-col bg-white overflow-hidden">
          {/* ── 中列：转录 / 困惑点 / 学习应用 ── */}
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
                    effectiveVideoWorkspaceTab === tab.key
                      ? 'text-pine font-semibold'
                      : 'text-ink-muted hover:text-pine/75'
                  }`}
                >
                  {tab.LucideIcon && <tab.LucideIcon size={ICON_TAB} strokeWidth={ICON_TAB_STROKE} />}
                  {tab.label}
                  {tab.key === 'confusion' && anchors.filter(a => !a.resolved).length > 0 && (
                    <span className="ml-0.5 w-1.5 h-1.5 bg-vermilion/55 rounded-full inline-block animate-pulse" />
                  )}
                  {/* 下划线指示器 */}
                  {effectiveVideoWorkspaceTab === tab.key && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-pine rounded-full" />
                  )}
                </button>
              ))}
            </div>
            <div className="mx-5 h-px bg-divider" />

            <div className="flex-1 min-h-0 overflow-hidden">
              {/* Transcript tab */}
              {effectiveVideoWorkspaceTab === 'transcript' && (
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

              {/* Confusion tab */}
              {effectiveVideoWorkspaceTab === 'confusion' && (
                <div className="h-full overflow-hidden flex flex-col">
                  {confusionChatAnchor ? (
                    <>
                      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-divider bg-paper-warm">
                        <button
                          onClick={() => setConfusionChatAnchor(null)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-divider transition-colors text-ink-secondary"
                          title="返回列表"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${confusionChatAnchor.resolved ? 'bg-pine-light' : 'bg-vermilion/55 animate-pulse'}`} />
                          <span className="text-xs font-mono text-ink-muted">{formatTime(confusionChatAnchor.timestamp)}</span>
                          {confusionChatAnchor.note && (
                            <span className="text-xs text-ink-secondary truncate">{confusionChatAnchor.note}</span>
                          )}
                        </div>
                        {!confusionChatAnchor.resolved && (
                          <button
                            onClick={() => {
                              setSelectedAnchor(confusionChatAnchor);
                              handleResolveAnchor();
                              setConfusionChatAnchor({ ...confusionChatAnchor, resolved: true });
                            }}
                            className="shrink-0 px-2.5 py-1 text-xs rounded-lg bg-pine-fog text-pine hover:bg-pine-mist transition-colors"
                          >
                            标记已解决
                          </button>
                        )}
                      </div>
                      <div className="flex-1 min-h-0">
                        <SafeAITutor
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
                          currentTimeSec={currentTimeSec}
                          onOpenAppInWorkspace={openAppInWorkspace}
                          learningActivityContext={learningActivityContext}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="h-full overflow-y-auto p-4">
                      <button
                        onClick={() => {
                          handleAnchorMark(currentTime);
                        }}
                        className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-divider text-ink-secondary hover:bg-paper-warm hover:border-pine transition-all text-sm font-medium"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        在当前位置标记困惑 ({formatTime(currentTime)})
                      </button>

                      {anchors.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-ink-muted">{anchors.length} 个困惑点</span>
                            {anchors.filter(a => !a.resolved).length > 0 && (
                              <span className="text-xs text-ink-secondary">{anchors.filter(a => !a.resolved).length} 个待解决</span>
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
                                  ? 'border-divider bg-paper-warm/50'
                                  : 'border-divider bg-[#FDF3C0]/10 hover:bg-[#FDF3C0]/20'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${anchor.resolved ? 'bg-ink-muted' : 'bg-vermilion/55'}`} />
                                <span className="text-xs font-mono text-ink-muted">{formatTime(anchor.timestamp)}</span>
                                <span className="text-xs text-ink-secondary">困惑点 #{index + 1}</span>
                                {anchor.resolved ? (
                                  <span className="text-xs text-ink-muted ml-auto">已解决</span>
                                ) : (
                                <span className="ml-auto text-xs text-ink-secondary">点击对话</span>
                                )}
                              </div>
                              {anchor.note && (
                                <p className="mt-1.5 text-[13px] text-ink-secondary line-clamp-2 pl-4">{anchor.note}</p>
                              )}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="py-10 text-center">
                          <div className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center bg-paper-warm">
                            <svg className="w-7 h-7 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <p className="mb-1 text-[13px] text-ink-secondary">暂时还没有困惑点</p>
                          <p className="text-[12px] text-ink-muted">点击上方按钮，标记你没听懂的地方。</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {isSharedWorkspaceTab(effectiveVideoWorkspaceTab) && sharedWorkspace}
            </div>
            </div>
          )}
          tutor={(
            <div className="min-w-0 min-h-0 flex h-full flex-col bg-white">
          {/* ── 右列：同桌解释与复盘 ── */}
            <SafeAITutor
              breakpoint={null}
              segments={segments}
              isLoading={false}
              onResolve={() => {}}
              sessionId={sessionId}
              supportContextText={tutorSupportContextText}
              preferSupportContext={mobileAILaunchTarget === 'video-chat' ? mobileAIPreferSelectedContext : false}
              launchQuestion={mobileAILaunchTarget === 'video-chat' && mobileAIConsumedQuestionNonce !== mobileAIQuestionNonce ? mobileAIQuestion : ''}
              launchDisplayText={mobileAILaunchTarget === 'video-chat' ? mobileAIDisplayQuestion : ''}
              launchImages={mobileAILaunchTarget === 'video-chat' ? mobileAILaunchImages : []}
              launchQuestionNonce={mobileAILaunchTarget === 'video-chat' ? mobileAIQuestionNonce : 0}
              onLaunchQuestionConsumed={mobileAILaunchTarget === 'video-chat' ? consumeMobileAIQuestion : undefined}
              onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
              currentTimeSec={currentTimeSec}
              onOpenAppInWorkspace={openAppInWorkspace}
              learningActivityContext={learningActivityContext}
            />
            </div>
          )}
        />
      ) : (
        <>
          <ReviewThreePaneLayout
            mode="audio"
            storageKey="meetmind-review-three-pane-audio"
            sourceLabel="课堂证据"
            workspaceLabel="学习区"
            tutorLabel="同桌"
            source={(
              <section className="min-w-0 min-h-0 flex h-full flex-col bg-white">
              {(audioBlob || audioUrl) ? (
                <div className="shrink-0 border-b border-divider bg-[#FCFBF8] px-3 py-2">
                  <WaveformPlayer
                    ref={waveformRef as RefObject<WaveformPlayerRef>}
                    src={audioBlob || audioUrl || undefined}
                    anchors={anchors.map((anchor) => ({
                      id: anchor.id,
                      timestamp: anchor.timestamp,
                      resolved: anchor.resolved,
                      type: anchor.type,
                    } as WaveformAnchor))}
                    onTimeUpdate={setCurrentTime}
                    onPlayStateChange={setIsPlaying}
                    onAnchorClick={(anchor) => {
                      const found = anchors.find((item) => item.id === anchor.id);
                      if (found) handleAnchorSelect(found);
                    }}
                    onAnchorAdd={handlePlaybackAnchorAdd}
                    allowAddAnchor={true}
                    selectedAnchorId={selectedAnchor?.id}
                    compact={true}
                    height={24}
                    waveColor="#6B9080"
                    progressColor="#2D4F3E"
                  />
                </div>
              ) : null}
              <ReviewWorkspacePanel
                reviewWorkspaceTabs={evidenceTabs}
                reviewTab={reviewTab === 'apps' ? 'timeline' : reviewTab}
                onReviewTabChange={setReviewTab}
                selectedAnchor={selectedAnchor}
                iconTabSize={ICON_TAB}
                iconTabStroke={ICON_TAB_STROKE}
                timelineForView={timelineForView}
                currentTime={currentTime}
                anchors={anchors}
                segments={segments}
                onTimelineClick={(timeMs) => handleUnifiedSeek(timeMs, true)}
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
                sharedWorkspaceContent={null}
                sourceFullText={sourceFullText}
                sourceImageUrls={sourceImageUrls}
              />
              </section>
            )}
            workspace={(
              <main className="min-w-0 min-h-0 h-full bg-white">
              <div className="flex h-full min-h-0 flex-col">
                <header className="flex shrink-0 items-center gap-2 border-b border-divider bg-white px-4 py-3">
                  <ListChecks size={15} strokeWidth={1.8} className="text-ink-secondary" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold tracking-[-0.01em] text-ink">学习工作区</p>
                    <p className="text-[11.5px] text-ink-muted">闪卡、测验、导图都在这里完成</p>
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-hidden">{sharedWorkspace}</div>
              </div>
              </main>
            )}
            tutor={(
              <div className="min-w-0 min-h-0 h-full bg-white">
              <ReviewTutorPanel
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
                onShowHistory={() => {
                  setShowConversationHistory(true);
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
                currentTimeSecOverride={currentTimeSec}
                onOpenAppInWorkspace={openAppInWorkspace}
                learningActivityContext={learningActivityContext}
              />
              </div>
            )}
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
