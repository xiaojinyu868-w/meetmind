'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { hasActiveScreenTrack, captureCurrentFrame } from '@/lib/services/keyframe/screen-frame-grabber';
import { lockLessonTitleByUser } from '@/lib/services/lesson-title-client';
import { useUIActions, useUIStore, type MobileSubPage } from '@/stores/ui-store';
import { usePlayerStore } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { useEchoStore } from '@/stores/echo-store';
import { useMobileAIStore } from '@/stores/mobile-ai-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { ServiceStatus, DegradedModeBanner } from '@/components/ServiceStatus';
import { DesktopSidebar } from '@/components/DesktopSidebar';

import { GUEST_DEMO_LESSON_TITLE, resolveGuestDemoEntry } from '@/components/classroom/guest-demo-entry';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { type Anchor } from '@/lib/services/anchor-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';

import { useAuth } from '@/lib/hooks/useAuth';
import { runMemoryMigration } from '@/lib/services/memory-migration';
import { fetchAndBackfillWorkspaceEvidence } from '@/lib/services/workspace-evidence-client';
import { ANONYMOUS_USER_ID, saveAudioSession, updateSessionStatus, getPreference } from '@/lib/db';

import { buildSelectedCollectionContextText, getCollectionContextTypeLabel } from '@/lib/capture/collection-context';

import { useReviewSession } from '@/hooks/useReviewSession';
import { useEchoActions } from '@/hooks/useEchoActions';
import { useWorkshopWindows } from '@/hooks/useWorkshopWindows';
import { useWorkspaceCaptureActions } from '@/hooks/useWorkspaceCaptureActions';
import { useSourceImport } from '@/hooks/useSourceImport';
import { useCollectionComposer } from '@/hooks/useCollectionComposer';
import { useCollectionPulse } from '@/hooks/useCollectionPulse';
import { useTutorLauncher } from '@/hooks/useTutorLauncher';
import { useTranscriptIngest } from '@/hooks/useTranscriptIngest';
import { useRecordingLifecycle } from '@/hooks/useRecordingLifecycle';
import { useTranscriptHandlers } from '@/hooks/useTranscriptHandlers';
import { useAudioMessagePlayback } from '@/hooks/useAudioMessagePlayback';
import { useCollectionListActions } from '@/hooks/useCollectionListActions';
import { useWechatCaptureImport } from '@/hooks/useWechatCaptureImport';
import { useWorkspaceContextLoader } from '@/hooks/useWorkspaceContextLoader';
import { useAnchorActions } from '@/hooks/useAnchorActions';
import { useSeekController } from '@/hooks/useSeekController';
import { useAppStateRestore } from '@/hooks/useAppStateRestore';
import { usePendingRecordedAudio } from '@/hooks/usePendingRecordedAudio';
import { useNoteActions } from '@/hooks/useNoteActions';
import { useActionItems } from '@/hooks/useActionItems';
import { useExtractTerms } from '@/hooks/useExtractTerms';
import { useSourceItemManagement } from '@/hooks/useSourceItemManagement';
import type {
  TranscriptSegment,
  ActionItem,
} from '@/types';
import type {
  SharedWorkspaceTab,
  ReviewTab,
  VideoWorkspaceTab,
  SourceIngestRole,
  SourceIngestItem,
  SupportReferenceItem,
  DailyEchoRefreshPayload,
} from '@/types/page-types';
import {
  ENABLE_ECHO_MANUAL_TRIGGER,
  VIDEO_INSIGHT_COLORS,
  compactText,
  compactMultilineText,
  resolveSourceItemSourceKey,
  buildCollectionListItemFromSourceItem,
  formatRelativeCollectionTime,
} from '@/lib/utils/page-utils';
import { useResponsive } from '@/hooks/useResponsive';
import { UIConfig } from '@/lib/config';
import { COPY } from '@/lib/ui/copy';

// SWR data hooks for API state management.
import { useTopics, useSummary } from '@/hooks/data';
import { useLessonDigest } from '@/hooks/useLessonDigest';

import type { WaveformPlayerRef, WaveformAnchor } from '@/components/WaveformPlayer';
import { Recorder, type RecorderHandle } from '@/components/Recorder';
import { useClassCheck } from '@/hooks/useClassCheck';
import type { ClassCheckHighlight } from '@/app/api/class-check/plan/route';
import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
const WaveformPlayer = dynamic(() => import('@/components/WaveformPlayer').then(m => ({ default: m.WaveformPlayer })), { ssr: false });
const EchoShareCard = dynamic(() => import('@/components/EchoShareCard').then(m => ({ default: m.EchoShareCard })), { ssr: false });
const WorkspaceCaptureEditorModal = dynamic(() => import('@/components/WorkspaceCaptureEditorModal').then(m => ({ default: m.WorkspaceCaptureEditorModal })), { ssr: false });
const CollectionMessageActionSheet = dynamic(() => import('@/components/CollectionMessageActionSheet').then(m => ({ default: m.CollectionMessageActionSheet })), { ssr: false });
const ClassCheckOverlay = dynamic(() => import('@/components/ClassCheckOverlay').then(m => ({ default: m.ClassCheckOverlay })), { ssr: false });
const ClassCheckToast = dynamic(() => import('@/components/ClassCheckToast').then(m => ({ default: m.ClassCheckToast })), { ssr: false });
import { AppLoading } from '@/components/AppLoading';
import { CollectionCard } from '@/components/CollectionCard';
import { CollectionEmptyState } from '@/components/CollectionEmptyState';
import { DesktopCollectionLayout } from '@/components/DesktopCollectionLayout';
const LessonDigestCard = dynamic(() => import('@/components/LessonDigestCard').then(m => ({ default: m.LessonDigestCard })), { ssr: false });
const ClassroomView = dynamic(() => import('@/components/ClassroomView').then(m => ({ default: m.ClassroomView })), { ssr: false });
import {
  Mic,
  ChevronRight,
  X,
  ChevronsDown,
  Boxes,
  Sparkles,
  Search,
  Camera,
  Edit3,
  Paperclip,
} from 'lucide-react';

// --- Performance: Dynamic imports for heavy components (code-split) ---
// These components are not needed for initial render and are lazy-loaded
// to drastically reduce the main JS bundle size.
const ActionList = dynamic(() => import('@/components/ActionList').then(m => ({ default: m.ActionList })), { ssr: false });
const DesktopVideoReviewLayout = dynamic(
  () => import('@/components/DesktopVideoReviewLayout').then(m => ({ default: m.DesktopVideoReviewLayout })),
  { ssr: false }
);
// NOTE: ActionSidebar, ActionDrawer, ResizablePanel, VideoReviewPlayer, TranscriptFlowView,
// VideoInsightTimeline, ReviewWorkspacePanel, ReviewTutorPanel → now imported inside DesktopVideoReviewLayout.
const VideoReviewPlayer = dynamic(() => import('@/components/VideoReviewPlayer').then(m => ({ default: m.VideoReviewPlayer })), { ssr: false });

import type { ConfusionMarker } from '@/components/mobile/PodcastPlayer';

// Workspace components - dynamic loaded
const SharedWorkspacePanel = dynamic(() => import('@/components/SharedWorkspacePanel').then(m => ({ default: m.SharedWorkspacePanel })), { ssr: false });
const CollectionSelectionBar = dynamic(() => import('@/components/CollectionSelectionBar').then(m => ({ default: m.CollectionSelectionBar })), { ssr: false });
const CollectionComposerContextPreview = dynamic(() => import('@/components/CollectionComposerContextPreview').then(m => ({ default: m.CollectionComposerContextPreview })), { ssr: false });
const CollectionComposerBar = dynamic(() => import('@/components/CollectionComposerBar').then(m => ({ default: m.CollectionComposerBar })), { ssr: false });
const WorkshopWindowManager = dynamic(() => import('@/components/apps/windows/WorkshopWindowManager').then(m => ({ default: m.WorkshopWindowManager })), { ssr: false });
const GlobalAskPanel = dynamic(() => import('@/components/GlobalAskPanel').then(m => ({ default: m.GlobalAskPanel })), { ssr: false });
import type { WorkspaceCaptureListItem } from '@/components/WorkspaceCaptureList';

// Lazy-load demo data.
let DEMO_DATA_CACHE: { DEMO_SEGMENTS: TranscriptSegment[]; DEMO_ANCHORS: Anchor[]; DEMO_AUDIO_URL: string } | null = null;
const loadDemoData = async () => {
  if (DEMO_DATA_CACHE) return DEMO_DATA_CACHE;
  const data = await import('@/fixtures/demo-data');
  DEMO_DATA_CACHE = {
    DEMO_SEGMENTS: data.DEMO_SEGMENTS,
    DEMO_ANCHORS: data.DEMO_ANCHORS,
    DEMO_AUDIO_URL: data.DEMO_AUDIO_URL,
  };
  return DEMO_DATA_CACHE;
};

// Mobile components - dynamic loaded (only needed on mobile)
const MiniPlayer = dynamic(() => import('@/components/mobile/MiniPlayer').then(m => ({ default: m.MiniPlayer })), { ssr: false });
const DedaoTimeline = dynamic(() => import('@/components/mobile/DedaoTimeline').then(m => ({ default: m.DedaoTimeline })), { ssr: false });
import { toDedaoEntries } from '@/components/mobile/DedaoTimeline';
const DedaoConfusionCard = dynamic(() => import('@/components/mobile/DedaoConfusionCard').then(m => ({ default: m.DedaoConfusionCard })), { ssr: false });
const DedaoMenu = dynamic(() => import('@/components/mobile/DedaoMenu').then(m => ({ default: m.DedaoMenu })), { ssr: false });
const MobileTopBar = dynamic(() => import('@/components/mobile/MobileTopBar').then(m => ({ default: m.MobileTopBar })), { ssr: false });
const MobileRecordTopBar = dynamic(() => import('@/components/mobile/MobileRecordTopBar').then(m => ({ default: m.MobileRecordTopBar })), { ssr: false });
const MobileAIFab = dynamic(() => import('@/components/mobile/MobileAIFab').then(m => ({ default: m.MobileAIFab })), { ssr: false });
const MobileReviewSheet = dynamic(() => import('@/components/mobile/MobileReviewSheet').then(m => ({ default: m.MobileReviewSheet })), { ssr: false });
const MobileCollectionCard = dynamic(() => import('@/components/mobile/MobileCollectionCard').then(m => ({ default: m.MobileCollectionCard })), { ssr: false });
const MobileAppShell = dynamic(() => import('@/components/mobile/MobileAppShell').then(m => ({ default: m.MobileAppShell })), { ssr: false });
const SafeAITutor = dynamic(() => import('@/components/SafeAITutor').then(m => ({ default: m.SafeAITutor })), { ssr: false });
const MobileAIChatPanel = dynamic(() => import('@/components/mobile/MobileAIChatPanel').then(m => ({ default: m.MobileAIChatPanel })), { ssr: false });
const MobileCollectionSheet = dynamic(() => import('@/components/mobile/MobileCollectionSheet').then(m => ({ default: m.MobileCollectionSheet })), { ssr: false });
const MobileAppsSubPage = dynamic(() => import('@/components/mobile/MobileAppsSubPage').then(m => ({ default: m.MobileAppsSubPage })), { ssr: false });
const MobileSimpleSubPage = dynamic(() => import('@/components/mobile/MobileAppsSubPage').then(m => ({ default: m.MobileSimpleSubPage })), { ssr: false });

// ── Types → @/types/page-types · Utils → @/lib/utils/page-utils ──

function StudentAppContent({
  isGuestFastEntry,
  forcedWorkspaceTab,
  initialClaimedCaptureId = null,
  forceMobilePreview = false,
  wechatCaptureToken = null,
  initialMobileSubPage = null,
  autoLoadDemo = false,
  autoOpenDemoAppKey,
  initialGlobalAskView,
  initialMemoryFocus,
}: {
  isGuestFastEntry: boolean;
  forcedWorkspaceTab: SharedWorkspaceTab | null;
  initialClaimedCaptureId?: string | null;
  forceMobilePreview?: boolean;
  wechatCaptureToken?: string | null;
  initialMobileSubPage?: MobileSubPage;
  autoLoadDemo?: boolean;
  autoOpenDemoAppKey?: WorkshopAppKey;
  initialGlobalAskView?: 'ask' | 'memory';
  initialMemoryFocus?: 'cheatsheet';
}) {
  const router = useRouter();
  // ==================== Zustand Store 订阅 ====================
  const uiActions = useUIStore((s) => s.actions);
  const playerActions = usePlayerStore((s) => s.actions);
  const sessionActions = useSessionStore((s) => s.actions);

  // UI Store — 视图模式 & 应用加载
  const showSplash = useUIStore((s) => s.showSplash);
  const appReady = useUIStore((s) => s.appReady);
  const loadingProgress = useUIStore((s) => s.loadingProgress);
  const viewMode = useUIStore((s) => s.viewMode);
  const reviewTab = useUIStore((s) => s.reviewTab);
  const videoWorkspaceTab = useUIStore((s) => s.videoWorkspaceTab);
  const mobileSubPage = useUIStore((s) => s.mobileSubPage);
  const isMenuOpen = useUIStore((s) => s.isMenuOpen);
  const showConversationHistory = useUIStore((s) => s.showConversationHistory);
  const showTranscriptBar = useUIStore((s) => s.showTranscriptBar);
  const showAISearch = useUIStore((s) => s.showAISearch);
  const showMobileRecorder = useUIStore((s) => s.showMobileRecorder);
  const mobileCollectionSheet = useUIStore((s) => s.mobileCollectionSheet);

  // Player Store
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  // Session Store — 会话核心
  const sessionId = useSessionStore((s) => s.sessionId);
  const isRecording = useSessionStore((s) => s.isRecording);
  const dataSource = useSessionStore((s) => s.dataSource);
  const serviceStatus = useSessionStore((s) => s.serviceStatus);
  const sessionMediaDurationMs = useSessionStore((s) => s.sessionMediaDurationMs);
  const videoSeekNonce = useSessionStore((s) => s.videoSeekNonce);
  const videoPlayNonce = useSessionStore((s) => s.videoPlayNonce);
  const videoPauseNonce = useSessionStore((s) => s.videoPauseNonce);
  const selectedAnchor = useSessionStore((s) => s.selectedAnchor);
  const selectedConfusion = useSessionStore((s) => s.selectedConfusion);
  const selectedHistoryConversation = useSessionStore((s) => s.selectedHistoryConversation);

  // Setter aliases — 保持与原 useState setter 相同的函数签名，对下游代码零破坏
  const setShowSplash = uiActions.setShowSplash;
  const setViewMode = uiActions.setViewMode;
  const setReviewTab = uiActions.setReviewTab;
  const setVideoWorkspaceTab = uiActions.setVideoWorkspaceTab;
  const setMobileSubPage = uiActions.setMobileSubPage;
  const setIsMenuOpen = uiActions.setMenuOpen;
  const setShowConversationHistory = uiActions.setShowConversationHistory;
  const setShowTranscriptBar = uiActions.setShowTranscriptBar;
  const setShowAISearch = uiActions.setShowAISearch;
  const setShowMobileRecorder = uiActions.setShowMobileRecorder;
  const setMobileCollectionSheet = uiActions.setMobileCollectionSheet;
  const setIsPlaying = playerActions.setIsPlaying;
  const setCurrentTime = playerActions.setCurrentTime;
  const setDataSource = sessionActions.setDataSource;
  const setSessionMediaDurationMs = sessionActions.setSessionMediaDurationMs;
  const setVideoSeekNonce = sessionActions.setVideoSeekNonce;
  const setVideoPlayNonce = sessionActions.setVideoPlayNonce;
  const setSelectedAnchor = sessionActions.setSelectedAnchor;
  const setSelectedConfusion = sessionActions.setSelectedConfusion;
  const setSelectedHistoryConversation = sessionActions.setSelectedHistoryConversation;

  useEffect(() => {
    if (initialGlobalAskView) setShowAISearch(true);
  }, [initialGlobalAskView, setShowAISearch]);

  const closeGlobalAsk = useCallback(() => {
    setShowAISearch(false);
    if (!initialGlobalAskView || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('workspace');
    url.searchParams.delete('intent');
    // 必须同步 Next Router 自己的路由状态；只改 history 会导致第二次点击
    // “考试速查表”时 Router 误以为仍在同一 URL，从而出现看似可点的死入口。
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  }, [initialGlobalAskView, router, setShowAISearch]);

  // Collection Store — 收集流状态
  const collectionActions = useCollectionStore((s) => s.actions);
  const sourceItems = useCollectionStore((s) => s.sourceItems);
  const archivedLocalCollectionItems = useCollectionStore((s) => s.archivedLocalCollectionItems);
  const supportReferences = useCollectionStore((s) => s.supportReferences);
  const collectionComposerText = useCollectionStore((s) => s.collectionComposerText);
  const showCollectionPulsePreview = useCollectionStore((s) => s.showCollectionPulsePreview);
  const captureDrivenPulse = useCollectionStore((s) => s.captureDrivenPulse);
  const showScrollToLatest = useCollectionStore((s) => s.showScrollToLatest);
  const isCollectionContextSelectionMode = useCollectionStore((s) => s.isCollectionContextSelectionMode);
  const selectedCollectionContextIds = useCollectionStore((s) => s.selectedCollectionContextIds);
  const selectedCollectionPrimaryId = useCollectionStore((s) => s.selectedCollectionPrimaryId);
  const confirmSelectedCollectionDelete = useCollectionStore((s) => s.confirmSelectedCollectionDelete);
  const activeCollectionMessageMenuId = useCollectionStore((s) => s.activeCollectionMessageMenuId);
  const confirmCollectionDeleteId = useCollectionStore((s) => s.confirmCollectionDeleteId);
  const sourceFilePickerMode = useCollectionStore((s) => s.sourceFilePickerMode);
  const activeSourceImportCount = useCollectionStore((s) => s.activeSourceImportCount);
  const sourceImportError = useCollectionStore((s) => s.sourceImportError);
  const playingAudioMessageId = useCollectionStore((s) => s.playingAudioMessageId);
  const audioPlaybackState = useCollectionStore((s) => s.audioPlaybackState);
  const expandedAudioTranscriptId = useCollectionStore((s) => s.expandedAudioTranscriptId);
  const workspaceCaptureEditor = useCollectionStore((s) => s.workspaceCaptureEditor);

  // Collection Store setter aliases
  const setCollectionComposerText = collectionActions.setCollectionComposerText;
  const setShowCollectionPulsePreview = collectionActions.setShowCollectionPulsePreview;
  const setConfirmCollectionDeleteId = collectionActions.setConfirmCollectionDeleteId;
  const setSourceImportError = collectionActions.setSourceImportError;
  const setExpandedAudioTranscriptId = collectionActions.setExpandedAudioTranscriptId;

  // Echo Store — 回声状态（selectedEchoChip / isManualEchoRefreshing / manualEchoDebugNote / manualEchoFeedback 已迁入 useEchoActions hook）
  const echoActions = useEchoStore((s) => s.actions);
  const workspaceEchoes = useEchoStore((s) => s.workspaceEchoes);
  const workspaceCaptures = useEchoStore((s) => s.workspaceCaptures);
  const sharingEcho = useEchoStore((s) => s.sharingEcho);

  // Echo Store setter aliases（仅保留 page.tsx 直接消费的 setter）
  const setWorkspaceEchoes = echoActions.setWorkspaceEchoes;
  const setWorkspaceCaptures = echoActions.setWorkspaceCaptures;
  const setSharingEcho = echoActions.setSharingEcho;

  // Mobile AI Store — 移动端 AI 状态
  const mobileAIActions = useMobileAIStore((s) => s.actions);
  const mobileAIQuestion = useMobileAIStore((s) => s.mobileAIQuestion);
  const mobileAIDisplayQuestion = useMobileAIStore((s) => s.mobileAIDisplayQuestion);
  const mobileAILaunchImages = useMobileAIStore((s) => s.mobileAILaunchImages);
  const mobileAILaunchSupportContextText = useMobileAIStore((s) => s.mobileAILaunchSupportContextText);
  const mobileAIQuestionNonce = useMobileAIStore((s) => s.mobileAIQuestionNonce);
  const mobileAIConsumedQuestionNonce = useMobileAIStore((s) => s.mobileAIConsumedQuestionNonce);
  const mobileAIPreferSelectedContext = useMobileAIStore((s) => s.mobileAIPreferSelectedContext);
  const mobileAILaunchTarget = useMobileAIStore((s) => s.mobileAILaunchTarget);
  const mobileAINewConversationNonce = useMobileAIStore((s) => s.mobileAINewConversationNonce);
  const mobileAIHasActiveConversation = useMobileAIStore((s) => s.mobileAIHasActiveConversation);

  // Mobile AI Store setter aliases
  const setMobileAIQuestion = mobileAIActions.setMobileAIQuestion;
  const setMobileAIDisplayQuestion = mobileAIActions.setMobileAIDisplayQuestion;
  const setMobileAILaunchImages = mobileAIActions.setMobileAILaunchImages;
  const setMobileAILaunchSupportContextText = mobileAIActions.setMobileAILaunchSupportContextText;
  const setMobileAIQuestionNonce = mobileAIActions.setMobileAIQuestionNonce;
  const setMobileAIConsumedQuestionNonce = mobileAIActions.setMobileAIConsumedQuestionNonce;
  const setMobileAIPreferSelectedContext = mobileAIActions.setMobileAIPreferSelectedContext;
  const setMobileAILaunchTarget = mobileAIActions.setMobileAILaunchTarget;
  const setMobileAINewConversationNonce = mobileAIActions.setMobileAINewConversationNonce;
  const setMobileAIHasActiveConversation = mobileAIActions.setMobileAIHasActiveConversation;

  // Capture Editor Store — 课堂内容核心数据
  const captureEditorActions = useCaptureEditorStore((s) => s.actions);
  const segments = useCaptureEditorStore((s) => s.segments);
  const anchors = useCaptureEditorStore((s) => s.anchors);
  const timeline = useCaptureEditorStore((s) => s.timeline);
  const actionItems = useCaptureEditorStore((s) => s.actionItems);
  const audioBlob = useCaptureEditorStore((s) => s.audioBlob);
  const audioUrl = useCaptureEditorStore((s) => s.audioUrl);
  const videoSource = useCaptureEditorStore((s) => s.videoSource);
  const videoInsightItems = useCaptureEditorStore((s) => s.videoInsightItems);
  const activeVideoInsightId = useCaptureEditorStore((s) => s.activeVideoInsightId);
  const extractedTermsHint = useCaptureEditorStore((s) => s.extractedTermsHint);
  const recorderAutoStartSignal = useCaptureEditorStore((s) => s.recorderAutoStartSignal);
  // 录音来源（麦克风 / 电脑声音 / 两路都录）——仅传给课堂挂载点的 Recorder，
  // 收集页永远走默认 'mic'（备忘录场景不需要电脑声采集）。
  const recorderAudioSource = useCaptureEditorStore((s) => s.recorderAudioSource);

  // Capture Editor Store setter aliases
  const setSegments = captureEditorActions.setSegments;
  const setAnchors = captureEditorActions.setAnchors;
  const setTimeline = captureEditorActions.setTimeline;
  const setAudioUrl = captureEditorActions.setAudioUrl;
  const setVideoSource = captureEditorActions.setVideoSource;
  const setVideoInsightItems = captureEditorActions.setVideoInsightItems;
  const setActiveVideoInsightId = captureEditorActions.setActiveVideoInsightId;

  // Performance: Guest mode — initialize store on mount
  useEffect(() => {
    if (isGuestFastEntry) {
      uiActions.setShowSplash(false);
      uiActions.setAppReady(true);
      uiActions.setLoadingProgress(100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  const { user, isAuthenticated, accessToken, isCheckingAuth } = useAuth();
  

  const { isMobile: detectedIsMobile, mounted } = useResponsive();
  const isMobile = detectedIsMobile || forceMobilePreview;
  const isDesktopMobilePreview = forceMobilePreview && !detectedIsMobile;
  const hasAppliedInitialMobileSubPageRef = useRef(false);
  
  const shouldPrioritizeWechatCaptureEntry = Boolean(wechatCaptureToken);
  

  const forcedWorkspaceAppliedRef = useRef(false);
  useEffect(() => {
    if (forcedWorkspaceAppliedRef.current) return;
    if (forcedWorkspaceTab !== 'apps') return;
    forcedWorkspaceAppliedRef.current = true;
    setReviewTab('apps');
    setVideoWorkspaceTab('apps');
    setViewMode('review');

    // 深链可能从独立应用结果页或新标签返回。有现有课堂就复用；
    // 没有上下文时加载示例课，避免进入一个所有工具都无法使用的空壳。
    if (segments.length === 0) {
      void loadDemoData().then((demoData) => {
        setSegments(demoData.DEMO_SEGMENTS);
        setAnchors(demoData.DEMO_ANCHORS);
        setAudioUrl(demoData.DEMO_AUDIO_URL);
        setVideoSource(null);
        setDataSource('demo');
      }).catch((error) => {
        console.error('Failed to load demo context for apps workspace:', error);
      });
    }
  }, [
    forcedWorkspaceTab,
    segments.length,
    setAnchors,
    setAudioUrl,
    setDataSource,
    setReviewTab,
    setSegments,
    setVideoSource,
    setVideoWorkspaceTab,
    setViewMode,
  ]);
  const { clear: clearTopics } = useTopics({ sessionId, segments });
  
  const {
    summary: classSummary,
    isLoading: isLoadingSummary,
    generate: generateSummary,
    clear: clearSummary,
  } = useSummary({ sessionId, segments });
  
  const collectionComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const collectionScrollRef = useRef<HTMLDivElement | null>(null);
  const collectionScrollNearBottomRef = useRef(true);
  const [asrContextHint] = useState('');
  const [biliCookie, setBiliCookie] = useState('');
  useEffect(() => {
    void getPreference<string>('settings_bilibili_cookie', '').then(setBiliCookie);
  }, []);
  const sourceImporting = activeSourceImportCount > 0;
  const hasCollectionContext = useMemo(
    () => segments.length > 0 || sourceItems.length > 0 || supportReferences.length > 0 || workspaceEchoes.length > 0,
    [segments.length, sourceItems.length, supportReferences.length, workspaceEchoes.length]
  );
  

  const {
    workshopWindows,
    openWorkshopWindow,
    closeWorkshopWindow,
    toggleWorkshopWindowMinimize,
    focusWorkshopWindow,
  } = useWorkshopWindows({ mounted, sessionId });
  

  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const lastCollectionPulseSignatureRef = useRef('');
  const suppressNextCollectionPulsePreviewRef = useRef(false);
  const importedWechatCaptureTokensRef = useRef(new Set<string>());
  const workspaceContextRequestKeyRef = useRef<string | null>(null);
  const autoEchoRefreshPromiseRef = useRef<Promise<DailyEchoRefreshPayload | null> | null>(null);

  // ── Extract Terms Hook（ASR 热词提取 + 实时上下文提示）──────
  const { liveASRContextHint } = useExtractTerms({
    asrContextHint,
    isGuestFastEntry,
    supportReferences,
    extractedTermsHint,
  });
  const anchorsRef = useRef<Anchor[]>([]);
  const sessionIdRef = useRef<string>(sessionId);
  const sourceItemsRef = useRef<SourceIngestItem[]>([]);
  const supportReferencesRef = useRef<SupportReferenceItem[]>([]);
  const pendingCaptureStatusBySourceKeyRef = useRef<Map<string, 'archive' | 'delete'>>(new Map());
  const collectionLongPressTimerRef = useRef<number | null>(null);
  const collectionLongPressTriggeredRef = useRef(false);
  const previewObjectUrlsRef = useRef<string[]>([]);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<WaveformPlayerRef>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  // 记录当前进入复习态的 sourceItem，用于非音视频类型（文章/笔记）展示原文
  const [selectedReviewItem, setSelectedReviewItem] = useState<SourceIngestItem | null>(null);
  const reviewContextTitle = selectedReviewItem?.title || (autoLoadDemo ? GUEST_DEMO_LESSON_TITLE : undefined);
  // Ref bridge: importVideoLinkIntoSourceItem is returned by useSourceImport (defined after
  // ingestTranscriptSegments), but consumed by openReviewFromCollection (defined before).
  // We use a ref so the callback always reads the latest function at call time.
  const importVideoLinkRef = useRef<(url: string, options?: {
    sourceItemId?: string;
    optimisticTitle?: string;
    persistSourceKey?: string;
    persistSourceType?: string;
    persistRole?: SourceIngestRole;
    occurredAt?: string;
  }) => Promise<boolean>>(async () => false);
  const hasRestoredState = useRef(false);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    anchorsRef.current = anchors;
  }, [anchors]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // ── Review Session Hook（从 IndexedDB / 服务端恢复复习态）──────
  const {
    restoreReviewSession,
    restoreReviewFromCollectionFallback,
    restoreFromServerTranscript,
  } = useReviewSession(
    { clearTopics, clearSummary, user },
    { liveSegmentsRef, segmentsRef, sessionIdRef, previewObjectUrlsRef },
  );

  // ── Echo Actions Hook（回声刷新 + 筛选 + 手动触发 UI）──────
  const {
    refreshDailyEcho,
    manualEchoFeedbackView,
    manualEchoDebugView,
    renderManualEchoTriggerButton,
  } = useEchoActions({
    isGuestFastEntry,
    isCheckingAuth,
    isAuthenticated,
    user,
    accessToken,
  });

  // ── Pending Recorded Audio Hook（待处理录音音频管理）──────
  const {
    pendingRecordedAudiosRef,
    resolvePendingRecordedAudio,
    clearPendingRecordedAudio,
  } = usePendingRecordedAudio();

  useEffect(() => {
    sourceItemsRef.current = sourceItems;
  }, [sourceItems]);

  useEffect(() => {
    supportReferencesRef.current = supportReferences;
  }, [supportReferences]);

  useEffect(() => {
    return () => {
      if (collectionLongPressTimerRef.current) {
        clearTimeout(collectionLongPressTimerRef.current);
      }
      previewObjectUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore object URL cleanup errors
        }
      });
      previewObjectUrlsRef.current = [];
    };
  }, []);

  // ── Audio Message Playback Hook（收集流音频播放）──────
  const {
    stopAudioMessagePlayback,
    toggleAudioMessagePlayback,
  } = useAudioMessagePlayback();
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const migration = await runMemoryMigration();
      if (cancelled) return;
      if (!migration.ok) {
        console.warn('[memory.migration.partial]', migration);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Seek Controller Hook（播放跳转 + 时间归一化）──────
  const {
    handleUnifiedSeek,
  } = useSeekController(
    { segments, videoSource },
    { waveformRef },
  );

  // 随堂检验控制器
  const classCheck = useClassCheck({
    currentTimeMs: currentTime,
    isPlaying,
    segments,
    sessionId,
    dataSource,
    pausePlayer: useCallback(() => {
      if (videoSource) {
        // video 模式：递增 pauseNonce 命令 VideoReviewPlayer 暂停底层 media
        sessionActions.incrementVideoPauseNonce();
        setIsPlaying(false);
      } else {
        waveformRef.current?.pause();
        setIsPlaying(false);
      }
    }, [videoSource]),
    resumePlayer: useCallback(() => {
      if (videoSource) {
        sessionActions.incrementVideoPlayNonce();
        setIsPlaying(true);
      } else {
        waveformRef.current?.play();
        setIsPlaying(true);
      }
    }, [videoSource]),
    onHighlightsReady: useCallback((highlights: ClassCheckHighlight[]) => {
      if (!highlights || highlights.length === 0) return;
      const highlightItems: VideoInsightItem[] = highlights.map((h, i) => ({
        id: `highlight-${i}`,
        kind: 'highlight' as const,
        prompt: h.title,
        summary: h.quote.slice(0, 120),
        timestamps: [h.startMs],
        endMs: h.endMs,
        color: VIDEO_INSIGHT_COLORS[i % VIDEO_INSIGHT_COLORS.length],
      }));
      setVideoInsightItems(highlightItems);
      setActiveVideoInsightId(highlightItems[0]?.id || null);
    }, [setVideoInsightItems, setActiveVideoInsightId]),
  });

  // 将 classCheck 的 checkpoints 同步到时间轴 items（与 highlights 合并）
  useEffect(() => {
    if (!classCheck.plan || classCheck.plan.checkpoints.length === 0) return;
    setVideoInsightItems((prev: VideoInsightItem[]) => {
      // 保留 highlights，替换 checkpoints
      const highlightItems = prev.filter((item) => !item.id.startsWith('checkpoint-'));
      const checkpointItems: VideoInsightItem[] = classCheck.plan!.checkpoints.map((cp, i) => ({
        id: `checkpoint-${i}`,
        kind: 'checkpoint' as const,
        prompt: cp.topic,
        summary: cp.topic,
        timestamps: [cp.triggerMs],
        endMs: cp.endMs,
        color: '#E67E22',
        checkpointStatus: classCheck.checkpointStatuses[i] || 'pending',
        checkpointIndex: i,
      }));
      return [...highlightItems, ...checkpointItems];
    });
  }, [classCheck.plan, classCheck.checkpointStatuses, setVideoInsightItems]);

  // isCheckActive 的 ref 镜像，用于 onTimeUpdate 回调中读取最新值（避免闭包陈旧）
  const isCheckActiveRef = useRef(false);
  isCheckActiveRef.current = classCheck.isCheckActive;

  // 受控的 onTimeUpdate：在随堂检验弹窗激活时屏蔽更新，
  // 避免 media 暂停瞬间残余的 timeupdate 事件触发 re-render 导致弹窗闪烁。
  const handleVideoTimeUpdate = useCallback((timeMs: number) => {
    if (isCheckActiveRef.current) return;
    setCurrentTime(timeMs);
  }, [setCurrentTime]);

  useEffect(() => {
    if (!videoSource) {
      setVideoSeekNonce(0);
      setVideoPlayNonce(0);
    }
  }, [videoSource]);
  useEffect(() => {
    if (!isRecording) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isRecording]);
  const studentId = user?.id || 'anonymous';
  const studentName = user?.nickname || user?.username || '匿名用户';

  const persistedCurrentTime = Math.max(0, Math.floor(currentTime / 5000) * 5000);

  // ── App State Restore Hook（应用初始化 + 状态持久化）──────
  // R9-3：注入 onRestoreReviewSession callback，让 hook 能在 mount 时恢复 review viewMode。
  // 用户痛点：从课后学习页进设置 → 返回 → 永远跳回课堂态（review state 丢失）。
  // 真因：hook 之前强制 setViewMode('classroom')，因为它没法访问 restoreReviewSession。
  // 现在通过 callback 注入解决。
  const handleRestoreReviewFromBoot = useCallback(
    async (
      restoreSessionId: string,
      saved: { reviewTab?: string; videoWorkspaceTab?: string; currentTime?: number; showTranscriptBar?: boolean }
    ) => {
      try {
        type RestoreOpts = NonNullable<Parameters<typeof restoreReviewSession>[1]>;
        // 老 localStorage 可能存有已删除的 'feed' tab（M15 单课 feed tab 移除）→ 兜底回 'timeline'
        const rawReviewTab = saved.reviewTab && saved.reviewTab !== 'feed' ? saved.reviewTab : 'timeline';
        return await restoreReviewSession(restoreSessionId, {
          reviewTab: rawReviewTab as RestoreOpts['reviewTab'],
          videoWorkspaceTab: (saved.videoWorkspaceTab || 'chat') as RestoreOpts['videoWorkspaceTab'],
          currentTime: saved.currentTime || 0,
          showTranscriptBar: Boolean(saved.showTranscriptBar),
        });
      } catch (err) {
        console.error('[handleRestoreReviewFromBoot] failed:', err);
        return false;
      }
    },
    [restoreReviewSession],
  );

  useAppStateRestore(
    {
      isGuestFastEntry,
      forceMobilePreview,
      appReady,
      viewMode,
      sessionId,
      dataSource,
      reviewTab,
      videoWorkspaceTab,
      showTranscriptBar,
      selectedAnchorId: selectedAnchor?.id,
      persistedCurrentTime,
      onRestoreReviewSession: handleRestoreReviewFromBoot,
    },
    { hasRestoredState },
  );

  // NOTE: restoreReviewSession, restoreReviewFromCollectionFallback, restoreFromServerTranscript
  // 已提取到 useReviewSession hook（见上方 hook 调用）。
  

  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  // 兜底：Phase 1（checkServices + getPersistedAppState）通常 <500ms 完成。
  // 如果 IndexedDB 异常导致 Phase 1 也卡住，6s 强制 dismiss splash——
  // 由于 splash 是 overlay（不是 early return），app 已经在 DOM 中，
  // dismiss 后用户立刻可交互。
  useEffect(() => {
    if (isGuestFastEntry) return;
    const timer = window.setTimeout(() => {
      const ui = useUIStore.getState();
      if (ui.showSplash || !ui.appReady) {
        ui.actions.setLoadingProgress(100);
        ui.actions.setAppReady(true);
        ui.actions.setShowSplash(false);
      }
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [isGuestFastEntry]);

  // NOTE: refreshDailyEcho 已提取到 useEchoActions hook（见上方 hook 调用）。

  // ── Recording Lifecycle Hook（录音生命周期：写入收集 + 开始/停止录音）──────
  const {
    persistCaptureToWorkspace,
    handleRecordingStart,
    handleRecordingStop,
  } = useRecordingLifecycle(
    {
      accessToken,
      isAuthenticated,
      user,
      studentId,
      refreshDailyEcho,
      clearTopics,
      clearSummary,
      anchors,
      sessionId,
      sessionMediaDurationMs,
    },
    {
      segmentsRef,
      sessionIdRef,
      liveSegmentsRef,
      sourceItemsRef,
      supportReferencesRef,
      previewObjectUrlsRef,
      pendingCaptureStatusBySourceKeyRef,
      pendingRecordedAudiosRef,
    },
  );

  const handleViewModeChange = useCallback(async (newMode: 'record' | 'review' | 'classroom') => {
    setViewMode(newMode);
    setMobileSubPage(null);
    setShowMobileRecorder(false);
    setMobileCollectionSheet(null);
  
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    // 切到 record 或 classroom tab 时，清理上一次 review 的视频残留。
    // 避免"刚看完一个 B 站视频复习 → 切到课堂 tab → 点一节音频课 → 界面却还是视频"
    // 这类 state 串台（因为 DesktopVideoReviewLayout 只看 videoSource 是否有值）。
    if (newMode === 'record' || newMode === 'classroom') {
      setVideoSource(null);
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setVideoWorkspaceTab('chat');
      setSelectedReviewItem(null);
    }
    if (newMode === 'review' && segments.length === 0 && !hasCollectionContext && !isMobile) {
      try {
        const demoData = await loadDemoData();
        setSegments(demoData.DEMO_SEGMENTS);
        setAudioUrl(demoData.DEMO_AUDIO_URL);
        setAnchors(demoData.DEMO_ANCHORS);
        setVideoSource(null);
        setDataSource('demo');
        
      
        const tl = memoryService.buildTimeline(
          sessionId,
          demoData.DEMO_SEGMENTS,
          demoData.DEMO_ANCHORS,
          { subject: UIConfig.defaultSubject, teacher: 'Demo Teacher', date: new Date().toISOString().split('T')[0] }
        );
        setTimeline(tl);
        
        // 自动定位到第一个未解决的困惑点
        const firstUnresolved = demoData.DEMO_ANCHORS.find(a => !a.resolved);
        if (firstUnresolved) {
          setSelectedAnchor(firstUnresolved);
          setCurrentTime(firstUnresolved.timestamp);
        }
      } catch (err) {
        console.error('Failed to load demo data:', err);
      }
    }
  }, [hasCollectionContext, segments.length, sessionId, isGuestFastEntry]);

  useEffect(() => {
    if (!forceMobilePreview || !initialMobileSubPage) return;
    if (hasAppliedInitialMobileSubPageRef.current) return;

    hasAppliedInitialMobileSubPageRef.current = true;

    void (async () => {
      if (viewMode !== 'review') {
        await handleViewModeChange('review');
      }

      setMobileSubPage(initialMobileSubPage);
    })();
  }, [forceMobilePreview, handleViewModeChange, initialMobileSubPage, setMobileSubPage, viewMode]);

  const openReviewFromCollection = useCallback(async (item?: SourceIngestItem | null) => {
    if (!item) return;
    setSelectedReviewItem(item);
    setMobileCollectionSheet(null);
    setShowMobileRecorder(false);
    setShowCollectionPulsePreview(false);

    // 恢复成功后的统一收尾：确保音频源可播放，然后决定手机端入口页面。
    const finishReviewRestore = (restoredItem: SourceIngestItem) => {
      // 视频类型使用 VideoReviewPlayer 播放，不需要 WaveformPlayer 的 audioUrl。
      // 如果对视频也设置 audioUrl，会导致隐藏的 WaveformPlayer 尝试用 wavesurfer.js
      // 加载一个无效的 URL（如 B站原始链接），永远卡在「加载音频...」状态。
      // 只有非视频类型（录音、微信语音等）才需要 audioUrl 作为 WaveformPlayer 的源。
      if (restoredItem.type !== 'video' && restoredItem.mediaUrl) {
        setAudioUrl(restoredItem.mediaUrl);
      }
      if (isMobile) {
        // 视频类型：留在时间轴视图（mobileSubPage=null），让用户先看到视频播放器+转录
        // 非视频类型（录音等）：直接进入 AI 对话
        if (restoredItem.type === 'video') {
          setMobileSubPage(null);
        } else {
          setMobileSubPage('ai-chat');
        }
      }
    };

    // 路径 A：有 sessionId + reviewable → 从 IndexedDB 恢复
    if (item.sessionId && item.reviewable) {
      try {
        const restored = await restoreReviewSession(item.sessionId, {
          reviewTab: 'timeline',
          videoWorkspaceTab: item.type === 'video' ? 'chat' : 'chat',
          currentTime: 0,
          showTranscriptBar: false,
        });
        if (restored) {
          finishReviewRestore(item);
          return;
        }
      } catch (error) {
        console.error('从收集流恢复复习态失败，将尝试回退恢复:', error);
      }

      try {
        const restoredFromFallback = await restoreReviewFromCollectionFallback(item);
        if (restoredFromFallback) {
          finishReviewRestore(item);
          return;
        }
      } catch (fallbackError) {
        console.error('从收集流回退恢复复习态失败:', fallbackError);
      }
    }

    // 路径 B：新设备首次打开时才拉完整课堂证据。首页/收集列表保持轻量，
    // 拉回后复用 IndexedDB 恢复链路，后续打开不再依赖网络。
    if (
      item.reviewable
      && item.evidenceAvailable
      && item.workspaceCaptureId
      && isAuthenticated
      && accessToken
      && user?.id
    ) {
      try {
        const evidence = await fetchAndBackfillWorkspaceEvidence({
          captureId: item.workspaceCaptureId,
          accessToken,
          userId: user.id,
        });
        item = {
          ...item,
          sessionId: evidence.sessionId,
          mediaUrl: evidence.mediaUrl || item.mediaUrl,
          durationMs: evidence.durationMs || item.durationMs,
          serverTranscriptSegments: evidence.segments,
        };
        setSelectedReviewItem(item);
        const restored = await restoreReviewSession(evidence.sessionId, {
          reviewTab: 'timeline',
          videoWorkspaceTab: 'chat',
          currentTime: 0,
          showTranscriptBar: false,
        });
        if (restored) {
          finishReviewRestore(item);
          return;
        }
      } catch (evidenceError) {
        console.error('跨设备课堂证据恢复失败，将继续尝试兼容路径:', evidenceError);
      }
    }

    // 路径 C（旧客户端兼容）：列表仍内嵌 transcriptSegments 时直接恢复。
    if (item.reviewable && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0) {
      try {
        const restoredFromServer = await restoreFromServerTranscript(item);
        if (restoredFromServer) {
          finishReviewRestore(item);
          return;
        }
      } catch (serverError) {
        console.error('从服务端转录数据恢复复习态失败:', serverError);
      }
    }

    // 路径 D：video + 有 URL → 重新导入（即使有 sessionId，如果 IndexedDB 和服务端都没转录数据，需要重新导入）
    // 这修复了跨设备同步时"有 sessionId 但本机 IndexedDB 没有转录"导致时间轴为空的问题
    if (item.type === 'video' && item.attachmentUrl) {
      const imported = await importVideoLinkRef.current(item.attachmentUrl, {
        sourceItemId: item.id,
        optimisticTitle: item.title,
        persistSourceKey: item.sourceKey,
        persistSourceType: 'wechat',
        persistRole: item.role,
        occurredAt: item.addedAt,
      });
      if (!imported) {
        setSourceImportError('这条链接先收下了，但自动导入失败，请稍后再试。');
      }
      return;
    }

    // 路径 E：audio 类型有 mediaUrl（如微信语音、App 内录音），
    // 即使前面的恢复路径都跳过了，也应该直接进入 review 模式播放。
    if (item.type === 'audio' && item.mediaUrl) {
      // 进入复习态前清理上一次录音/视频复习留下的媒体残留，避免串台：
      // 旧 audioBlob 会让下面的音频守卫跳过新音频，旧 segments/videoSource
      // 会让复习页显示别的录音的转录/视频。这条路径是"有 mediaUrl 但无
      // sessionId/转录"的兜底——只播放音频，不加载转录；若该语音有转录，
      // 应走路径 A（restoreReviewSession）。
      setSegments([]);
      setAnchors([]);
      setTimeline(null);
      captureEditorActions.setAudioBlob(null);
      setVideoSource(null);
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      captureEditorActions.setNotes([]);
      captureEditorActions.setActionItems([]);
      setSelectedAnchor(null);
      setCurrentTime(0);
      setDataSource('live');
      sessionActions.setSessionId('');
      sessionIdRef.current = '';
      liveSegmentsRef.current = [];
      segmentsRef.current = [];
      clearTopics();
      clearSummary();

      setAudioUrl(item.mediaUrl);
      // 先清零，再用 item 携带的时长（如有）；WaveformPlayer onReady 会
      // 在音频加载完成后用真实时长兜底覆盖。
      setSessionMediaDurationMs(item.durationMs || 0);
      await handleViewModeChange('review');
      setReviewTab('apps');
      setVideoWorkspaceTab('chat');
      if (isMobile) {
        setMobileSubPage('ai-chat');
      }
      return;
    }

    if (item.reviewable) {
      setSourceImportError('这条内容还没准备好进入复习，稍后再试一次。');
      return;
    }

    // 文章 / 笔记 / 图片等非音视频类型进入复习态前，
    // 必须清理上一次录音或视频复习留下的媒体残留（转录 / 音频 / 视频 / 时间轴 / sessionId）。
    // 这条路径走 reviewTab='apps'，不复用 restoreReviewSession，不会自动覆盖 segments，
    // 若不显式清空，复习页会串台显示别的录音的转录 / 音频 / 时间轴。
    // selectedReviewItem 已在入口设置，复习页通过 sourceFullText 展示当前文章原文。
    setSegments([]);
    setAnchors([]);
    setTimeline(null);
    setAudioUrl(null);
    captureEditorActions.setAudioBlob(null);
    setVideoSource(null);
    setVideoInsightItems([]);
    setActiveVideoInsightId(null);
    captureEditorActions.setNotes([]);
    captureEditorActions.setActionItems([]);
    setSelectedAnchor(null);
    setCurrentTime(0);
    setSessionMediaDurationMs(0);
    setDataSource('live');
    sessionActions.setSessionId('');
    sessionIdRef.current = '';
    liveSegmentsRef.current = [];
    segmentsRef.current = [];
    clearTopics();
    clearSummary();

    await handleViewModeChange('review');
    setReviewTab('apps');
    setVideoWorkspaceTab('chat');
    // 移动端：非音视频类型直接进 AI 对话
    if (isMobile) {
      setMobileSubPage('ai-chat');
    }
  }, [accessToken, captureEditorActions, clearSummary, clearTopics, handleViewModeChange, isAuthenticated, isMobile, restoreFromServerTranscript, restoreReviewFromCollectionFallback, restoreReviewSession, sessionActions, user?.id]);

  // ── Transcript Handlers Hook（转录更新/错误/增强/文本编辑）──────
  const {
    handleTranscriptUpdate,
    handleRecordingTranscriptionError,
    handleTranscriptEnhanced,
    handleVideoAssistantMessage: _handleVideoAssistantMessage,
    handleTranscriptTextUpdate,
  } = useTranscriptHandlers(
    {
      persistCaptureToWorkspace,
      resolvePendingRecordedAudio,
      clearPendingRecordedAudio,
      userId: user?.id,
      currentTime,
      videoSource,
      segments,
      anchors,
      sessionId,
      timeline,
    },
    { segmentsRef, liveSegmentsRef, anchorsRef },
  );

  // ── Anchor Actions Hook（困惑点/锚点 CRUD）──────
  const {
    handleAnchorMark,
    handlePlaybackAnchorAdd,
    handleAnchorSelect,
    handleResolveAnchor,
  } = useAnchorActions({
    sessionId,
    studentId,
    studentName,
    segments,
    timeline,
    selectedAnchor,
  });

  // ── Action Items Hook（行动项管理）──────
  const {
    handleActionComplete,
    handleStartNextAction,
    handleGenerateSummary,
    handleActionItemsUpdate,
  } = useActionItems({
    sessionId,
    actionItems,
    selectedAnchorTimestamp: selectedAnchor?.timestamp,
    anchors,
    currentTime,
    handleUnifiedSeek,
    generateSummary,
  });

  // ── Note Actions Hook（笔记 CRUD）──────
  const {
    handleAddNote,
    handleUpdateNote,
    handleDeleteNote,
  } = useNoteActions({ sessionId, studentId });
  const totalDuration = Math.max(
    segments.length > 0 ? segments[segments.length - 1].endMs : 0,
    sessionMediaDurationMs
  );

  // ── Source Item Management Hook（源项 CRUD）──────
  const {
    appendSourceItem,
    updateSourceItem,
    appendSupportSource,
  } = useSourceItemManagement();

  // ── Workspace capture CRUD (extracted to hook) ──
  const {
    removeCollectionItemsFromFlow,
    archiveLocalCollectionItem,
    restoreLocalCollectionItem,
    deleteLocalCollectionItem,
    removeWorkspaceCaptureFromState,
    syncWorkspaceCaptureIntoState,
    updateWorkspaceCaptureStatus,
    openWorkspaceCaptureEditor,
    closeWorkspaceCaptureEditor,
    saveWorkspaceCaptureEdit,
  } = useWorkspaceCaptureActions({
    playingAudioMessageId,
    stopAudioMessagePlayback,
    pendingCaptureStatusBySourceKeyRef,
  });

  // ── Transcript Ingest Hook（转录内容摄入管线）──────
  const { ingestTranscriptSegments } = useTranscriptIngest(
    {
      appendSourceItem,
      updateSourceItem,
      clearTopics,
      clearSummary,
      persistCaptureToWorkspace,
      studentId,
      userId: user?.id,
    },
    { segmentsRef, sessionIdRef, liveSegmentsRef, anchorsRef },
  );

  // ── Source Import Hook（文件/链接导入管线）──────
  const {
    handleImportFiles,
    handleSourceFileButtonClick,
    handleSourceFileInputChange,
    importVideoLinkIntoSourceItem,
    importArticleLinkIntoSourceItem,
    importComposerVideoLink,
  } = useSourceImport(
    {
      ingestTranscriptSegments,
      persistCaptureToWorkspace,
      appendSourceItem,
      updateSourceItem,
      appendSupportSource,
      asrContextHint,
      biliCookie,
    },
    { segmentsRef, previewObjectUrlsRef, sourceFileInputRef },
  );

  // Keep ref in sync so openReviewFromCollection (defined earlier) can access it.
  importVideoLinkRef.current = importVideoLinkIntoSourceItem;

  // ── Lesson Digest（结构化分段总结，移动端复习态主视图）──
  const [mobileDigestView, setMobileDigestView] = useState(false);
  const [mobileReviewSheetOpen, setMobileReviewSheetOpen] = useState(false);
  const digestImages = useMemo(() => {
    return sourceItems
      .filter((item) => item.type === 'image' && item.role === 'support')
      .map((item) => ({
        imageId: item.id,
        capturedAtMs: item.capturedAtMs ?? null,
        title: item.title,
      }));
  }, [sourceItems]);
  const { digest: lessonDigest, loading: digestLoading } = useLessonDigest({
    sessionId,
    segments,
    images: digestImages,
    lessonTitle: selectedReviewItem?.title,
    enabled: isMobile && viewMode === 'review' && mobileDigestView && segments.length > 0,
  });

  // 微信内置浏览器对 accept 含 image/*/video/* 时会劫持为拍摄/相册选择器，
  // 导致无法选择文档等其他文件。检测到微信时使用通配符让系统弹出完整文件管理器。
  const isWechatBrowser = typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);

  const sourceFileAccept = isWechatBrowser
    ? '*/*'
    : sourceFilePickerMode === 'audio'
      ? 'audio/*,.mp3,.wav,.webm,.ogg,.m4a,.aac,.flac'
    : sourceFilePickerMode === 'support'
        ? 'image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif,.txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx,.ppt,.pptx'
        : 'audio/*,video/*,image/*,.mp3,.wav,.webm,.ogg,.m4a,.aac,.flac,.mp4,.mov,.m4v,.avi,.mkv,.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif,.txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx,.ppt,.pptx';

  // ── Collection Composer Hook（composer 输入/提交/引用上下文/选择/滚动/菜单/听写）──────
  const prevCollectionCountRef = useRef(0);
  const {
    collectionFeedItems,
    selectedCollectionContextItems,
    quotedCollectionContextItems,
    selectedCollectionListIds,
    composerReach,
    composerDetectedUrl,
    composerLinkPreview,
    composerCanAutoImportLink,
    quotedCollectionPrimaryItem,
    quotedCollectionSummaryText,
    collectionComposerPlaceholder,
    activeCollectionMessageMenuItem,
    scrollCollectionToBottom,
    nudgeComposer,
    focusCollectionComposer,
    appendToCollectionComposer,
    toggleComposerDictation,
    handleCollectionComposerSubmit,
    handleCollectionComposerPaste,
    handleCollectionPulseAction,
    openLiveRecorder,
    setQuotedCollectionContext,
    clearCollectionContextSelection,
    clearQuotedCollectionContext,
    toggleCollectionContextItem,
    quoteSelectedCollectionContextToComposer,
    quoteCollectionItemToComposer,
    openCollectionMessageMenu,
    closeCollectionMessageMenu,
    cancelCollectionMessageLongPress,
    beginCollectionMessageLongPress,
    composerVoiceStatus,
    isComposerVoiceRecording,
    composerVoiceInterimText,
  } = useCollectionComposer(
    {
      appendSupportSource,
      persistCaptureToWorkspace,
      importComposerVideoLink,
      handleImportFiles,
      handleSourceFileButtonClick,
      isMobile,
    },
    {
      collectionComposerRef,
      collectionScrollRef,
      collectionScrollNearBottomRef,
      prevCollectionCountRef,
      collectionLongPressTimerRef,
      collectionLongPressTriggeredRef,
      segmentsRef,
      recorderRef,
    },
  );

  const [emphasizedCollectionItemId, setEmphasizedCollectionItemId] = useState<string | null>(null);
  const claimedCaptureHandledRef = useRef<string | null>(null);

  // 分享领取完成后，不把用户丢回通用首页：直接进入收集流。等跨设备数据
  // 回填到本地后，把刚领取的卡片滚到视野中央，并用一次克制的 AI 微光确认落点。
  useEffect(() => {
    if (!initialClaimedCaptureId) return;
    setViewMode('record');
    setMobileCollectionSheet(null);
  }, [initialClaimedCaptureId, setMobileCollectionSheet, setViewMode]);

  useEffect(() => {
    if (!initialClaimedCaptureId) return;
    if (claimedCaptureHandledRef.current === initialClaimedCaptureId) return;

    const target = collectionFeedItems.find((item) =>
      item.workspaceCaptureId === initialClaimedCaptureId ||
      item.id === initialClaimedCaptureId ||
      item.id === `workspace-${initialClaimedCaptureId}`
    );
    if (!target) return;

    claimedCaptureHandledRef.current = initialClaimedCaptureId;
    setEmphasizedCollectionItemId(target.id);

    window.requestAnimationFrame(() => {
      document
        .getElementById(`collection-item-${encodeURIComponent(target.id)}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => setEmphasizedCollectionItemId(null), 4800);

    const url = new URL(window.location.href);
    url.searchParams.delete('claimedCapture');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [collectionFeedItems, initialClaimedCaptureId]);

  const allCollectionItems = useMemo<WorkspaceCaptureListItem[]>(() => {
    const workspaceSourceKeys = new Set(
      workspaceCaptures
        .map((item) => item.sourceKey)
        .filter((value): value is string => Boolean(value))
    );

    const localActiveItems = sourceItems
      .filter((item) => !item.id.startsWith('workspace-'))
      .filter((item) => {
        const sourceKey = resolveSourceItemSourceKey(item);
        return !sourceKey || !workspaceSourceKeys.has(sourceKey);
      })
      .map((item) => buildCollectionListItemFromSourceItem(item, 'active'));

    const localArchivedItems = archivedLocalCollectionItems
      .filter((item) => {
        const sourceKey = resolveSourceItemSourceKey(item);
        return !sourceKey || !workspaceSourceKeys.has(sourceKey);
      })
      .map((item) => buildCollectionListItemFromSourceItem(item, 'archived'));

    return [
      ...workspaceCaptures.map((item) => ({
        ...item,
        kind: 'workspace' as const,
        sourceItemId: `workspace-${item.id}`,
        editable: true,
      })),
      ...localActiveItems,
      ...localArchivedItems,
    ];
  }, [archivedLocalCollectionItems, sourceItems, workspaceCaptures]);

  const selectedCollectionContextText = useMemo(
    () =>
      buildSelectedCollectionContextText({
        items: selectedCollectionContextItems,
        primaryId: selectedCollectionPrimaryId,
      }),
    [selectedCollectionContextItems, selectedCollectionPrimaryId]
  );

  // 复习 / 移动端 AI 对话的上下文：只保留用户"主动勾选"的收集项。
  // 不再把 workspaceEchoes + supportReferences 默认塞进去——那会让 AI 在复习
  // 单节课时，引用到其它课/其它笔记的内容（"杂糅"），违反"有根、不串味"的边界。
  // 场景上下文（当前这节课）由 segments 承载，支持上下文只认用户的主动选择。
  const tutorSupportContextText = useMemo(() => {
    const activeSelectedContext = mobileAIPreferSelectedContext
      ? (mobileAILaunchSupportContextText || selectedCollectionContextText)
      : selectedCollectionContextText;
    return compactMultilineText(activeSelectedContext || '', 8500);
  }, [mobileAILaunchSupportContextText, mobileAIPreferSelectedContext, selectedCollectionContextText]);

  const currentLivePreview = useMemo(
    () =>
      compactText(
        segments
          .slice(-4)
          .map((segment) => segment.text)
          .join(' '),
        160
      ),
    [segments]
  );

  const consumeMobileAIQuestion = useCallback(() => {
    setMobileAIConsumedQuestionNonce(mobileAIQuestionNonce);
  }, [mobileAIQuestionNonce]);

  const clearMobileAILaunchState = useCallback(() => {
    setMobileAIQuestion('');
    setMobileAIDisplayQuestion('');
    setMobileAILaunchImages([]);
    setMobileAILaunchSupportContextText('');
    setMobileAIConsumedQuestionNonce(null);
    setMobileAIPreferSelectedContext(false);
    setMobileAILaunchTarget(null);
  }, []);

  // ── Wechat Capture Import Hook（微信收集导入）──────
  useWechatCaptureImport(
    {
      wechatCaptureToken,
      accessToken,
      isAuthenticated,
      user,
      refreshDailyEcho,
      importDocumentLink: importArticleLinkIntoSourceItem,
    },
    {
      collectionComposerRef,
      importedWechatCaptureTokensRef,
      suppressNextCollectionPulsePreviewRef,
    },
  );

  // ── Workspace Context Loader Hook（工作区上下文加载 + 同步）──────
  useWorkspaceContextLoader(
    {
      accessToken,
      isAuthenticated,
      user,
      wechatCaptureToken,
      workspaceCaptures,
      captureDrivenPulse,
    },
    { workspaceContextRequestKeyRef },
  );

  // ── Collection Pulse Hook（发酵脉搏计算 + 活动摘要 + 自动显示/隐藏）──────
  const {
    collectionPulse,
    collectionPulseSignature,
    captureActivitySummary,
  } = useCollectionPulse(
    { collectionFeedItems },
    {
      lastCollectionPulseSignatureRef,
      suppressNextCollectionPulsePreviewRef,
    },
  );

  // NOTE: echoFilterOptions, filteredWorkspaceEchoes, historyWorkspaceEchoes,
  // groupedWorkspaceEchoes, _echoHistorySections, _latestEchoForCenter, _latestEchoIsToday,
  // canRequestManualEcho, manualEchoButtonLabel, renderManualEchoTriggerButton,
  // manualEchoFeedbackView, manualEchoDebugView
  // 已提取到 useEchoActions hook（见上方 hook 调用）。

  // ── Tutor Launcher Hook（学习同桌启动全部逻辑）──────
  const {
    openTutorFromCollection,
    openTutorWithSelectedCollectionContext,
    applyBatchActionToSelectedCollectionContext,
    openTutorFromCollectionItem,
  } = useTutorLauncher(
    {
      isMobile,
      selectedCollectionContextItems,
      clearCollectionContextSelection,
      archiveLocalCollectionItem,
      deleteLocalCollectionItem,
      updateWorkspaceCaptureStatus,
      updateSourceItem,
    },
    {
      segmentsRef,
      sessionIdRef,
      liveSegmentsRef,
      pendingCaptureStatusBySourceKeyRef,
    },
  );

  // ── Collection List Actions Hook（收集列表操作适配层）──────
  const {
    quoteCollectionListItemToComposer,
    openReviewFromCollectionListItem,
    toggleCollectionListItemSelection,
    archiveCollectionListItem,
    restoreCollectionListItem,
    deleteCollectionListItem,
    editWorkspaceCaptureFromList,
    openTutorFromCollectionListItem,
  } = useCollectionListActions(
    {
      openReviewFromCollection,
      quoteCollectionItemToComposer,
      toggleCollectionContextItem,
      archiveLocalCollectionItem,
      restoreLocalCollectionItem,
      deleteLocalCollectionItem,
      updateWorkspaceCaptureStatus,
      openWorkspaceCaptureEditor,
      openTutorFromCollectionItem,
    },
    { pendingCaptureStatusBySourceKeyRef },
  );

  useEffect(() => {
    if (showMobileRecorder || viewMode !== 'record') {
      stopAudioMessagePlayback();
    }
  }, [showMobileRecorder, stopAudioMessagePlayback, viewMode]);

  const openCollectionItemOriginal = useCallback((item: SourceIngestItem) => {
    const url = item.attachmentUrl || item.mediaUrl || item.previewUrl;
    if (!url || typeof window === 'undefined') return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const renderCollectionFeed = () => {
    const collectionChromeContained = !isMobile || isDesktopMobilePreview;
    const backdropPositionClass = collectionChromeContained ? 'absolute inset-0' : 'fixed inset-0';
    const dockPaddingClass = isMobile ? 'px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2' : 'px-6 pb-6 pt-3';
    const sheetBottomOffset = isMobile ? (showMobileRecorder ? 150 : 96) : (showMobileRecorder ? 168 : 118);
    const mobileSheetMaxHeight = isMobile
      ? `calc(100dvh - ${sheetBottomOffset}px - max(env(safe-area-inset-top), 14px) - 12px)`
      : 'min(72vh, 760px)';
    const mobileSheetScrollableStyle = {
      WebkitOverflowScrolling: 'touch' as const,
      touchAction: 'pan-y' as const,
    };
    const composerHasText = collectionComposerText.trim().length > 0;
    const composerRows = composerHasText ? 2 : 1;
    const topBarStatus = isRecording
      ? COPY.collection.topBarRecordingVoice
      : activeSourceImportCount > 0
        ? COPY.collection.topBarReceivingFiles(activeSourceImportCount)
        : '';

    return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-paper">
      {isMobile ? (
        <MobileRecordTopBar
          viewMode={viewMode}
          statusText={topBarStatus}
          onTabChange={handleViewModeChange}
          onOpenMore={() => {
            setShowMobileRecorder(false);
            setMobileCollectionSheet('more');
          }}
          onOpenHistory={() => {
            setShowMobileRecorder(false);
            setMobileCollectionSheet('history');
          }}
        />
      ) : null}

      <input
        ref={sourceFileInputRef}
        type="file"
        accept={sourceFileAccept}
        multiple
        onChange={handleSourceFileInputChange}
        className="hidden"
      />

      <div
        ref={collectionScrollRef}
        className="relative z-10 flex-1 overflow-y-auto px-3 pt-3 lg:px-5 lg:pt-4"
        style={{ paddingBottom: '24px' }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
          {collectionFeedItems.length > 0 ? (
            <div className="flex items-center justify-between gap-3 px-2 py-1">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
                <span className="inline-flex h-1 w-1 rounded-full bg-ink-muted" />
                <span>{COPY.collection.today}</span>
              </div>
              {isCollectionContextSelectionMode ? (
                <div className="text-[11px] font-medium text-ink">
                  {COPY.collection.selecting}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── 整理提示条：thinking-strip 气息 + 一句文案 + 最多 2 个动作 ── */}
          {showCollectionPulsePreview && collectionPulse ? (
            <div className="flex items-center gap-2.5 rounded-2xl border border-pine/15 bg-pine-fog/60 px-4 py-2.5">
              <span className="thinking-strip shrink-0">{collectionPulse.title}</span>
              <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-secondary">
                {collectionPulse.body}
              </p>
              {(collectionPulse.actions || []).slice(0, 2).map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => handleCollectionPulseAction(action.key)}
                  className="shrink-0 rounded-full border border-divider bg-card px-2.5 py-1 text-[11px] font-medium text-pine transition hover:border-pine/40 hover:bg-pine-fog"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          {collectionFeedItems.length === 0 ? (
            <CollectionEmptyState />
          ) : (
            <div className="flex flex-col gap-2.5">
              {showMobileRecorder ? (
                <div className="rounded-2xl border border-divider bg-card">
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="inline-flex items-center gap-3 rounded-[14px] bg-paper px-3.5 py-2.5">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-pine text-white">
                          <Mic size={14} />
                        </span>
                        <span className="flex items-end gap-[3px] text-ink-secondary">
                          {[8, 12, 16, 11, 15, 9, 13].map((height, index) => (
                            <span
                              key={`live-wave-${height}-${index}`}
                              className="w-[2px] rounded-full bg-current"
                              style={{ height: `${height}px`, opacity: 0.85 }}
                            />
                          ))}
                        </span>
                        <span className="text-[12px] font-medium text-ink-secondary">{COPY.collection.voiceRecording}</span>
                      </div>
                    </div>
                    {currentLivePreview ? (
                      <p className="mt-2.5 text-[14.5px] leading-[1.8] text-ink">
                        {currentLivePreview}
                      </p>
                    ) : (
                      <p className="mt-2.5 text-[14px] leading-[1.8] text-ink-muted">
                        {COPY.collection.voiceIdleHint}
                      </p>
                    )}
                    <div className="mt-2 text-[11px] text-ink-muted tabular-nums">
                      {formatRelativeCollectionTime(new Date().toISOString())}
                    </div>
                  </div>
                </div>
              ) : null}

              {collectionFeedItems.map((item) => (
                <div key={item.id} id={`collection-item-${encodeURIComponent(item.id)}`}>
                  <CollectionCard
                    item={item}
                    emphasized={emphasizedCollectionItemId === item.id}
                    isCollectionContextSelectionMode={isCollectionContextSelectionMode}
                    selectedCollectionContextIds={selectedCollectionContextIds}
                    audioPlaybackState={audioPlaybackState}
                    playingAudioMessageId={playingAudioMessageId}
                    expandedAudioTranscriptId={expandedAudioTranscriptId}
                    onOpenMessageMenu={openCollectionMessageMenu}
                    onBeginLongPress={beginCollectionMessageLongPress}
                    onCancelLongPress={cancelCollectionMessageLongPress}
                    onToggleAudioPlayback={toggleAudioMessagePlayback}
                    onToggleContextItem={toggleCollectionContextItem}
                    onSetExpandedAudioTranscriptId={setExpandedAudioTranscriptId}
                    onOpenReview={openReviewFromCollection}
                    longPressTriggeredRef={collectionLongPressTriggeredRef}
                  />
                </div>
              ))}

              {/* ── 回声提示条 ── */}
              {workspaceEchoes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMobileCollectionSheet('echo')}
                  className="flex w-full items-center gap-2.5 rounded-2xl border border-divider bg-card px-5 py-3.5 transition-colors hover:border-pine/30 hover:bg-paper"
                >
                  <span className="text-[12px] text-pine">✦</span>
                  <span className="min-w-0 flex-1 truncate text-left text-[13px] leading-5 text-ink-secondary">
                    {COPY.collection.echoUpdatedHint}
                  </span>
                  <ChevronRight size={14} className="flex-shrink-0 text-ink-muted" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 跳转到最新消息 浮动按钮（仿微信设计） ── */}
      {showScrollToLatest && (
        <button
          type="button"
          onClick={() => scrollCollectionToBottom(true)}
          className={`${collectionChromeContained ? 'absolute' : 'fixed'} bottom-28 left-1/2 z-20 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-pine px-4 py-2.5 text-[13px] font-medium text-white/90 shadow-float transition-all hover:bg-pine-deep active:scale-95`}
          aria-label={COPY.collection.scrollToLatest}
        >
          <ChevronsDown size={16} className="shrink-0" />
          <span>{COPY.collection.scrollToLatest}</span>
        </button>
      )}

      {activeCollectionMessageMenuItem ? (
        <CollectionMessageActionSheet
          item={activeCollectionMessageMenuItem}
          workspaceCaptures={workspaceCaptures}
          selectedCollectionContextIds={selectedCollectionContextIds}
          confirmCollectionDeleteId={confirmCollectionDeleteId}
          canUsePersistentCaptureActions={Boolean(isAuthenticated && accessToken && user?.id)}
          backdropPositionClass={backdropPositionClass}
          collectionChromeContained={collectionChromeContained}
          isMobile={isMobile}
          onClose={closeCollectionMessageMenu}
          onOpenReview={openReviewFromCollection}
          onAskTutor={openTutorFromCollectionItem}
          onQuote={quoteCollectionItemToComposer}
          onToggleSelect={toggleCollectionContextItem}
          onEditCapture={openWorkspaceCaptureEditor}
          onOpenOriginal={openCollectionItemOriginal}
          onUpdateCaptureStatus={updateWorkspaceCaptureStatus}
          onRemoveFromFlow={removeCollectionItemsFromFlow}
          onSetConfirmDelete={setConfirmCollectionDeleteId}
        />
      ) : null}

      <MobileCollectionSheet
        mobileCollectionSheet={mobileCollectionSheet}
        isMobile={isMobile}
        backdropPositionClass={backdropPositionClass}
        collectionChromeContained={collectionChromeContained}
        dockPaddingClass={dockPaddingClass}
        sheetBottomOffset={sheetBottomOffset}
        sheetWidthClass={isMobile ? 'max-w-lg' : 'max-w-3xl'}
        mobileSheetMaxHeight={mobileSheetMaxHeight}
        mobileSheetScrollableStyle={mobileSheetScrollableStyle}
        captureActivitySummary={captureActivitySummary}
        workspaceEchoes={workspaceEchoes}
        showCollectionPulsePreview={showCollectionPulsePreview}
        hasCollectionPulse={Boolean(collectionPulse)}
        enableManualEchoTrigger={ENABLE_ECHO_MANUAL_TRIGGER}
        allCollectionItems={allCollectionItems}
        selectedCaptureIds={selectedCollectionListIds}
        selectionMode={isCollectionContextSelectionMode}
        manualEchoFeedbackView={manualEchoFeedbackView}
        manualEchoDebugView={manualEchoDebugView}
        renderManualEchoTriggerButton={renderManualEchoTriggerButton}
        onClose={() => setMobileCollectionSheet(null)}
        onChangeSheet={setMobileCollectionSheet}
        onShareEcho={setSharingEcho}
        onOpenReview={openReviewFromCollectionListItem}
        onQuoteCapture={quoteCollectionListItemToComposer}
        onAskTutorAboutCapture={openTutorFromCollectionListItem}
        onToggleSelectCapture={toggleCollectionListItemSelection}
        onArchiveCapture={archiveCollectionListItem}
        onRestoreCapture={restoreCollectionListItem}
        onDeleteCapture={deleteCollectionListItem}
        onEditCapture={editWorkspaceCaptureFromList}
        onAISearch={() => setShowAISearch(true)}
        onAddContext={() => {
          setMobileCollectionSheet(null);
          window.requestAnimationFrame(() => collectionComposerRef.current?.focus());
        }}
      />

      {isCollectionContextSelectionMode && selectedCollectionContextItems.length > 0 ? (
        <CollectionSelectionBar
          selectedCount={selectedCollectionContextItems.length}
          confirmDelete={confirmSelectedCollectionDelete}
          onAskTutor={openTutorWithSelectedCollectionContext}
          onQuote={quoteSelectedCollectionContextToComposer}
          onArchive={() => {
            void applyBatchActionToSelectedCollectionContext('archive');
          }}
          onDelete={() => {
            void applyBatchActionToSelectedCollectionContext('delete');
          }}
          onClear={clearCollectionContextSelection}
        />
      ) : null}

      {showMobileRecorder ? (
        <div className="relative z-30 flex-shrink-0 bg-[#FAF7F2] px-3 pb-[max(env(safe-area-inset-bottom),6px)] pt-2 lg:px-5 lg:pb-5 lg:pt-2">
          <div className="mx-auto w-full max-w-3xl">
            {/* continueCurrentSession 强制 false：每次点"录课"= 一节新课，
               必须生成新 sessionId。若沿用旧 sessionId，saveAudioSession
               的 upsert 会把新录音合并到上一节课的 DB 行，新卡片不会出现。 */}
            <Recorder
              recorderRef={recorderRef}
              activeSessionId={sessionId}
              continueCurrentSession={false}
              autoStartSignal={recorderAutoStartSignal}
              compactMode
              onRecordingStart={handleRecordingStart}
              onRecordingStop={handleRecordingStop}
              onTranscriptionError={handleRecordingTranscriptionError}
              onTranscriptUpdate={handleTranscriptUpdate}
              onTranscriptTextUpdate={handleTranscriptTextUpdate}
              onTranscriptEnhanced={handleTranscriptEnhanced}
              onAnchorMark={handleAnchorMark}
              contextHint={liveASRContextHint}
            />
          </div>
        </div>
      ) : (
        <CollectionComposerBar
          quotedCount={quotedCollectionContextItems.length}
          quotedPrimaryTypeLabel={quotedCollectionPrimaryItem ? getCollectionContextTypeLabel(quotedCollectionPrimaryItem.type) : '内容'}
          quotedSummaryText={quotedCollectionSummaryText}
          onClearQuoted={clearQuotedCollectionContext}
          linkPreviewLabel={composerLinkPreview?.providerLabel || ''}
          autoImportLink={composerCanAutoImportLink}
          onOpenLiveRecorder={openLiveRecorder}
          disableLiveRecorder={false}
          composerRef={collectionComposerRef}
          value={collectionComposerText}
          onChangeValue={(value: string) => {
            setSourceImportError('');
            setCollectionComposerText(value);
          }}
          onPaste={handleCollectionComposerPaste}
          placeholder={collectionComposerPlaceholder}
          rows={composerRows}
          sourceImporting={sourceImporting}
          activeSourceImportCount={activeSourceImportCount}
          composerVoiceStatus={composerVoiceStatus}
          isComposerVoiceRecording={isComposerVoiceRecording}
          composerVoiceInterimText={composerVoiceInterimText}
          sourceImportError={sourceImportError}
          onSubmit={handleCollectionComposerSubmit}
          onToggleDictation={toggleComposerDictation}
          disableDictation={showMobileRecorder || isRecording}
          onUploadAll={() => handleSourceFileButtonClick('all')}
        />
      )}

    </div>
  );
  };

  // 包装 openWorkshopWindow：如果随堂检验正在进行，先关掉弹窗
  const safeOpenWorkshopWindow = useCallback((appKey: Parameters<typeof openWorkshopWindow>[0]) => {
    if (classCheck.isCheckActive) {
      // 跳过当前检验轮次，恢复播放，然后打开窗口
      classCheck.handleCheckComplete({
        roundIndex: classCheck.currentRoundIndex,
        questions: classCheck.currentQuestions,
        answers: {},
        correctCount: 0,
        totalCount: classCheck.currentQuestions.length,
      });
    }
    if (classCheck.pendingCheckpoint) {
      classCheck.dismissPendingCheckpoint();
    }
    openWorkshopWindow(appKey);
  }, [classCheck, openWorkshopWindow]);

  const renderSharedWorkspacePanel = useCallback((tab: SharedWorkspaceTab, options?: {
    activeAppKey?: WorkshopAppKey | null;
    onActiveAppChange?: (appKey: WorkshopAppKey | null) => void;
    onLearningActivity?: (line: string) => void;
  }) => {
    return (
      <SharedWorkspacePanel
        tab={tab}
        onSeek={handleUnifiedSeek}
        classSummary={classSummary}
        sessionId={sessionId}
        dataSource={dataSource}
        segments={segments}
        anchors={anchors}
        onOpenAppWindow={safeOpenWorkshopWindow}
        activeAppKey={options?.activeAppKey}
        onActiveAppChange={options?.onActiveAppChange}
        terminologyHint={extractedTermsHint || undefined}
        contextTitle={reviewContextTitle}
        onLearningActivity={options?.onLearningActivity}
      />
    );
  }, [
    anchors,
    classSummary,
    dataSource,
    extractedTermsHint,
    handleUnifiedSeek,
    safeOpenWorkshopWindow,
    reviewContextTitle,
    segments,
    sessionId,
  ]);

  const timelineForView = timeline ? {
    lessonId: timeline.lessonId,
    segments: timeline.segments.map(s => ({
      id: s.id,
      text: s.text,
      startMs: s.startMs,
      endMs: s.endMs,
    })),
    breakpoints: timeline.anchors.map(a => ({
      id: a.id,
      lessonId: timeline.lessonId,
      studentId: a.studentId,
      timestamp: a.timestamp,
      type: a.type as 'confusion' | 'important' | 'question',
      resolved: a.resolved,
      createdAt: a.createdAt,
    })),
    topics: [],
  } : null;

  const selectedBreakpoint = selectedAnchor ? {
    id: selectedAnchor.id,
    lessonId: sessionId,
    studentId: selectedAnchor.studentId,
    timestamp: selectedAnchor.timestamp,
    type: selectedAnchor.type as 'confusion' | 'important' | 'question',
    resolved: selectedAnchor.resolved,
    createdAt: selectedAnchor.createdAt,
  } : null;

  const unresolvedCount = anchors.filter(a => !a.resolved).length;

  if (!mounted) {
    return <AppLoading message="正在准备学习空间" />;
  }

  const shouldAllowPageScroll = !isMobile && (viewMode === 'record' || (viewMode === 'review' && !!videoSource));
  const useFixedViewportLayout = !(!isMobile && viewMode === 'record');
  const rootClassName = isDesktopMobilePreview
    ? 'relative flex h-full min-h-0 flex-col overflow-hidden'
    : isMobile
      ? `${useFixedViewportLayout ? 'h-dvh' : 'min-h-dvh'} flex flex-col main-content-enter browser-safe-top ${
          shouldAllowPageScroll ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
        }`
      : 'h-dvh flex flex-row main-content-enter overflow-hidden';
  const rootStyle = isDesktopMobilePreview
    ? { height: '100%' as const }
    : isMobile
      ? (useFixedViewportLayout
          ? { height: '100dvh', minHeight: '-webkit-fill-available' }
          : { minHeight: '100dvh' })
      : { height: '100dvh', minHeight: '-webkit-fill-available' };

  return (
    <div
      className={rootClassName}
      style={rootStyle}
    >
      {/* Splash overlay — fixed position, renders on top. App underneath is in DOM and interactive during fade-out. */}
      {showSplash && (
        <AppLoading 
          progress={loadingProgress}
          message={loadingProgress >= 100 ? '即将进入' : undefined}
          onComplete={loadingProgress >= 100 ? handleSplashComplete : undefined}
        />
      )}
      {/* ── 桌面端侧边栏 ── */}
      {!isMobile && (
        <DesktopSidebar
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onOpenAISearch={() => setShowAISearch(true)}
          onOpenHistory={() => {
            setShowMobileRecorder(false);
            setMobileCollectionSheet('history');
          }}
          onOpenEcho={() => {
            setShowMobileRecorder(false);
            void handleViewModeChange('record').then(() => {
              setMobileCollectionSheet('echo');
            });
          }}
          isEchoActive={mobileCollectionSheet === 'echo'}
          echoCount={workspaceEchoes.length}
          reviewTab={reviewTab}
          onReviewTabChange={(tab) => setReviewTab(tab as typeof reviewTab)}
          unresolvedAnchorCount={unresolvedCount}
          hasTimeline={!!timelineForView}
          focusMode={viewMode === 'classroom' && isRecording}
        />
      )}

      {/* ── 主内容区（桌面端为侧栏右侧 flex-1） ── */}
      <div className={isMobile ? 'flex flex-1 min-h-0 flex-col' : 'flex flex-1 min-w-0 flex-col overflow-hidden'}>
      {!isMobile && <DegradedModeBanner status={serviceStatus} />}

      {/* 主内容区 */}
      {isMobile ? (
        <MobileAppShell
          collectionFeedItems={collectionFeedItems}
          workspaceEchoes={workspaceEchoes}
          autoStartDemo={autoLoadDemo}
          demoMode={dataSource === 'demo' || autoLoadDemo}
          demoAudioUrl={dataSource === 'demo' ? (audioUrl || '/demo-audio.mp3') : undefined}
          onStartDemo={async () => {
            const demoData = await loadDemoData();
            setSegments(demoData.DEMO_SEGMENTS);
            setAnchors(demoData.DEMO_ANCHORS);
            setAudioUrl(demoData.DEMO_AUDIO_URL);
            setVideoSource(null);
            setDataSource('demo');
            sessionActions.setSessionId('guest-demo');
            setSessionMediaDurationMs(demoData.DEMO_SEGMENTS.at(-1)?.endMs ?? 0);
            setCurrentTime(0);
            setIsPlaying(false);
          }}
          onStartRecording={async () => {
            // 只有 Recorder 真正拿到音频流并开始保存原声后，MobileAppShell 才进入录课页。
            // handleRecordingStart 会在这个 Promise 返回前同步隔离新 session 和清空旧课。
            if (!recorderRef.current) {
              toast.error(COPY.recording.startFailed(COPY.recording.recorderNotReady));
              return false;
            }
            return recorderRef.current.startRecording();
          }}
          onOpenFilePicker={(mode) => handleSourceFileButtonClick(mode)}
          onOpenReview={(item) => openReviewFromCollection(item)}
          composerText={collectionComposerText}
          onComposerChange={(text) => setCollectionComposerText(text)}
          onComposerSubmit={handleCollectionComposerSubmit}
          onComposerPaste={(e) => handleCollectionComposerPaste(e as React.ClipboardEvent<HTMLTextAreaElement>)}
          onToggleComposerDictation={toggleComposerDictation}
          composerVoiceStatus={composerVoiceStatus}
          composerVoiceInterimText={composerVoiceInterimText}
          composerRef={collectionComposerRef}
          segments={segments}
          sessionId={sessionId}
          selectedReviewItem={selectedReviewItem}
          onSeek={(ms) => handleUnifiedSeek(ms)}
          currentTime={currentTime}
          totalDuration={totalDuration}
          isPlaying={isPlaying}
          onPlayPause={() => { if (isPlaying) { waveformRef.current?.pause(); } else { waveformRef.current?.play(); } }}
          isRecording={isRecording}
          onStopRecording={() => {
            if (isRecording) {
              sessionActions.setIsRecording(false);
              if (sessionId) {
                void saveAudioSession(null, sessionId, user?.id || ANONYMOUS_USER_ID, {
                  subject: UIConfig.defaultSubject,
                  duration: sessionMediaDurationMs,
                  sourceType: 'recording',
                  transcriptionStatus: 'pending',
                }).catch((err) => {
                  console.warn('[mobile] pre-stop placeholder save failed:', err);
                });
              }
              void recorderRef.current?.stopRecording();
            }
          }}
          onPhotoCaptured={(file, capturedAtMs) => {
            void handleImportFiles([file], 'support', { capturedAtMs, sessionId: sessionId || undefined });
          }}
          onOpenEcho={() => { /* MobileAppShell 内部 push echo screen */ }}
          onOpenSearch={() => setShowAISearch(true)}
          onOpenProfile={() => { window.location.href = '/settings'; }}
          onQuickAsk={(question) => {
            setMobileAIQuestion(question);
            setMobileAIDisplayQuestion('');
            setMobileAILaunchImages([]);
            setMobileAILaunchSupportContextText('');
            setMobileAIConsumedQuestionNonce(null);
            setMobileAIPreferSelectedContext(false);
            setMobileAIQuestionNonce((prev) => prev + 1);
          }}
          echoList={workspaceEchoes}
          reviewSheetContent={
            <SafeAITutor
              isMobile={true}
              sessionId={sessionId}
              lessonTitle={reviewContextTitle}
              segments={segments}
              isLoading={false}
              onResolve={handleResolveAnchor}
              onSeek={handleUnifiedSeek}
              breakpoint={selectedBreakpoint}
              supportContextText={tutorSupportContextText}
              preferSupportContext={mobileAIPreferSelectedContext}
              launchQuestion={mobileAIQuestion}
              launchDisplayText={mobileAIDisplayQuestion}
              launchImages={mobileAILaunchImages}
              launchQuestionNonce={mobileAIQuestionNonce}
              onLaunchQuestionConsumed={() => setMobileAIConsumedQuestionNonce(mobileAIQuestionNonce)}
              onActionItemsUpdate={(items: ActionItem[]) => captureEditorActions.setActionItems(items)}
              hideMobileHeader={true}
            />
          }
          reviewSheetPreview={segments.length > 0 ? '这节课有问题随时问我' : '问我任何事'}
          classmateContent={
            <SafeAITutor
              isMobile={true}
              sessionId={sessionId}
              lessonTitle={reviewContextTitle}
              segments={segments}
              isLoading={false}
              onResolve={handleResolveAnchor}
              onSeek={handleUnifiedSeek}
              breakpoint={selectedBreakpoint}
              supportContextText={tutorSupportContextText}
              preferSupportContext={mobileAIPreferSelectedContext}
              launchQuestion={mobileAIQuestion}
              launchDisplayText={mobileAIDisplayQuestion}
              launchImages={mobileAILaunchImages}
              launchQuestionNonce={mobileAIQuestionNonce}
              onLaunchQuestionConsumed={() => setMobileAIConsumedQuestionNonce(mobileAIQuestionNonce)}
              onActionItemsUpdate={(items: ActionItem[]) => captureEditorActions.setActionItems(items)}
              hideMobileHeader={true}
            />
          }
          userNickname={user?.nickname}
          userAvatar={user?.avatar}
          isAuthenticated={isAuthenticated}
        >
          {/* ── 移动端隐藏挂载：Recorder + WaveformPlayer + source file input ── */}
          {/* 这些组件必须在移动端挂载，否则 recorderRef/waveformRef 为 null，所有录音/播放/导入按钮都失灵 */}
          <div className="sr-only" aria-hidden>
            <Recorder
              recorderRef={recorderRef}
              headless
              activeSessionId={sessionId}
              continueCurrentSession={false}
              autoStartSignal={recorderAutoStartSignal}
              onRecordingStart={handleRecordingStart}
              onRecordingStop={handleRecordingStop}
              onTranscriptionError={handleRecordingTranscriptionError}
              onTranscriptUpdate={handleTranscriptUpdate}
              onTranscriptTextUpdate={handleTranscriptTextUpdate}
              onTranscriptEnhanced={handleTranscriptEnhanced}
              onAnchorMark={handleAnchorMark}
              contextHint={liveASRContextHint}
              audioSource={recorderAudioSource}
            />
          </div>
          {(audioBlob || audioUrl) && dataSource !== 'demo' && (
            <div className="sr-only" aria-hidden>
              <WaveformPlayer
                playerRef={waveformRef}
                src={audioBlob || audioUrl || undefined}
                anchors={anchors.map(a => ({
                  id: a.id,
                  timestamp: a.timestamp,
                }))}
                onTimeUpdate={setCurrentTime}
                onPlayStateChange={setIsPlaying}
                onReady={(durationMs) => {
                  if (durationMs > 0) {
                    const current = useSessionStore.getState().sessionMediaDurationMs;
                    if (current === 0 || Math.abs(current - durationMs) > 1000) {
                      setSessionMediaDurationMs(durationMs);
                    }
                  }
                }}
              />
            </div>
          )}
          <input
            ref={sourceFileInputRef}
            type="file"
            accept={sourceFileAccept}
            multiple
            className="hidden"
            onChange={handleSourceFileInputChange}
          />
        </MobileAppShell>
      ) : viewMode === 'classroom' ? (
        <div className="flex flex-1 min-h-0 flex-col page-enter">
          <div className="flex-1 min-h-0">
            <ClassroomView
              isRecording={isRecording}
              onOpenApp={safeOpenWorkshopWindow}
              onAddMaterial={() => {
                void handleViewModeChange('record').then(() => handleSourceFileButtonClick('all'));
              }}
              onSearch={() => setShowAISearch(true)}
              autoLoadDemo={autoLoadDemo}
              autoOpenDemoAppKey={autoOpenDemoAppKey}
              onOpenDemoReview={() => {
                setReviewTab('apps');
                setVideoWorkspaceTab('apps');
                setMobileSubPage(isMobile ? 'apps' : null);
                setShowTranscriptBar(false);
                handleViewModeChange('review');
              }}
              onStartRecording={() => {
                // 课堂 tab 的 Recorder 是 sr-only 挂载点。
                // showMobileRecorder 挂载点用 compactMode（紧凑布局），但 transcribeMode
                // 不再被 compactMode 影响（手机端 P0 修复，Recorder.tsx 已解耦）——
                // 两处都默认 streaming，挂载点冲突时 recorderRef / 麦克风权限会互相抢，
                // 仍然不要同时打开两个挂载点。
                if (recorderRef.current) {
                  void recorderRef.current.startRecording();
                } else {
                  // Recorder 还没挂载时用 signal 触发
                  captureEditorActions.setRecorderAutoStartSignal(Date.now());
                }
              }}
              onStopRecording={(lessonId) => {
                const effectiveLessonId = lessonId || sessionId;

                // 真在录 → 先立刻退出录课态，并写一张"正在理解"的占位卡，
                // 再让隐藏的 Recorder 在后台慢慢收尾。
                //
                // 用户视角里，"结束这节课"应该是一个确定动作：点一次，
                // 立刻回到课堂列表，并马上看见这节课已经在酿造。
                // 不能等 MediaRecorder / ASR / blob flush 全部异步完成后
                // 才给反馈——那会让人误以为第一次没点上，于是再点第二次。
                if (isRecording) {
                  sessionActions.setIsRecording(false);

                  if (effectiveLessonId) {
                    void saveAudioSession(null, effectiveLessonId, user?.id || ANONYMOUS_USER_ID, {
                      subject: UIConfig.defaultSubject,
                      duration: sessionMediaDurationMs,
                      sourceType: 'recording',
                      transcriptionStatus: 'pending',
                    }).catch((err) => {
                      console.warn('[classroom] pre-stop placeholder save failed:', err);
                    });
                  }

                  void recorderRef.current?.stopRecording();
                  return;
                }
                // 不在录但用户点了"正在录音" pill 的停止按钮——
                // 说明这是一条卡在 status='recording' 的幽灵会话
                // （旧版脏数据或异常中断）。直接把它标为 completed，
                // UI 立刻把 pill 去掉。
                if (effectiveLessonId) {
                  void updateSessionStatus(effectiveLessonId, 'completed').catch((err) => {
                    console.warn('[classroom] cleanup stale recording failed:', err);
                  });
                }
              }}
              onOpenLesson={async (lessonId) => {
                // 真实 sessionId → 复用复习态
                const ok = await restoreReviewSession(lessonId, {
                  reviewTab: 'timeline',
                  videoWorkspaceTab: 'chat',
                  currentTime: 0,
                  showTranscriptBar: false,
                });

                if (!ok) {
                  console.warn('[classroom] open lesson failed (incomplete data):', lessonId);
                }
              }}
              onRenameLesson={(id, title) => {
                // 用户手动改名 = 最高优先级的标题意图：本地加锁 + 服务端加锁，
                // 自动标题系统从此不再覆盖这节课
                void lockLessonTitleByUser({ sessionId: id, title, accessToken }).catch((err) => {
                  console.warn('[classroom] rename lesson failed:', err);
                });
              }}
              onQuickPhoto={(capturedAtMs) => {
                // 课中拍照：触发隐藏的 file input，选完传 capturedAtMs
                if (sourceFileInputRef.current) {
                  sourceFileInputRef.current.dataset.capturedAtMs = String(capturedAtMs);
                  sourceFileInputRef.current.dataset.sessionId = sessionId || '';
                  sourceFileInputRef.current.click();
                }
              }}
              {...(hasActiveScreenTrack() ? {
                onCaptureFrame: (capturedAtMs: number) => {
                  // 课中「截取这一页」：从屏幕流抓当前帧挂到课堂时间轴（主动意图锚点）
                  void captureCurrentFrame(sessionId || '', capturedAtMs).then((ok) => {
                    toast(ok ? COPY.recording.captureFrameSaved : COPY.recording.captureFrameFailed, { duration: 2500 });
                  });
                },
              } : {})}
            />
          </div>
          {/* ── 课堂 tab 下的 Recorder 挂载点：视觉隐藏，只作为录音引擎 ── */}
          {/* 这里挂载 = 录音发生在课堂 tab 内，不跳走 */}
          {/* 历史：旧实现里 compactMode 会强制 batch 模式、阻止流式 ASR；手机端 P0
             修复后 compactMode 已解耦（仅影响 UI 紧凑度），现在 streaming 是默认。
             这里仍不传 compactMode 是因为整块被 sr-only 隐藏，UI 尺寸无所谓。 */}
          {/* continueCurrentSession 强制 false：课堂场景下"开始录音"= 一节新课，
             必须生成新 sessionId，否则 saveAudioSession 的 upsert 会把新内容
             merge 到上一次课的那一行，导致课堂列表看不到新卡片。 */}
          <div className="sr-only" aria-hidden>
            <Recorder
              recorderRef={recorderRef}
              headless
              activeSessionId={sessionId}
              continueCurrentSession={false}
              autoStartSignal={recorderAutoStartSignal}
              onRecordingStart={handleRecordingStart}
              onRecordingStop={handleRecordingStop}
              onTranscriptionError={handleRecordingTranscriptionError}
              onTranscriptUpdate={handleTranscriptUpdate}
              onTranscriptTextUpdate={handleTranscriptTextUpdate}
              onTranscriptEnhanced={handleTranscriptEnhanced}
              onAnchorMark={handleAnchorMark}
              contextHint={liveASRContextHint}
              audioSource={recorderAudioSource}
            />
          </div>
        </div>
      ) : viewMode === 'record' ? (
        <>
          {isMobile ? (
            <>
              {/* 移动端采集台 hero + 精简收集流 */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#FAF7F2]">
                {/* 顶栏（极简，只有 Octo + 日期 + 搜索 + 头像） */}
                <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="relative h-8 w-8">
                        <div className="absolute inset-0 rounded-full bg-pine-mist overflow-hidden">
                          <img src="/images/octo-buddy/idle.png" alt="Octo" className="h-full w-full object-cover" />
                        </div>
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-ink leading-tight">MeetMind</p>
                        <p className="font-mono text-[9px] text-ink-muted">{new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted" onClick={() => setSourceImportError('搜索功能开发中')}>
                        <Search size={16} strokeWidth={2} />
                      </button>
                      <div className="h-7 w-7 rounded-full bg-paper-warm ring-1 ring-divider flex items-center justify-center text-[10px] font-medium text-ink-muted">
                        {user?.nickname?.[0] || '林'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 可滚动区域 */}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-2 pb-20" style={{ WebkitOverflowScrolling: 'touch' }}>
                  {/* Hero 标题 */}
                  <h1 className="font-serif text-[22px] leading-[1.15] tracking-[-0.02em] text-ink mb-2.5">今天学点什么？</h1>

                  {/* 采集三按钮 */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => { handleViewModeChange('classroom'); }}
                      className="col-span-3 flex items-center gap-3 rounded-[16px] bg-white border-2 border-vermilion/20 p-3 text-left active:scale-[0.98] transition"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-vermilion-mist">
                        <Mic size={16} strokeWidth={2} className="text-vermilion" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-vermilion">录一节课</p>
                        <p className="text-[10px] text-ink-muted">课堂 · 讲座 · 随时听</p>
                      </div>
                      <span className="relative flex h-2 w-2 flex-shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-50"></span>
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-vermilion"></span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSourceFileButtonClick('support')}
                      className="rounded-[14px] bg-white border border-divider p-2 text-center active:scale-95 transition"
                    >
                      <div className="flex h-8 w-8 mx-auto items-center justify-center rounded-full bg-vermilion-mist mb-1">
                        <Camera size={14} strokeWidth={2} className="text-vermilion" />
                      </div>
                      <p className="text-[11px] font-semibold text-ink">拍一下</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => focusCollectionComposer()}
                      className="col-span-2 rounded-[14px] bg-white border border-divider p-2 flex items-center gap-2 text-left active:scale-[0.98] transition"
                    >
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-pine-mist">
                        <Edit3 size={14} strokeWidth={2} className="text-pine" />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-ink">速记一句</p>
                        <p className="text-[9px] text-ink-muted">想法 · 疑问 · 课后笔记</p>
                      </div>
                    </button>
                  </div>

                  {/* Echo 卡片 */}
                  {workspaceEchoes.length > 0 && (
                    <div
                      className="mb-3 rounded-[16px] border border-pine/20 bg-pine-mist/50 p-3 shadow-soft cursor-pointer active:scale-[0.99] transition"
                      onClick={() => handleViewModeChange('review')}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="h-5 w-5 rounded-full bg-pine-mist overflow-hidden flex-shrink-0">
                          <img src="/images/octo-buddy/happy.png" alt="Octo" className="h-full w-full object-cover" />
                        </div>
                        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-pine">{COPY.feed.relatedInfoLabel}</span>
                      </div>
                      {(() => {
                        const echo = workspaceEchoes[0];
                        const text = echo.body || echo.title || '今天的学习内容已整理好。';
                        return <p className="text-[11px] leading-[1.6] text-ink">{text.length > 60 ? text.slice(0, 60) + '…' : text}</p>;
                      })()}
                    </div>
                  )}

                  {/* 精简收集流 */}
                  <div className="flex items-baseline gap-2 px-1 pb-2">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">最近</span>
                    <span className="font-mono text-[10px] text-ink-muted/70">{collectionFeedItems.length}</span>
                    <span className="ml-1 h-px flex-1 bg-divider"></span>
                  </div>

                  <div className="space-y-2" id="mobileCollectionList">
                    {/* 隐藏的 file input */}
                    <input
                      ref={sourceFileInputRef}
                      type="file"
                      accept={sourceFileAccept}
                      multiple
                      className="hidden"
                      onChange={handleSourceFileInputChange}
                    />
                    {collectionFeedItems.slice(0, 20).map((item) => (
                      <MobileCollectionCard
                        key={item.id}
                        item={item}
                        onClick={() => {
                          if (item.reviewable) {
                            void openReviewFromCollection(item);
                          } else if (item.type === 'text' || item.type === 'document') {
                            quoteCollectionItemToComposer(item);
                          } else {
                            setSourceImportError(item.title || '');
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* 底部输入条 */}
                <div className="flex-shrink-0 bg-paper px-3 py-2 pb-[max(env(safe-area-inset-bottom),8px)] border-t border-divider/60">
                  <div className="flex items-center gap-2">
                    <button className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted flex-shrink-0" onClick={() => handleSourceFileButtonClick('all')}>
                      <Paperclip size={16} strokeWidth={2} />
                    </button>
                    <div className="flex-1 rounded-full bg-canvas px-3.5 py-2">
                      <textarea
                        ref={collectionComposerRef}
                        rows={1}
                        value={collectionComposerText}
                        placeholder="发一句想法，贴个链接…"
                        className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-muted outline-none resize-none"
                        onChange={(e) => setCollectionComposerText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleCollectionComposerSubmit(); } }}
                        onPaste={handleCollectionComposerPaste}
                      />
                    </div>
                    <button
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted flex-shrink-0"
                      onClick={toggleComposerDictation}
                    >
                      <Mic size={16} strokeWidth={2} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0 page-enter">
              <DesktopCollectionLayout>
                {renderCollectionFeed()}
              </DesktopCollectionLayout>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Desktop review layout — extracted to DesktopVideoReviewLayout */}
          {!isMobile ? (
            <DesktopVideoReviewLayout
              totalDuration={totalDuration}
              studentId={studentId}
              tutorSupportContextText={tutorSupportContextText}
              selectedBreakpoint={selectedBreakpoint}
              timelineForView={timelineForView}
              waveformRef={waveformRef}
              handleUnifiedSeek={handleUnifiedSeek}
              handleAnchorMark={handleAnchorMark}
              handleAnchorSelect={handleAnchorSelect}
              handleResolveAnchor={handleResolveAnchor}
              handleTranscriptTextUpdate={handleTranscriptTextUpdate}
              handleActionItemsUpdate={handleActionItemsUpdate}
              handleActionComplete={handleActionComplete}
              handleStartNextAction={handleStartNextAction}
              handlePlaybackAnchorAdd={handlePlaybackAnchorAdd}
              handleAddNote={handleAddNote}
              renderSharedWorkspacePanel={renderSharedWorkspacePanel}
              consumeMobileAIQuestion={consumeMobileAIQuestion}
              onTriggerCheckpoint={classCheck.triggerCheckpointManually}
              isPlanLoading={classCheck.isPlanLoading}
              onVideoTimeUpdate={handleVideoTimeUpdate}
              onPlayingChange={setIsPlaying}
              sourceFullText={selectedReviewItem?.fullText}
              sourceImageUrls={selectedReviewItem?.imageUrls}
              lessonTitle={reviewContextTitle}
            />
          ) : (
            /* 手机端主内容区 */
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white">
              <MobileTopBar
                viewMode={viewMode}
                onTabChange={handleViewModeChange}
                isAuthenticated={isAuthenticated}
                user={user}
                onOpenMenu={() => setIsMenuOpen(true)}
              />

              {!mobileSubPage && !videoSource && (
                <MiniPlayer
                  currentTime={currentTime}
                  duration={totalDuration}
                  isPlaying={isPlaying}
                  markers={anchors.map(a => ({
                    id: a.id,
                    timestamp: a.timestamp,
                    resolved: a.resolved,
                  }))}
                  onSeek={(timeMs) => {
                    handleUnifiedSeek(timeMs);
                  }}
                  onPlayPause={() => {
                    if (isPlaying) {
                      waveformRef.current?.pause();
                    } else {
                      waveformRef.current?.play();
                    }
                    setIsPlaying(!isPlaying);
                  }}
                  onMarkerClick={(marker) => {
                    const anchor = anchors.find(a => a.id === marker.id);
                    if (anchor) {
                      const context = segments.find(
                        s => marker.timestamp >= s.startMs && marker.timestamp <= s.endMs
                      )?.text;
                      
                      setSelectedConfusion({
                        id: marker.id,
                        timestamp: marker.timestamp,
                        content: anchor.note,
                        resolved: marker.resolved,
                        context,
                      } as ConfusionMarker & { context?: string });
                      
                      handleAnchorSelect(anchor);
                    }
                  }}
                />
              )}

              {/* Hidden waveform player for actual audio playback control. */}
              {(audioBlob || audioUrl) && (
                <div className="hidden">
                  <WaveformPlayer
                    playerRef={waveformRef}
                    src={audioBlob || audioUrl || undefined}
                    anchors={anchors.map(a => ({
                      id: a.id,
                      timestamp: a.timestamp,
                      resolved: a.resolved,
                      type: a.type,
                    } as WaveformAnchor))}
                    onTimeUpdate={setCurrentTime}
                    onPlayStateChange={setIsPlaying}
                    onReady={(durationMs) => {
                      // WaveformPlayer 加载完成后用真实时长兜底，
                      // 仅当真实时长大于当前值时覆盖，避免回退已正确的值。
                      if (durationMs > 0) {
                        const current = useSessionStore.getState().sessionMediaDurationMs;
                        if (current === 0 || Math.abs(current - durationMs) > 1000) {
                          setSessionMediaDurationMs(durationMs);
                        }
                      }
                    }}
                    onAnchorClick={(anchor) => {
                      const found = anchors.find(a => a.id === anchor.id);
                      if (found) handleAnchorSelect(found);
                    }}
                    onAnchorAdd={handlePlaybackAnchorAdd}
                    allowAddAnchor={true}
                    selectedAnchorId={selectedAnchor?.id}
                    height={0}
                    showControls={false}
                  />
                </div>
              )}

              {mobileSubPage === null && (
                <>
                  {videoSource && (
                    <div className="px-4 pt-3">
                      <VideoReviewPlayer
                        source={videoSource}
                        seekToMs={currentTime}
                        seekNonce={videoSeekNonce}
                        playNonce={videoPlayNonce}
                        pauseNonce={videoPauseNonce}
                        onTimeUpdate={handleVideoTimeUpdate}
                        onPlayingChange={setIsPlaying}
                        totalDurationMs={totalDuration}
                      />
                    </div>
                  )}

                  {/* Mobile digest toggle: 笔记 / 转录 */}
                  {isMobile && segments.length > 0 && (
                    <div className="flex items-center gap-1 px-4 py-2 border-b border-divider/60 bg-paper">
                      <div className="inline-flex rounded-full bg-paper-warm p-0.5">
                        <button
                          type="button"
                          onClick={() => setMobileDigestView(true)}
                          className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${mobileDigestView ? 'bg-white text-ink shadow-soft' : 'text-ink-muted'}`}
                        >
                          笔记
                        </button>
                        <button
                          type="button"
                          onClick={() => setMobileDigestView(false)}
                          className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${!mobileDigestView ? 'bg-white text-ink shadow-soft' : 'text-ink-muted'}`}
                        >
                          转录
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Mobile Lesson Digest view */}
                  {isMobile && mobileDigestView && segments.length > 0 ? (
                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
                      {digestLoading ? (
                        <div className="flex flex-col items-center justify-center py-12">
                          <div className="relative h-16 w-16 mb-4">
                            <div className="absolute inset-0 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden animate-pulse">
                              <img src="/images/octo-buddy/thinking.png" alt="Octo" className="h-full w-full object-cover" />
                            </div>
                          </div>
                          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在整理</p>
                          <p className="text-[12px] text-ink-muted">同桌正在把这节课整理成笔记…</p>
                        </div>
                      ) : lessonDigest ? (
                        <LessonDigestCard
                          digest={lessonDigest}
                          onSeek={(ms) => handleUnifiedSeek(ms)}
                          getImageUrl={(imageId) => {
                            const item = sourceItems.find((s) => s.id === imageId);
                            return item?.previewUrl || item?.attachmentUrl;
                          }}
                          getOriginalTranscript={(startMs, endMs) => {
                            const chunk = segments
                              .filter((s) => s.startMs >= startMs && s.startMs <= endMs)
                              .map((s) => s.text)
                              .join(' ');
                            return chunk || undefined;
                          }}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12">
                          <p className="text-[12px] text-ink-muted mb-3">笔记生成失败</p>
                          <button onClick={() => setMobileDigestView(false)} className="rounded-full bg-paper-warm px-3 py-1.5 text-[11px] font-medium text-ink-secondary">
                            查看转录原文
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                  <DedaoTimeline
                    entries={toDedaoEntries(segments, anchors)}
                    currentTime={currentTime}
                    onEntryClick={(entry) => {
                      handleUnifiedSeek(entry.startMs, true);
                    }}
                    onConfusionClick={(entry) => {
                      const anchor = anchors.find(
                        a => a.timestamp >= entry.startMs && a.timestamp <= entry.endMs
                      );
                      if (anchor) {
                        setSelectedConfusion({
                          id: anchor.id,
                          timestamp: anchor.timestamp,
                          content: anchor.note,
                          resolved: anchor.resolved,
                          context: entry.content,
                        } as ConfusionMarker & { context?: string });
                        handleAnchorSelect(anchor);
                      }
                    }}
                    onEntryTextUpdate={(entry, text) => {
                      handleTranscriptTextUpdate(entry.id, text);
                    }}
                    className="flex-1 min-h-0"
                  />
                  )}

                  <DedaoConfusionCard
                    isOpen={!!selectedConfusion}
                    onClose={() => setSelectedConfusion(null)}
                    confusion={selectedConfusion ? {
                      id: selectedConfusion.id,
                      timestamp: selectedConfusion.timestamp,
                      content: selectedConfusion.content,
                      resolved: selectedConfusion.resolved,
                      context: (selectedConfusion as ConfusionMarker & { context?: string }).context,
                    } : null}
                    onAskAI={(question) => {
                      setSelectedConfusion(null);
                      setShowConversationHistory(false);
                      setSelectedHistoryConversation(null);
                      setMobileAIQuestion(question);
                      setMobileAIDisplayQuestion('');
                      setMobileAILaunchImages([]);
                      setMobileAILaunchSupportContextText('');
                      setMobileAIConsumedQuestionNonce(null);
                      setMobileAIPreferSelectedContext(false);
                      setMobileAIQuestionNonce((prev) => prev + 1);
                      setMobileAILaunchTarget('mobile-ai-chat');
                      setMobileSubPage('ai-chat');
                    }}
                    onResolve={() => {
                      handleResolveAnchor();
                      setSelectedConfusion(null);
                    }}
                    onSeek={(timeMs) => {
                      handleUnifiedSeek(timeMs);
                    }}
                  />

                  {/* 全局 AI 入口 — 点击打开底部 Sheet（不再全屏跳转） */}
                  <MobileAIFab
                    onClick={() => {
                      setSelectedAnchor(null);
                      clearMobileAILaunchState();
                      setMobileReviewSheetOpen(true);
                    }}
                    visible={!selectedConfusion && !mobileReviewSheetOpen}
                    pulse={segments.length > 0 && anchors.length === 0}
                    tooltip="问问这节课"
                  />

                  {/* 底部可拖拽 Sheet（复习态 AI 同桌） */}
                  {mobileReviewSheetOpen && !videoSource && (
                    <MobileReviewSheet
                      visible={mobileReviewSheetOpen}
                      previewText={segments.length > 0 ? '这节课有问题随时问我' : '问我任何事'}
                      avatar={
                        <div className="h-8 w-8 rounded-full bg-pine-mist overflow-hidden">
                          <img src="/images/octo-buddy/happy.png" alt="Octo" className="h-full w-full object-cover" />
                        </div>
                      }
                    >
                      <div className="flex-1 min-h-0 flex flex-col">
                        <SafeAITutor
                          isMobile={true}
                          sessionId={sessionId}
                          lessonTitle={reviewContextTitle}
                          segments={segments}
                          isLoading={false}
                          onResolve={handleResolveAnchor}
                          onSeek={handleUnifiedSeek}
                          breakpoint={selectedBreakpoint}
                          supportContextText={tutorSupportContextText}
                          preferSupportContext={mobileAIPreferSelectedContext}
                          launchQuestion={mobileAIQuestion}
                          launchDisplayText={mobileAIDisplayQuestion}
                          launchImages={mobileAILaunchImages}
                          launchQuestionNonce={mobileAIQuestionNonce}
                          onLaunchQuestionConsumed={() => setMobileAIConsumedQuestionNonce(mobileAIQuestionNonce)}
                          onActionItemsUpdate={(items: ActionItem[]) => captureEditorActions.setActionItems(items)}
                          hideMobileHeader={true}
                        />
                      </div>
                    </MobileReviewSheet>
                  )}
                </>
              )}

              {/* AI 对话 & 实时通话 — 合并为同一实例，避免 ai-chat ↔ ai-call 切换时 React state 丢失 */}
              {(mobileSubPage === 'ai-chat' || mobileSubPage === 'ai-call') && (
                <MobileAIChatPanel
                  showConversationHistory={mobileSubPage === 'ai-call' ? false : showConversationHistory}
                  followsSelectedContext={mobileAIPreferSelectedContext && mobileAILaunchTarget === 'mobile-ai-chat'}
                  onBack={() => {
                    if (mobileSubPage === 'ai-call') {
                      setMobileSubPage('ai-chat');
                      return;
                    }
                    const hasReviewContent = segments.length > 0 && sessionId !== 'demo-session';
                    if (hasReviewContent) {
                      setMobileSubPage(null);
                    } else {
                      setMobileSubPage(null);
                      setViewMode('record');
                    }
                    clearMobileAILaunchState();
                    setShowConversationHistory(false);
                    setSelectedHistoryConversation(null);
                  }}
                  onShowCurrent={() => {
                    setShowConversationHistory(false);
                    setSelectedHistoryConversation(null);
                  }}
                  onShowHistory={() => setShowConversationHistory(true)}
                  onNewConversation={() => {
                    setMobileAINewConversationNonce((prev) => prev + 1);
                    setMobileAIHasActiveConversation(false);
                    clearMobileAILaunchState();
                  }}
                  hasActiveConversation={mobileAIHasActiveConversation}
                  newConversationNonce={mobileAINewConversationNonce}
                  onConversationActiveChange={setMobileAIHasActiveConversation}
                  currentTime={currentTime}
                  duration={totalDuration}
                  isPlaying={isPlaying}
                  markers={anchors.map((anchor) => ({
                    id: anchor.id,
                    timestamp: anchor.timestamp,
                    resolved: anchor.resolved,
                  }))}
                  onPlayerSeek={handleUnifiedSeek}
                  onPlayPause={() => {
                    if (isPlaying) {
                      waveformRef.current?.pause();
                    } else {
                      waveformRef.current?.play();
                    }
                    setIsPlaying(!isPlaying);
                  }}
                  onMarkerClick={(marker: { id: string; timestamp: number; resolved: boolean }) => {
                    const anchor = anchors.find((item) => item.id === marker.id);
                    if (anchor) {
                      setSelectedAnchor(anchor);
                    }
                  }}
                  selectedHistoryConversation={selectedHistoryConversation}
                  onBackToHistoryList={() => setSelectedHistoryConversation(null)}
                  onCloseHistory={() => {
                    setShowConversationHistory(false);
                    setSelectedHistoryConversation(null);
                  }}
                  onSelectHistoryConversation={setSelectedHistoryConversation}
                  sessionId={sessionId}
                  tutorSupportContextText={tutorSupportContextText}
                  tutorBreakpoint={mobileAIPreferSelectedContext && mobileAILaunchTarget === 'mobile-ai-chat' ? null : selectedBreakpoint}
                  segments={segments}
                  onResolve={handleResolveAnchor}
                  onActionItemsUpdate={handleActionItemsUpdate}
                  preferSupportContext={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAIPreferSelectedContext : false}
                  launchQuestion={mobileAILaunchTarget === 'mobile-ai-chat' && mobileAIConsumedQuestionNonce !== mobileAIQuestionNonce ? mobileAIQuestion : ''}
                  launchDisplayText={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAIDisplayQuestion : ''}
                  launchImages={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAILaunchImages : []}
                  launchQuestionNonce={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAIQuestionNonce : 0}
                  onLaunchQuestionConsumed={mobileAILaunchTarget === 'mobile-ai-chat' ? consumeMobileAIQuestion : undefined}
                  onTutorSeek={(timeMs: number) => {
                    handleUnifiedSeek(timeMs, true);
                  }}
                  realtimeTeacherEnabled={mobileSubPage === 'ai-call'}
                  onEnterRealtimeTeacher={() => {
                    setShowConversationHistory(false);
                    setSelectedHistoryConversation(null);
                    setMobileSubPage('ai-call');
                  }}
                  onExitRealtimeTeacher={() => {
                    setMobileSubPage('ai-chat');
                  }}
                />
              )}

              {mobileSubPage === 'apps' && (
                <MobileAppsSubPage
                  title="学习应用"
                  onBack={() => setMobileSubPage(null)}
                >
                  {renderSharedWorkspacePanel('apps')}
                </MobileAppsSubPage>
              )}

              {mobileSubPage === 'tasks' && (
                <MobileSimpleSubPage
                  title="今日任务"
                  onBack={() => setMobileSubPage(null)}
                >
                  <ActionList
                    items={actionItems}
                    onComplete={handleActionComplete}
                    onStartNext={handleStartNextAction}
                  />
                </MobileSimpleSubPage>
              )}

              {/* Right-side drawer menu. */}
              <DedaoMenu
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                onNavigate={(page) => setMobileSubPage(page)}
                showApps={true}
                badges={{
                  apps: segments.length > 0 ? 1 : 0,
                  tasks: actionItems.filter(i => !i.completed).length,
                }}
              />
            </div>
          )}
        </>
      )}

      {workspaceCaptureEditor ? (
        <WorkspaceCaptureEditorModal
          captureActionsDeps={{
            playingAudioMessageId,
            stopAudioMessagePlayback,
            pendingCaptureStatusBySourceKeyRef,
          }}
        />
      ) : null}

      <WorkshopWindowManager
        windows={workshopWindows}
        sessionId={sessionId}
        dataSource={dataSource}
        transcript={segments}
        anchors={anchors}
        summaryOverview={classSummary?.overview}
        keyDifficulties={classSummary?.keyDifficulties}
        terminologyHint={extractedTermsHint || undefined}
        onSeek={(timeMs) => {
          handleUnifiedSeek(timeMs, true);
        }}
        onClose={closeWorkshopWindow}
        onToggleMinimize={toggleWorkshopWindowMinimize}
        onFocus={focusWorkshopWindow}
      />
      
      {/* 随堂检验弹窗 */}
      {classCheck.isCheckActive && classCheck.currentQuestions.length > 0 ? (
        <ClassCheckOverlay
          questions={classCheck.currentQuestions}
          roundIndex={classCheck.currentRoundIndex}
          topic={classCheck.currentTopic}
          greeting={classCheck.currentGreeting}
          encouragement={classCheck.currentEncouragement}
          nextPreview={classCheck.currentNextPreview}
          onComplete={classCheck.handleCheckComplete}
        />
      ) : null}

      {/* 随堂检验邀请 toast（非侵入式，用户可选择参与或忽略） */}
      {!classCheck.isCheckActive && classCheck.pendingCheckpoint ? (
        <ClassCheckToast
          checkpoint={classCheck.pendingCheckpoint}
          onAccept={classCheck.acceptPendingCheckpoint}
          onDismiss={classCheck.dismissPendingCheckpoint}
        />
      ) : null}

      {/* 主要内容区域 */}
      <GlobalAskPanel
        open={showAISearch}
        onClose={closeGlobalAsk}
        initialView={initialGlobalAskView}
        memoryFocus={initialMemoryFocus}
        onNavigateToCapture={(captureId: string) => {
          const item = allCollectionItems.find((c) => c.id === captureId);
          if (item) {
            setShowAISearch(false);
            setMobileCollectionSheet(null);
            void openReviewFromCollectionListItem(item);
          }
        }}
        isMobile={isMobile}
      />

      {/* ── 回声分享卡弹窗 ── */}
      {sharingEcho && (
        <EchoShareCard
          echo={sharingEcho}
          open={Boolean(sharingEcho)}
          onClose={() => setSharingEcho(null)}
        />
      )}
      </div>{/* end 主内容区 wrapper */}
    </div>
  );
}

function SearchParamsReader() {
  const searchParams = useSearchParams();
  const { isMobile, mounted } = useResponsive();
  const isGuestFastEntry = searchParams.get('guest') === '1';
  const forcedWorkspaceTab = searchParams.get('workspace') === 'apps' ? 'apps' : null;
  const initialGlobalAskView = searchParams.get('workspace') === 'context' ? 'memory' : undefined;
  const initialMemoryFocus = searchParams.get('intent') === 'cheatsheet' ? 'cheatsheet' : undefined;
  const initialClaimedCaptureId = searchParams.get('claimedCapture');
  const forceMobilePreview = searchParams.get('mobile') === '1';
  const wechatCaptureToken = searchParams.get('wechat_capture');
  const entryParam = searchParams.get('entry');
  const initialMobileSubPage: MobileSubPage =
    entryParam === 'call'
      ? 'ai-call'
      : entryParam === 'ai' || entryParam === 'chat'
        ? 'ai-chat'
        : null;
  const guestDemoEntry = resolveGuestDemoEntry({
    isGuestFastEntry,
    entry: entryParam,
  });

  // 如果请求了移动端预览，但当前在桌面端或者还未挂载（防止 SSR 闪烁），则渲染外壳
  if (forceMobilePreview && (!mounted || !isMobile)) {
    return (
      <div className="min-h-dvh bg-[#FAF7F2]">
        <div className="flex items-start justify-center px-5 pb-10 pt-6">
          <div className="relative h-[860px] w-[400px] rounded-[44px] border border-divider bg-white p-[10px]">
            <div className="absolute left-1/2 top-[18px] z-20 h-7 w-32 -translate-x-1/2 rounded-full bg-ink" />
            <div className="relative h-full overflow-hidden rounded-[34px] bg-[#f7f3ec]">
              <StudentAppContent
                isGuestFastEntry={isGuestFastEntry}
                forcedWorkspaceTab={forcedWorkspaceTab}
                initialClaimedCaptureId={initialClaimedCaptureId}
                forceMobilePreview
                wechatCaptureToken={wechatCaptureToken}
                initialMobileSubPage={initialMobileSubPage}
                autoLoadDemo={guestDemoEntry.autoLoadDemo}
                autoOpenDemoAppKey={guestDemoEntry.autoOpenAppKey}
                initialGlobalAskView={initialGlobalAskView}
                initialMemoryFocus={initialMemoryFocus}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <StudentAppContent
      isGuestFastEntry={isGuestFastEntry}
      forcedWorkspaceTab={forcedWorkspaceTab}
      initialClaimedCaptureId={initialClaimedCaptureId}
      wechatCaptureToken={wechatCaptureToken}
      initialMobileSubPage={initialMobileSubPage}
      autoLoadDemo={guestDemoEntry.autoLoadDemo}
      autoOpenDemoAppKey={guestDemoEntry.autoOpenAppKey}
      initialGlobalAskView={initialGlobalAskView}
      initialMemoryFocus={initialMemoryFocus}
    />
  );
}

export default function StudentApp() {
  return (
    <Suspense fallback={<AppLoading message="正在加载..." />}>
      <SearchParamsReader />
    </Suspense>
  );
}
