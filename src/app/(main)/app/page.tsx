'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense, type ChangeEvent, type ClipboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useUIActions, useUIStore } from '@/stores/ui-store';
import { usePlayerActions, usePlayerStore } from '@/stores/player-store';
import { useSessionStore } from '@/stores/session-store';
import { Header } from '@/components/Header';
import { ServiceStatus, DegradedModeBanner } from '@/components/ServiceStatus';
import { EchoCard, type EchoData } from '@/components/EchoCard';
import { EchoShareCard } from '@/components/EchoShareCard';
import { anchorService, type Anchor } from '@/lib/services/anchor-service';
import { memoryService, type ClassTimeline } from '@/lib/services/memory-service';
import { checkServices, type ServiceStatus as ServiceStatusType } from '@/lib/services/health-check';
import { getPreference, setPreference, db, generateSessionId, saveAudioSession, addTranscripts, ANONYMOUS_USER_ID } from '@/lib/db';
import {
  APP_STATE_VERSION,
  getPersistedAppState,
  isPersistedAppStateFresh,
  setPersistedAppState,
  type PersistedAppState,
} from '@/lib/services/app-workspace-state';
import { useAuth } from '@/lib/hooks/useAuth';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import { runMemoryMigration } from '@/lib/services/memory-migration';
import { parseVideoLink } from '@/lib/utils/video-link';
import { appendLiveRecordingSegments, resolveLiveRecordingAppendOffset } from '@/lib/capture/live-recording';
import { buildStoredVideoSource, isStoredVideoSession } from '@/lib/capture/video-session';
import {
  buildSelectedCollectionContextText,
  getCollectionContextDisplayTitle,
  getCollectionContextTypeLabel,
  resolveCollectionContextPrimaryId,
} from '@/lib/capture/collection-context';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { useWorkshopWindows } from '@/hooks/useWorkshopWindows';
import {
  detectReachFromText,
  detectReachFromFile,
  isAudioReachFile,
  isDocumentReachFile,
  isImageReachFile,
  isVideoReachFile,
  type ContextReachDetection,
} from '@/lib/context-reach';
import type {
  TranscriptSegment,
  HighlightTopic,
  Note,
  TopicGenerationMode,
  NoteSource,
  NoteMetadata,
  ImportedVideoResult,
  ImportedVideoSource,
} from '@/types';
import type {
  ViewMode,
  DataSource,
  SharedWorkspaceTab,
  WorkspaceTab,
  ReviewTab,
  VideoWorkspaceTab,
  WorkspaceTabConfig,
  ActionItem,
  SourceIngestType,
  SourceIngestRole,
  MobileCollectionSheet,
  SourceIngestItem,
  SupportReferenceItem,
  TutorLaunchImageAsset,
  PendingRecordedAudio,
  CollectionPulseState,
  WechatCaptureMessage,
  WorkspaceCaptureMessage,
  WorkspaceCaptureEditorMode,
  WorkspaceCaptureEditorState,
  WorkspaceEchoMessage,
  DailyEchoRefreshPayload,
  ManualEchoFeedbackTone,
  ManualEchoFeedbackState,
} from '@/types/page-types';
import {
  ACTION_PROGRESS_KEY_PREFIX,
  WORKSHOP_WINDOW_STATE_PREFIX,
  MAX_ACTIVE_WORKSHOP_WINDOWS,
  VIDEO_INSIGHT_COLORS,
  ENABLE_ECHO_MANUAL_TRIGGER,
  compactText,
  compactMultilineText,
  getActionProgressKey,
  getWorkshopWindowStorageKey,
  normalizeWorkshopWindows,
  mapSegmentsForAppend,
  getSegmentBatchDurationMs,
  buildSupportReferenceSnippet,
  mergeSupportReferences,
  getSupportReferenceDisplayTitle,
  mergeWorkspaceEchoes,
  resolveEchoDisplayTime,
  getEchoDebugReasonLabel,
  getEchoQualityWarningLabel,
  buildManualEchoFeedbackFromPayload,
  buildManualEchoErrorFeedback,
  buildManualEchoUnavailableFeedback,
  getManualEchoFeedbackClasses,
  resolveEchoTimeBucket,
  getEchoBucketLabel,
  mergeWorkspaceCaptures,
  resolvePendingAudioFailureStatus,
  resolveSourceFailureStatus,
  getLocalMediaDurationMs,
  formatVoiceDurationCompact,
  getFileExtensionBadge,
  inferWechatCaptureSourceType,
  inferWechatCaptureRole,
  inferWechatCaptureTitle,
  inferWorkspaceCaptureSourceType,
  inferWorkspaceCaptureRole,
  resolveSourceItemSourceKey,
  resolveCaptureSourceFullText,
  buildWorkspaceCaptureSourceItem,
  buildWechatCaptureSourceItem,
  buildCollectionListItemFromSourceItem,
  mergeWechatWorkspaceCapturesIntoSourceItems,
  readJsonApiResponse,
  buildASRContextHint,
  buildTutorSupportContextText,
  buildTutorQuestionFromEcho,
  buildSeedVideoInsights,
  formatTime,
  formatRelativeCollectionTime,
  buildSourcePreviewText,
  normalizeImportedVideoSegments,
  transcribeAudioFile,
  parseDocumentFile,
  parseImageFile,
} from '@/lib/utils/page-utils';
import { useResponsive } from '@/hooks/useResponsive';
import { UIConfig } from '@/lib/config';
import { toast } from 'sonner';

// SWR data hooks for API state management.
import { useTopics, useSummary } from '@/hooks/data';

// WaveformPlayer uses forwardRef and needs static import for ref support.
import { WaveformPlayer, type WaveformPlayerRef, type WaveformAnchor } from '@/components/WaveformPlayer';
import { Recorder, type RecorderHandle } from '@/components/Recorder';

import { AppLoading } from '@/components/AppLoading';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Mic,
  BookOpen,
  Star,
  Sparkles,
  FileText,
  Boxes,
  StickyNote,
  MessageCircle,
  Clock,
  AlertCircle,
  GraduationCap,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Link2,
  History,
  Menu,
  X,
  Image as ImageIcon,
  AudioLines,
  ArrowUp,
  Play,
  Pause,
  ChevronsDown,
  type LucideIcon as LucideIconType,
} from 'lucide-react';

// --- Performance: Dynamic imports for heavy components (code-split) ---
// These components are not needed for initial render and are lazy-loaded
// to drastically reduce the main JS bundle size.
const TimelineView = dynamic(() => import('@/components/TimelineView').then(m => ({ default: m.TimelineView })), { ssr: false });
const ActionList = dynamic(() => import('@/components/ActionList').then(m => ({ default: m.ActionList })), { ssr: false });
const ActionSidebar = dynamic(() => import('@/components/ActionSidebar').then(m => ({ default: m.ActionSidebar })), { ssr: false });
const ActionDrawer = dynamic(() => import('@/components/ActionDrawer').then(m => ({ default: m.ActionDrawer })), { ssr: false });
import { ResizablePanel } from '@/components/layout/ResizablePanel';
const VideoReviewPlayer = dynamic(() => import('@/components/VideoReviewPlayer').then(m => ({ default: m.VideoReviewPlayer })), { ssr: false });
const AITutor = dynamic(() => import('@/components/SafeAITutor').then(m => ({ default: m.SafeAITutor })), { ssr: false });
const TranscriptFlowView = dynamic(() => import('@/components/TranscriptFlowView').then(m => ({ default: m.TranscriptFlowView })), { ssr: false });
const VideoInsightTimeline = dynamic(() => import('@/components/VideoInsightTimeline').then(m => ({ default: m.VideoInsightTimeline })), { ssr: false });

import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
import type { ConfusionMarker } from '@/components/mobile/PodcastPlayer';
import type { ConversationHistory } from '@/types/conversation';
import type { AudioSession } from '@/lib/db';

// Workspace components - dynamic loaded
const HighlightsPanel = dynamic(() => import('@/components/HighlightsPanel').then(m => ({ default: m.HighlightsPanel })), { ssr: false });
const SummaryPanel = dynamic(() => import('@/components/SummaryPanel').then(m => ({ default: m.SummaryPanel })), { ssr: false });
const NotesPanel = dynamic(() => import('@/components/NotesPanel').then(m => ({ default: m.NotesPanel })), { ssr: false });
const AnchorDetailPanel = dynamic(() => import('@/components/AnchorDetailPanel').then(m => ({ default: m.AnchorDetailPanel })), { ssr: false });
const WorkshopYellowPage = dynamic(() => import('@/components/apps/WorkshopYellowPage').then(m => ({ default: m.WorkshopYellowPage })), { ssr: false });
import { type FloatingWorkshopWindowState, getDefaultDisplayMode } from '@/components/apps/windows/WorkshopWindowManager';
const WorkshopWindowManager = dynamic(() => import('@/components/apps/windows/WorkshopWindowManager').then(m => ({ default: m.WorkshopWindowManager })), { ssr: false });
const ConversationList = dynamic(() => import('@/components/ConversationHistory/ConversationList').then(m => ({ default: m.ConversationList })), { ssr: false });
const AIChat = dynamic(() => import('@/components/AIChat').then(m => ({ default: m.AIChat })), { ssr: false });
const WorkspaceCaptureList = dynamic(() => import('@/components/WorkspaceCaptureList').then(m => ({ default: m.WorkspaceCaptureList })), { ssr: false });
const AISearchPanel = dynamic(() => import('@/components/AISearchPanel').then(m => ({ default: m.AISearchPanel })), { ssr: false });
import type { WorkspaceCaptureListItem } from '@/components/WorkspaceCaptureList';
import { isWorkshopAppKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';

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
const MobileTabSwitch = dynamic(() => import('@/components/mobile/MobileTabSwitch').then(m => ({ default: m.MobileTabSwitch })), { ssr: false });
const DedaoTimeline = dynamic(() => import('@/components/mobile/DedaoTimeline').then(m => ({ default: m.DedaoTimeline })), { ssr: false });
import { toDedaoEntries } from '@/components/mobile/DedaoTimeline';
const DedaoConfusionCard = dynamic(() => import('@/components/mobile/DedaoConfusionCard').then(m => ({ default: m.DedaoConfusionCard })), { ssr: false });
const DedaoMenu = dynamic(() => import('@/components/mobile/DedaoMenu').then(m => ({ default: m.DedaoMenu })), { ssr: false });
const DedaoMenuButton = dynamic(() => import('@/components/mobile/DedaoMenu').then(m => ({ default: m.DedaoMenuButton })), { ssr: false });
const MobileAIFab = dynamic(() => import('@/components/mobile/MobileAIFab').then(m => ({ default: m.MobileAIFab })), { ssr: false });

const ICON_TAB = 14;
const ICON_TAB_STROKE = 1.75;

const SHARED_WORKSPACE_TABS: WorkspaceTabConfig<SharedWorkspaceTab>[] = [
  { key: 'highlights', label: '精选', icon: '精', LucideIcon: Star },
  { key: 'summary', label: '摘要', icon: '摘', LucideIcon: FileText },
  { key: 'apps', label: 'AI工坊', icon: '坊', LucideIcon: Boxes, testId: 'review-tab-apps' },
  { key: 'notes', label: '笔记', icon: '记', LucideIcon: StickyNote },
];

const VIDEO_WORKSPACE_TABS: WorkspaceTabConfig<VideoWorkspaceTab>[] = [
  { key: 'chat', label: '对话', icon: '聊', LucideIcon: MessageCircle },
  { key: 'confusion', label: '困惑点', icon: '疑', LucideIcon: AlertCircle },
  ...SHARED_WORKSPACE_TABS,
];

const REVIEW_WORKSPACE_TABS: WorkspaceTabConfig<ReviewTab>[] = [
  { key: 'timeline', label: '时间轴', icon: '轴', LucideIcon: Clock },
  { key: 'anchor-detail', label: '困惑点', icon: '疑', LucideIcon: AlertCircle },
  ...SHARED_WORKSPACE_TABS,
];

function isSharedWorkspaceTab(tab: WorkspaceTab): tab is SharedWorkspaceTab {
  return tab === 'highlights' || tab === 'summary' || tab === 'notes' || tab === 'apps';
}


// ── Types → @/types/page-types · Utils → @/lib/utils/page-utils ──

function _VoiceWaveGlyph({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`}>
      {[10, 15, 20, 14, 9].map((height, index) => (
        <span
          key={`${height}-${index}`}
          className="w-[2.5px] rounded-full bg-current"
          style={{ height: `${height}px` }}
        />
      ))}
    </span>
  );
}

// NOTE: cleaned corrupted legacy comment.
function StudentAppContent({
  isGuestFastEntry,
  forcedWorkspaceTab,
  forceMobilePreview = false,
  wechatCaptureToken = null,
}: {
  isGuestFastEntry: boolean;
  forcedWorkspaceTab: SharedWorkspaceTab | null;
  forceMobilePreview?: boolean;
  wechatCaptureToken?: string | null;
}) {
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
  const isActionDrawerOpen = useUIStore((s) => s.isActionDrawerOpen);
  const showConversationHistory = useUIStore((s) => s.showConversationHistory);
  const showTranscriptBar = useUIStore((s) => s.showTranscriptBar);
  const showAISearch = useUIStore((s) => s.showAISearch);
  const showMobileRecorder = useUIStore((s) => s.showMobileRecorder);
  const mobileCollectionSheet = useUIStore((s) => s.mobileCollectionSheet);

  // Player Store
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const isPlayingAll = usePlayerStore((s) => s.isPlayingAll);
  const playAllIndex = usePlayerStore((s) => s.playAllIndex);

  // Session Store — 会话核心
  const sessionId = useSessionStore((s) => s.sessionId);
  const isRecording = useSessionStore((s) => s.isRecording);
  const dataSource = useSessionStore((s) => s.dataSource);
  const serviceStatus = useSessionStore((s) => s.serviceStatus);
  const sessionMediaDurationMs = useSessionStore((s) => s.sessionMediaDurationMs);
  const videoSeekNonce = useSessionStore((s) => s.videoSeekNonce);
  const videoPlayNonce = useSessionStore((s) => s.videoPlayNonce);
  const selectedAnchor = useSessionStore((s) => s.selectedAnchor);
  const selectedConfusion = useSessionStore((s) => s.selectedConfusion);
  const selectedHistoryConversation = useSessionStore((s) => s.selectedHistoryConversation);

  // Setter aliases — 保持与原 useState setter 相同的函数签名，对下游代码零破坏
  const setShowSplash = uiActions.setShowSplash;
  const setAppReady = uiActions.setAppReady;
  const setLoadingProgress = uiActions.setLoadingProgress;
  const setViewMode = uiActions.setViewMode;
  const setReviewTab = uiActions.setReviewTab;
  const setVideoWorkspaceTab = uiActions.setVideoWorkspaceTab;
  const setMobileSubPage = uiActions.setMobileSubPage;
  const setIsMenuOpen = uiActions.setMenuOpen;
  const setIsActionDrawerOpen = uiActions.setActionDrawerOpen;
  const setShowConversationHistory = uiActions.setShowConversationHistory;
  const setShowTranscriptBar = uiActions.setShowTranscriptBar;
  const setShowAISearch = uiActions.setShowAISearch;
  const setShowMobileRecorder = uiActions.setShowMobileRecorder;
  const setMobileCollectionSheet = uiActions.setMobileCollectionSheet;
  const setIsPlaying = playerActions.setIsPlaying;
  const setCurrentTime = playerActions.setCurrentTime;
  const setIsPlayingAll = playerActions.setIsPlayingAll;
  const setPlayAllIndex = playerActions.setPlayAllIndex;
  const setSessionId = sessionActions.setSessionId;
  const setIsRecording = sessionActions.setIsRecording;
  const setDataSource = sessionActions.setDataSource;
  const setServiceStatus = sessionActions.setServiceStatus;
  const setSessionMediaDurationMs = sessionActions.setSessionMediaDurationMs;
  const setVideoSeekNonce = sessionActions.setVideoSeekNonce;
  const setVideoPlayNonce = sessionActions.setVideoPlayNonce;
  const setSelectedAnchor = sessionActions.setSelectedAnchor;
  const setSelectedConfusion = sessionActions.setSelectedConfusion;
  const setSelectedHistoryConversation = sessionActions.setSelectedHistoryConversation;

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
  
  // NOTE: cleaned corrupted legacy comment.
  const { isMobile: detectedIsMobile, mounted } = useResponsive();
  const isMobile = detectedIsMobile || forceMobilePreview;
  const isDesktopMobilePreview = forceMobilePreview && !detectedIsMobile;
  const [mobileAIQuestion, setMobileAIQuestion] = useState<string>(''); // NOTE: cleaned corrupted legacy comment.
  const [mobileAIDisplayQuestion, setMobileAIDisplayQuestion] = useState<string>('');
  const [mobileAILaunchImages, setMobileAILaunchImages] = useState<TutorLaunchImageAsset[]>([]);
  const [mobileAILaunchSupportContextText, setMobileAILaunchSupportContextText] = useState<string>('');
  const [mobileAIQuestionNonce, setMobileAIQuestionNonce] = useState(0);
  const [mobileAIConsumedQuestionNonce, setMobileAIConsumedQuestionNonce] = useState<number | null>(null);
  const [mobileAIPreferSelectedContext, setMobileAIPreferSelectedContext] = useState(false);
  const [mobileAILaunchTarget, setMobileAILaunchTarget] = useState<'review-panel' | 'video-chat' | 'mobile-ai-chat' | null>(null);
  
  const shouldPrioritizeWechatCaptureEntry = Boolean(wechatCaptureToken);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [timeline, setTimeline] = useState<ClassTimeline | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoSource, setVideoSource] = useState<ImportedVideoSource | null>(null);
  
  // NOTE: cleaned corrupted legacy comment.
  const forcedWorkspaceAppliedRef = useRef(false);
  useEffect(() => {
    if (forcedWorkspaceAppliedRef.current) return;
    if (forcedWorkspaceTab !== 'apps') return;
    setReviewTab('apps');
    setVideoWorkspaceTab('apps');
    forcedWorkspaceAppliedRef.current = true;
  }, [forcedWorkspaceTab, setReviewTab, setVideoWorkspaceTab]);
  const [confusionChatAnchor, setConfusionChatAnchor] = useState<Anchor | null>(null);
  const [videoInsightItems, setVideoInsightItems] = useState<VideoInsightItem[]>([]);
  const [activeVideoInsightId, setActiveVideoInsightId] = useState<string | null>(null);
  // NOTE: cleaned corrupted legacy comment.
  const { 
    topics: highlightTopics, 
    selectedTopic, 
    isLoading: isLoadingTopics, 
    generate: generateTopics,
    regenerateByTheme,
    setSelectedTopic,
    clear: clearTopics
  } = useTopics({ sessionId, segments });
  
  const {
    summary: classSummary,
    isLoading: isLoadingSummary,
    generate: generateSummary,
    clear: clearSummary,
  } = useSummary({ sessionId, segments });
  
  const [notes, setNotes] = useState<Note[]>([]);
  
  // NOTE: cleaned corrupted legacy comment.
  
  // NOTE: cleaned corrupted legacy comment.
  const [collectionComposerText, setCollectionComposerText] = useState('');
  const [showCollectionPulsePreview, setShowCollectionPulsePreview] = useState(false);
  const [captureDrivenPulse, setCaptureDrivenPulse] = useState<CollectionPulseState | null>(null);
  const [workspaceCaptures, setWorkspaceCaptures] = useState<WorkspaceCaptureMessage[]>([]);
  const [workspaceEchoes, setWorkspaceEchoes] = useState<WorkspaceEchoMessage[]>([]);
  const [selectedEchoChip, setSelectedEchoChip] = useState<string>('全部');
  const [isManualEchoRefreshing, setIsManualEchoRefreshing] = useState(false);
  const [manualEchoDebugNote, setManualEchoDebugNote] = useState('');
  const [manualEchoFeedback, setManualEchoFeedback] = useState<ManualEchoFeedbackState | null>(null);
  const [sharingEcho, setSharingEcho] = useState<EchoData | null>(null);
  const collectionComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const collectionScrollRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const collectionScrollNearBottomRef = useRef(true);
  const [sourceFilePickerMode, setSourceFilePickerMode] = useState<'audio' | 'support' | 'all'>('all');
  const [activeSourceImportCount, setActiveSourceImportCount] = useState(0);
  const [sourceImportError, setSourceImportError] = useState('');
  const [playingAudioMessageId, setPlayingAudioMessageId] = useState<string | null>(null);
  const [audioPlaybackState, setAudioPlaybackState] = useState<{
    id: string;
    progress: number;
    currentTime: number;
    duration: number;
  } | null>(null);
  const [expandedAudioTranscriptId, setExpandedAudioTranscriptId] = useState<string | null>(null);
  const [asrContextHint] = useState('');
  const [sourceItems, setSourceItems] = useState<SourceIngestItem[]>([]);
  const [archivedLocalCollectionItems, setArchivedLocalCollectionItems] = useState<SourceIngestItem[]>([]);
  const [supportReferences, setSupportReferences] = useState<SupportReferenceItem[]>([]);
  const [isCollectionContextSelectionMode, setIsCollectionContextSelectionMode] = useState(false);
  const [selectedCollectionContextIds, setSelectedCollectionContextIds] = useState<string[]>([]);
  const [selectedCollectionPrimaryId, setSelectedCollectionPrimaryId] = useState<string | null>(null);
  const [quotedCollectionContextIds, setQuotedCollectionContextIds] = useState<string[]>([]);
  const [quotedCollectionPrimaryId, setQuotedCollectionPrimaryId] = useState<string | null>(null);
  const [confirmSelectedCollectionDelete, setConfirmSelectedCollectionDelete] = useState(false);
  const [activeCollectionMessageMenuId, setActiveCollectionMessageMenuId] = useState<string | null>(null);
  const [confirmCollectionDeleteId, setConfirmCollectionDeleteId] = useState<string | null>(null);
  const [workspaceCaptureEditor, setWorkspaceCaptureEditor] = useState<WorkspaceCaptureEditorState | null>(null);
  const [workspaceCaptureEditorTitle, setWorkspaceCaptureEditorTitle] = useState('');
  const [workspaceCaptureEditorBody, setWorkspaceCaptureEditorBody] = useState('');
  const [isSavingWorkspaceCaptureEdit, setIsSavingWorkspaceCaptureEdit] = useState(false);
  const sourceImporting = activeSourceImportCount > 0;
  const hasCollectionContext = useMemo(
    () => segments.length > 0 || sourceItems.length > 0 || supportReferences.length > 0 || workspaceEchoes.length > 0,
    [segments.length, sourceItems.length, supportReferences.length, workspaceEchoes.length]
  );
  
  // NOTE: cleaned corrupted legacy comment.
  const {
    workshopWindows,
    openWorkshopWindow,
    closeWorkshopWindow,
    toggleWorkshopWindowMinimize,
    focusWorkshopWindow,
  } = useWorkshopWindows({ mounted, sessionId });
  
  // NOTE: cleaned corrupted legacy comment.
  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const lastCollectionPulseSignatureRef = useRef('');
  const suppressNextCollectionPulsePreviewRef = useRef(false);
  const importedWechatCaptureTokensRef = useRef(new Set<string>());
  const workspaceContextRequestKeyRef = useRef<string | null>(null);
  const autoEchoRefreshPromiseRef = useRef<Promise<DailyEchoRefreshPayload | null> | null>(null);

  // Auto-extract terms from user-provided context (course topic + reference materials)
  const [extractedTermsHint, setExtractedTermsHint] = useState('');
  const extractTermsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce: wait 2s after last change before calling the API
    if (extractTermsTimerRef.current) {
      clearTimeout(extractTermsTimerRef.current);
    }

    if (isGuestFastEntry) {
      setExtractedTermsHint('');
      return;
    }

    const topic = asrContextHint.trim();
    const refs = supportReferences.map((item) => item.snippet).filter(Boolean);

    // Only call if there's something to extract from
    if (!topic && refs.length === 0) {
      setExtractedTermsHint('');
      return;
    }

    extractTermsTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch('/api/extract-terms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            referenceTexts: refs.slice(0, 3),
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.contextHint) {
            setExtractedTermsHint(data.contextHint);
          }
        }
      } catch (err) {
        console.warn('[App] Failed to extract terms:', err);
      }
    }, 2000);

    return () => {
      if (extractTermsTimerRef.current) {
        clearTimeout(extractTermsTimerRef.current);
      }
    };
  }, [asrContextHint, isGuestFastEntry, supportReferences]);

  // Build live context hint for real-time ASR (hot-word injection)
  // Combines: user manual hint + reference snippets + auto-extracted terms
  const liveASRContextHint = useMemo(() => {
    const baseHint = buildASRContextHint({
      manualHint: asrContextHint,
      recentSegments: [],
      importedReferences: supportReferences.map((item) => item.snippet),
      maxChars: 2000,
    });
    if (!extractedTermsHint) return baseHint;
    return [baseHint, extractedTermsHint].filter(Boolean).join('\n\n').slice(0, 3000);
  }, [asrContextHint, supportReferences, extractedTermsHint]);
  const anchorsRef = useRef<Anchor[]>([]);
  const sessionIdRef = useRef<string>(sessionId);
  const sourceItemsRef = useRef<SourceIngestItem[]>([]);
  const supportReferencesRef = useRef<SupportReferenceItem[]>([]);
  const pendingCaptureStatusBySourceKeyRef = useRef<Map<string, 'archive' | 'delete'>>(new Map());
  const collectionLongPressTimerRef = useRef<number | null>(null);
  const collectionLongPressTriggeredRef = useRef(false);
  const previewObjectUrlsRef = useRef<string[]>([]);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<WaveformPlayerRef>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const pendingRecordedAudiosRef = useRef<Map<string, PendingRecordedAudio>>(new Map());
  const [recorderAutoStartSignal, setRecorderAutoStartSignal] = useState(0);
  const hasRestoredState = useRef(false);  // NOTE: cleaned corrupted legacy comment.
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    anchorsRef.current = anchors;
  }, [anchors]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const resolvePendingRecordedAudio = useCallback((recordingId?: string) => {
    if (recordingId && pendingRecordedAudiosRef.current.has(recordingId)) {
      return pendingRecordedAudiosRef.current.get(recordingId) || null;
    }

    if (pendingRecordedAudiosRef.current.size === 1) {
      return Array.from(pendingRecordedAudiosRef.current.values())[0] || null;
    }

    return null;
  }, []);

  const clearPendingRecordedAudio = useCallback((recordingId?: string) => {
    if (recordingId && pendingRecordedAudiosRef.current.has(recordingId)) {
      pendingRecordedAudiosRef.current.delete(recordingId);
      return;
    }

    if (pendingRecordedAudiosRef.current.size === 1) {
      const onlyKey = pendingRecordedAudiosRef.current.keys().next().value;
      if (onlyKey) {
        pendingRecordedAudiosRef.current.delete(onlyKey);
      }
    }
  }, []);

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

  const stopAudioMessagePlayback = useCallback(() => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current.src = '';
      audioPlaybackRef.current = null;
    }
    setPlayingAudioMessageId(null);
    setAudioPlaybackState(null);
  }, []);

  useEffect(() => {
    return () => {
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause();
        audioPlaybackRef.current.src = '';
        audioPlaybackRef.current = null;
      }
    };
  }, []);

  const toggleAudioMessagePlayback = useCallback(async (item: SourceIngestItem) => {
    if (!item.mediaUrl) return;

    if (playingAudioMessageId === item.id && audioPlaybackRef.current) {
      if (audioPlaybackRef.current.paused) {
        try {
          await audioPlaybackRef.current.play();
          setPlayingAudioMessageId(item.id);
        } catch (error) {
          console.error('[audio.playback.resume]', error);
        }
      } else {
        audioPlaybackRef.current.pause();
        setPlayingAudioMessageId(null);
      }
      return;
    }

    stopAudioMessagePlayback();

    try {
      const audio = new Audio(item.mediaUrl);
      audioPlaybackRef.current = audio;

      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (duration > 0) {
          const durationMs = Math.round(duration * 1000);
          if (!item.durationMs || Math.abs(item.durationMs - durationMs) > 400) {
            setSourceItems((prev) =>
              prev.map((currentItem) =>
                currentItem.id === item.id ? { ...currentItem, durationMs } : currentItem
              )
            );
          }
        }
        setAudioPlaybackState({
          id: item.id,
          progress: 0,
          currentTime: 0,
          duration,
        });
      };

      audio.ontimeupdate = () => {
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : item.durationMs ? item.durationMs / 1000 : 0;
        const currentTime = audio.currentTime || 0;
        setAudioPlaybackState({
          id: item.id,
          progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
          currentTime,
          duration,
        });
      };

      audio.onended = () => {
        setPlayingAudioMessageId(null);
        setAudioPlaybackState((prev) =>
          prev?.id === item.id
            ? {
                ...prev,
                progress: 0,
                currentTime: 0,
              }
            : prev
        );
      };

      await audio.play();
      setPlayingAudioMessageId(item.id);
    } catch (error) {
      console.error('[audio.playback.start]', error);
      stopAudioMessagePlayback();
      toast.error('这段原声暂时无法播放，请稍后再试。');
    }
  }, [playingAudioMessageId, stopAudioMessagePlayback]);


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

  const normalizeSeekTime = useCallback((timeMs: number | string): number | null => {
    let numeric: number | null = null;

    if (typeof timeMs === 'string') {
      const trimmed = timeMs.trim();
      const clockMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (clockMatch) {
        const hourPart = clockMatch[3] ? Number(clockMatch[1]) : 0;
        const minutePart = clockMatch[3] ? Number(clockMatch[2]) : Number(clockMatch[1]);
        const secondPart = clockMatch[3] ? Number(clockMatch[3]) : Number(clockMatch[2]);
        if ([hourPart, minutePart, secondPart].every((value) => Number.isFinite(value) && value >= 0)) {
          numeric = ((hourPart * 60 + minutePart) * 60 + secondPart) * 1000;
        }
      } else {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) {
          numeric = parsed;
        }
      }
    } else {
      const parsed = Number(timeMs);
      if (Number.isFinite(parsed)) {
        numeric = parsed;
      }
    }

    if (numeric === null) return null;

    const totalMs = segments.length > 0 ? segments[segments.length - 1].endMs : 0;
    let next = numeric;

    // NOTE: cleaned corrupted legacy comment.
    if (next > 0 && next < 1000 && totalMs >= 30000) {
      next *= 1000;
    }

    next = Math.max(0, Math.floor(next));

    if (totalMs > 0) {
      next = Math.min(next, totalMs);
    }

    return next;
  }, [segments]);

  const handleVideoSeek = useCallback((timeMs: number, autoPlay: boolean = false) => {
    const safeTime = normalizeSeekTime(timeMs);
    if (safeTime === null) {
      console.warn('[VideoSeek] Invalid seek time:', timeMs);
      return;
    }
    setCurrentTime(safeTime);
    sessionActions.incrementVideoSeekNonce();
    if (autoPlay) {
      sessionActions.incrementVideoPlayNonce();
    }
  }, [normalizeSeekTime]);

  const handleUnifiedSeek = useCallback((timeMs: number, autoPlay: boolean = false) => {
    const safeTime = normalizeSeekTime(timeMs);
    if (safeTime === null) {
      console.warn('[UnifiedSeek] Invalid seek time:', timeMs);
      return;
    }
    if (videoSource) {
      handleVideoSeek(safeTime, autoPlay);
      return;
    }
    setCurrentTime(safeTime);
    waveformRef.current?.seekTo(safeTime);
    if (autoPlay) {
      waveformRef.current?.play();
      setIsPlaying(true);
    }
  }, [handleVideoSeek, normalizeSeekTime, videoSource]);

  useEffect(() => {
    if (!videoSource) {
      setVideoSeekNonce(0);
      setVideoPlayNonce(0);
    }
  }, [videoSource]);

  // NOTE: cleaned corrupted legacy comment.
  useEffect(() => {
    if (!isRecording) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isRecording]);

  // NOTE: cleaned corrupted legacy comment.
  const studentId = user?.id || 'anonymous';
  const studentName = user?.nickname || user?.username || '匿名用户';

  const persistedCurrentTime = Math.max(0, Math.floor(currentTime / 5000) * 5000);

  // Persist workspace state to IndexedDB for refresh restore.
  const saveAppState = useCallback(async () => {
    if (!hasRestoredState.current) return;

    const snapshot: PersistedAppState = {
      version: APP_STATE_VERSION,
      savedAt: Date.now(),
      viewMode,
      sessionId,
      dataSource,
      reviewTab,
      videoWorkspaceTab,
      selectedAnchorId: selectedAnchor?.id,
      currentTime: persistedCurrentTime,
      showTranscriptBar,
    };

    try {
      await setPersistedAppState(snapshot);
    } catch (err) {
      console.error('Failed to save app state:', err);
    }
  }, [
    dataSource,
    persistedCurrentTime,
    reviewTab,
    selectedAnchor?.id,
    sessionId,
    showTranscriptBar,
    videoWorkspaceTab,
    viewMode,
  ]);

  // Persist key workspace state when dependencies change.
  useEffect(() => {
    if (!appReady) return;
    void saveAppState();
  }, [appReady, saveAppState]);

  const restoreReviewSession = useCallback(async (
    targetSessionId: string,
    options?: {
      selectedAnchorId?: string | null;
      currentTime?: number;
      reviewTab?: ReviewTab | null;
      videoWorkspaceTab?: VideoWorkspaceTab | null;
      showTranscriptBar?: boolean;
    }
  ): Promise<boolean> => {
    const session = await db.audioSessions
      .where('sessionId')
      .equals(targetSessionId)
      .first();
    if (!session) return false;

    const transcripts = await db.transcripts
      .where('sessionId')
      .equals(targetSessionId)
      .toArray();
    if (!transcripts.length) return false;

    const sortedTranscripts = transcripts.sort((a, b) => a.startMs - b.startMs);
    const loadedSegments: TranscriptSegment[] = sortedTranscripts.map((item, index) => ({
      id: `loaded-${item.startMs}-${index}`,
      text: item.text,
      startMs: item.startMs,
      endMs: item.endMs,
      confidence: item.confidence,
      isFinal: item.isFinal,
    }));

    const loadedAnchors = await db.anchors
      .where('sessionId')
      .equals(targetSessionId)
      .toArray();
    const anchorsWithResolved: Anchor[] = loadedAnchors.map((anchor) => ({
      id: anchor.id?.toString() || '',
      sessionId: anchor.sessionId,
      studentId: '',
      timestamp: anchor.timestamp,
      type: anchor.type,
      resolved: anchor.status === 'resolved',
      cancelled: false,
      note: anchor.note,
      aiExplanation: anchor.aiExplanation,
      createdAt: anchor.createdAt.toISOString(),
    }));

    setSessionId(targetSessionId);
    setViewMode('review');
    setSegments(loadedSegments);
    setAnchors(anchorsWithResolved);
    setSelectedAnchor(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setActionItems([]);
    clearTopics();
    clearSummary();
    setNotes([]);
    liveSegmentsRef.current = loadedSegments;
    setSessionMediaDurationMs(session.duration || 0);

    const isVideoSession = isStoredVideoSession(session);
    if (isVideoSession) {
      let playableUrl = '';
      if (session.blob) {
        playableUrl = URL.createObjectURL(session.blob);
        previewObjectUrlsRef.current.push(playableUrl);
      } else if (session.mediaUrl) {
        playableUrl = session.mediaUrl;
      }
      const restoredSource = buildStoredVideoSource(session, { playableUrl });
      if (!restoredSource) {
        return false;
      }
      setVideoSource(restoredSource);
      setDataSource('video');
      setVideoWorkspaceTab(options?.videoWorkspaceTab || 'chat');
      setShowTranscriptBar(Boolean(options?.showTranscriptBar));
      setVideoSeekNonce(0);
      setVideoPlayNonce(0);
      const seededInsights = buildSeedVideoInsights(loadedSegments);
      setVideoInsightItems(seededInsights);
      setActiveVideoInsightId(seededInsights[0]?.id || null);
      setAudioBlob(null);
      setAudioUrl(null);
      setReviewTab(options?.reviewTab || 'timeline');
    } else {
      setVideoSource(null);
      setDataSource('live');
      setVideoWorkspaceTab('chat');
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setShowTranscriptBar(false);
      setVideoSeekNonce(0);
      setVideoPlayNonce(0);
      setReviewTab(options?.reviewTab || 'timeline');
      if (session.blob) {
        setAudioBlob(session.blob);
        setAudioUrl(null);
      } else if (session.mediaUrl) {
        setAudioBlob(null);
        setAudioUrl(session.mediaUrl);
      } else {
        setAudioBlob(null);
        setAudioUrl(null);
      }
    }

    const restoredAnchor = options?.selectedAnchorId
      ? anchorsWithResolved.find((anchor) => anchor.id === options.selectedAnchorId)
      : null;
    if (restoredAnchor) {
      setSelectedAnchor(restoredAnchor);
      setCurrentTime(restoredAnchor.timestamp);
      if (!isVideoSession) {
        setReviewTab('anchor-detail');
      }
    } else if (typeof options?.currentTime === 'number' && Number.isFinite(options.currentTime)) {
      setCurrentTime(Math.max(0, Math.floor(options.currentTime)));
    } else {
      setCurrentTime(0);
    }

    const sessionDate = session.createdAt instanceof Date
      ? session.createdAt
      : new Date(session.createdAt);
    const timelineData = memoryService.buildTimeline(
      targetSessionId,
      loadedSegments,
      anchorsWithResolved,
      {
        subject: session.subject || UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: sessionDate.toISOString().split('T')[0],
      }
    );
    setTimeline(timelineData);
    memoryService.save(timelineData);

    return true;
  }, [clearSummary, clearTopics]);

  const restoreReviewFromCollectionFallback = useCallback(async (
    item: SourceIngestItem
  ): Promise<boolean> => {
    if (!item.sessionId) return false;

    const transcripts = await db.transcripts
      .where('sessionId')
      .equals(item.sessionId)
      .toArray();
    if (!transcripts.length) return false;

    const sortedTranscripts = transcripts.sort((a, b) => a.startMs - b.startMs);
    const loadedSegments: TranscriptSegment[] = sortedTranscripts.map((entry, index) => ({
      id: `fallback-${entry.startMs}-${index}`,
      text: entry.text,
      startMs: entry.startMs,
      endMs: entry.endMs,
      confidence: entry.confidence,
      isFinal: entry.isFinal,
    }));

    const loadedAnchors = await db.anchors.where('sessionId').equals(item.sessionId).toArray();
    const anchorsWithResolved: Anchor[] = loadedAnchors.map((anchor) => ({
      id: anchor.id?.toString() || '',
      sessionId: anchor.sessionId,
      studentId: '',
      timestamp: anchor.timestamp,
      type: anchor.type,
      resolved: anchor.status === 'resolved',
      cancelled: false,
      note: anchor.note,
      aiExplanation: anchor.aiExplanation,
      createdAt: anchor.createdAt.toISOString(),
    }));

    setSessionId(item.sessionId);
    sessionIdRef.current = item.sessionId;
    setViewMode('review');
    setSegments(loadedSegments);
    segmentsRef.current = loadedSegments;
    liveSegmentsRef.current = loadedSegments;
    setAnchors(anchorsWithResolved);
    setSelectedAnchor(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setActionItems([]);
    clearTopics();
    clearSummary();
    setNotes([]);
    setCurrentTime(0);

    const inferredDuration = Math.max(
      item.durationMs || 0,
      loadedSegments[loadedSegments.length - 1]?.endMs || 0
    );
    setSessionMediaDurationMs(inferredDuration);

    if (item.type === 'video') {
      const detected = item.attachmentUrl ? parseVideoLink(item.attachmentUrl) : null;
      const restoredSource: ImportedVideoSource = {
        provider: detected?.provider || 'generic',
        providerLabel: detected?.providerLabel || 'Web Video',
        originalUrl: item.attachmentUrl || item.mediaUrl || '',
        embedUrl: detected?.embedUrl,
        playableUrl: item.mediaUrl || item.attachmentUrl || undefined,
        thumbnailUrl: item.previewUrl,
        title: item.title,
        durationSec: inferredDuration > 0 ? inferredDuration / 1000 : undefined,
      };
      setVideoSource(restoredSource);
      setDataSource('video');
      setVideoWorkspaceTab('chat');
      setVideoInsightItems(buildSeedVideoInsights(loadedSegments));
      setActiveVideoInsightId(buildSeedVideoInsights(loadedSegments)[0]?.id || null);
      setAudioBlob(null);
      setAudioUrl(null);
    } else {
      setVideoSource(null);
      setDataSource('live');
      setVideoWorkspaceTab('chat');
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setAudioBlob(null);
      setAudioUrl(item.mediaUrl || null);
    }

    setReviewTab('timeline');
    setShowTranscriptBar(false);
    setVideoSeekNonce(0);
    setVideoPlayNonce(0);

    const fallbackTimeline = memoryService.buildTimeline(
      item.sessionId,
      loadedSegments,
      anchorsWithResolved,
      {
        subject: UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: new Date().toISOString().split('T')[0],
      }
    );
    setTimeline(fallbackTimeline);
    memoryService.save(fallbackTimeline);

    return true;
  }, [clearSummary, clearTopics]);

  /**
   * 从服务端写入的 transcriptSegments 恢复复习态。
   * 用于视频链接由 triggerVideoImportPipeline 完成转录但前端 IndexedDB 中无数据的场景。
   * 流程：读取 SourceIngestItem.serverTranscriptSegments → 构建 segments → 写入 IndexedDB → 进入 review 模式。
   */
  const restoreFromServerTranscript = useCallback(async (
    item: SourceIngestItem
  ): Promise<boolean> => {
    const rawSegments = item.serverTranscriptSegments;
    if (!rawSegments || rawSegments.length === 0) return false;

    // 使用已有 sessionId 或生成一个
    const targetSessionId = item.sessionId || `video-server-${item.id}-${Date.now()}`;
    const currentUserId = user?.id || ANONYMOUS_USER_ID;

    // 构建 TranscriptSegment 数组
    const loadedSegments: TranscriptSegment[] = rawSegments.map((seg, index) => ({
      id: seg.id || `server-${seg.startMs ?? 0}-${index}`,
      text: seg.text || '',
      startMs: seg.startMs ?? 0,
      endMs: seg.endMs ?? (seg.startMs ?? 0) + 3000,
      confidence: 1,
      isFinal: true,
    }));

    // 设置 session 状态
    setSessionId(targetSessionId);
    sessionIdRef.current = targetSessionId;
    setViewMode('review');
    setSegments(loadedSegments);
    segmentsRef.current = loadedSegments;
    liveSegmentsRef.current = loadedSegments;
    setAnchors([]);
    setSelectedAnchor(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setActionItems([]);
    clearTopics();
    clearSummary();
    setNotes([]);
    setCurrentTime(0);

    const inferredDuration = Math.max(
      item.durationMs || 0,
      loadedSegments[loadedSegments.length - 1]?.endMs || 0
    );
    setSessionMediaDurationMs(inferredDuration);

    // 设置视频源
    if (item.type === 'video') {
      const detected = item.attachmentUrl ? parseVideoLink(item.attachmentUrl) : null;
      const restoredSource: ImportedVideoSource = {
        provider: detected?.provider || item.videoProvider || 'generic',
        providerLabel: detected?.providerLabel || 'Web Video',
        originalUrl: item.attachmentUrl || item.mediaUrl || '',
        embedUrl: item.embedUrl || detected?.embedUrl,
        playableUrl: item.mediaUrl || item.attachmentUrl || undefined,
        thumbnailUrl: item.previewUrl,
        title: item.title,
        durationSec: inferredDuration > 0 ? inferredDuration / 1000 : undefined,
      };
      setVideoSource(restoredSource);
      setDataSource('video');
      setVideoWorkspaceTab('chat');
      const seededInsights = buildSeedVideoInsights(loadedSegments);
      setVideoInsightItems(seededInsights);
      setActiveVideoInsightId(seededInsights[0]?.id || null);
      setAudioBlob(null);
      setAudioUrl(null);
    } else {
      setVideoSource(null);
      setDataSource('live');
      setVideoWorkspaceTab('chat');
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setAudioBlob(null);
      setAudioUrl(item.mediaUrl || null);
    }

    setReviewTab('timeline');
    setShowTranscriptBar(false);
    setVideoSeekNonce(0);
    setVideoPlayNonce(0);

    // 构建 timeline
    const timelineData = memoryService.buildTimeline(
      targetSessionId,
      loadedSegments,
      [],
      {
        subject: UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: new Date().toISOString().split('T')[0],
      }
    );
    setTimeline(timelineData);
    memoryService.save(timelineData);

    // 异步写入 IndexedDB，供后续恢复
    try {
      await db.transcripts.bulkAdd(
        loadedSegments.map((seg) => ({
          sessionId: targetSessionId,
          userId: currentUserId,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1,
          isFinal: true,
        }))
      );
      await saveAudioSession(null, targetSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: item.title || '视频复习',
        duration: inferredDuration,
        sourceType: 'video-link',
        videoUrl: item.attachmentUrl || item.mediaUrl || '',
        videoEmbedUrl: item.embedUrl,
        videoProvider: item.videoProvider,
        thumbnailUrl: item.previewUrl,
      });
    } catch (dbError) {
      console.error('[restoreFromServerTranscript] IndexedDB 写入失败:', dbError);
    }

    // 同步更新 sourceItem 的 sessionId（如果之前是 undefined）
    if (!item.sessionId) {
      updateSourceItem(item.id, { sessionId: targetSessionId });
    }

    return true;
  }, [clearSummary, clearTopics, user?.id]);

  // NOTE: cleaned corrupted legacy comment.
  // Optimize init path via parallel loading and batched reads.
  // Performance: Guest fast-entry skips splash and marks app ready immediately;
  // background init runs without blocking UI.
  useEffect(() => {
    if (hasRestoredState.current) return;

    // Guest fast-entry: mark ready immediately, run init in background
    if (isGuestFastEntry) {
      hasRestoredState.current = true;
      // Background init: non-blocking service checks & data loads
      requestAnimationFrame(() => {
        checkServices().then(setServiceStatus).catch(() => {});
      });
      return;
    }

    const initializeApp = async () => {
     try {
      const baseProgress = 10;
      setLoadingProgress(baseProgress);

      const [, rawSavedAppState] = await Promise.all([
        checkServices().then(setServiceStatus),
        getPersistedAppState(),
      ]);

      setLoadingProgress(40);

      const normalizedSavedState = rawSavedAppState && typeof rawSavedAppState === 'object'
        ? rawSavedAppState
        : null;
      const hasFreshState = isPersistedAppStateFresh(normalizedSavedState);
      const savedAppState = hasFreshState ? normalizedSavedState : null;

      setLoadingProgress(50);

      // 启动时总是从收集页（record 模式）开始。
      // 用户需要主动点击"去复习"才进入 review 模式，避免"莫名其妙进入时间轴"。
      // 保留 savedAppState 中的复习数据（sessionId 等），供用户主动点击"去复习"时恢复
      if (savedAppState?.sessionId) {
        setSessionId(savedAppState.sessionId);
      }

      // 启动总是进入收集页（record 模式）
      setViewMode('record');
      setSelectedAnchor(null);
      if (!savedAppState) {
        setDataSource('live');
        setVideoSource(null);
        setVideoInsightItems([]);
        setActiveVideoInsightId(null);
        setVideoWorkspaceTab('chat');
        setShowTranscriptBar(false);
      } else if (savedAppState.dataSource !== 'video') {
        setVideoSource(null);
        setVideoInsightItems([]);
        setActiveVideoInsightId(null);
        setShowTranscriptBar(false);
        setVideoWorkspaceTab(savedAppState.videoWorkspaceTab || 'chat');
      }
      if (typeof savedAppState?.currentTime === 'number' && Number.isFinite(savedAppState.currentTime)) {
        setCurrentTime(Math.max(0, Math.floor(savedAppState.currentTime)));
      }
      setLoadingProgress(85);

      setLoadingProgress(100);
      setAppReady(true);
      hasRestoredState.current = true;
     } catch (err) {
      console.error('[initializeApp] Fatal error during init:', err);
      // 即使初始化出错，也允许用户进入应用，避免长时间卡在加载态。
      setLoadingProgress(100);
      setAppReady(true);
      hasRestoredState.current = true;
      setSourceImportError('刚刚没完全打开，稍后再试一次。');
     }
    };

    initializeApp();
  }, [forceMobilePreview, isGuestFastEntry]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // NOTE: cleaned corrupted legacy comment.
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const refreshDailyEcho = useCallback(async (options?: { force?: boolean }) => {
    const force = Boolean(options?.force);
    if (!isAuthenticated || !user?.id || !accessToken) {
      if (force) {
        const feedback = buildManualEchoUnavailableFeedback({
          isGuestFastEntry,
          isCheckingAuth,
        });
        setManualEchoFeedback(feedback);
        setManualEchoDebugNote(
          isGuestFastEntry ? '游客模式下不会发起回声请求' : isCheckingAuth ? '正在确认登录状态' : '当前未登录'
        );
        if (!isCheckingAuth) {
          toast.message(feedback.title);
        }
      }
      return null;
    }

    if (!force && autoEchoRefreshPromiseRef.current) {
      return autoEchoRefreshPromiseRef.current;
    }

    const requestPromise = (async (): Promise<DailyEchoRefreshPayload | null> => {
      if (force) {
        setIsManualEchoRefreshing(true);
        setManualEchoDebugNote('');
        setManualEchoFeedback({
          tone: 'pending',
          title: '正在生成今日回声',
          body: '测试请求已发出，你可以继续收集。',
        });
      }

      try {
        const response = await fetch('/api/workspace/echoes/daily-refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            force,
          }),
        });

        const payload = await readJsonApiResponse<DailyEchoRefreshPayload>(
          response,
          force ? '手动生成回声失败' : '刷新今日回声失败'
        );

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || payload.reason || (force ? '手动生成回声失败' : '刷新今日回声失败'));
        }

        if (payload.echo) {
          setWorkspaceEchoes((prev) => mergeWorkspaceEchoes(prev, [payload.echo!]));
        }

        if (force) {
          setManualEchoFeedback(buildManualEchoFeedbackFromPayload(payload));
          const debug = payload.debug;
          const note = debug
            ? [
                debug.model ? `模型：${debug.model}` : '',
                debug.promptVersion ? `Prompt：${debug.promptVersion}` : '',
                typeof debug.todayCaptureCount === 'number' ? `今天线索：${debug.todayCaptureCount}` : '',
                typeof debug.recentCaptureCount === 'number' ? `补充上下文：${debug.recentCaptureCount}` : '',
                typeof debug.similarityToRecent === 'number' ? `重复度：${debug.similarityToRecent.toFixed(2)}` : '',
                payload.reason && !payload.skipped ? `质量提醒：${getEchoQualityWarningLabel(payload.reason)}` : '',
              ].filter(Boolean).join(' · ')
          : '';
          setManualEchoDebugNote(note || (payload.skipped ? `本次未更新：${getEchoDebugReasonLabel(payload.reason)}` : '回声已刷新'));
          if (payload.echo && !payload.skipped) {
            toast.success('回声已刷新');
          }
        }

        return payload;
      } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (force) {
        setManualEchoFeedback(buildManualEchoErrorFeedback(message));
        setManualEchoDebugNote(message);
        toast.error(message);
      } else {
          console.error('[workspace.echo]', message);
        }
        return null;
      } finally {
        if (force) {
          setIsManualEchoRefreshing(false);
        }
      }
    })();

    if (!force) {
      autoEchoRefreshPromiseRef.current = requestPromise;
    }

    try {
      return await requestPromise;
    } finally {
      if (!force && autoEchoRefreshPromiseRef.current === requestPromise) {
        autoEchoRefreshPromiseRef.current = null;
      }
    }
  }, [accessToken, isAuthenticated, isCheckingAuth, isGuestFastEntry, user?.id]);

  const persistCaptureToWorkspace = useCallback(async (params: {
    sourceType: string;
    sourceKey: string;
    role: string;
    contentType: string;
    title: string;
    previewText?: string;
    normalizedText?: string;
    sourceUrl?: string;
    mediaUrl?: string;
    tutorContext?: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  }) => {
    if (!isAuthenticated || !user?.id || !accessToken) return;

    try {
      const response = await fetch('/api/workspace/captures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(params),
      });

      const payload = await readJsonApiResponse<{
        success: boolean;
        capture?: WorkspaceCaptureMessage;
        echoQueued?: boolean;
        echoPending?: boolean;
        echoAlreadyGeneratedToday?: boolean;
        error?: string;
      }>(response, '写入工作区收集失败');

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '写入工作区收集失败');
      }

      if (payload.capture) {
        const capture = payload.capture;
        const pendingStatusAction = pendingCaptureStatusBySourceKeyRef.current.get(capture.sourceKey);
        if (pendingStatusAction) {
          pendingCaptureStatusBySourceKeyRef.current.delete(capture.sourceKey);
          void fetch('/api/workspace/captures', {
            method: pendingStatusAction === 'delete' ? 'DELETE' : 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(
              pendingStatusAction === 'delete'
                ? { captureId: capture.id, sourceKey: capture.sourceKey }
                : { captureId: capture.id, sourceKey: capture.sourceKey, action: 'archive' }
            ),
          }).catch((error) => {
            console.error('[workspace.capture.pending-status]', error);
          });
        } else {
          setWorkspaceCaptures((prev) => mergeWorkspaceCaptures(prev, [capture]));
        }
      }

      if (payload.echoQueued || payload.echoAlreadyGeneratedToday) {
        void refreshDailyEcho();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[workspace.capture]', message);
    }
  }, [accessToken, isAuthenticated, refreshDailyEcho, user?.id]);

  const handleRecordingStart = useCallback((newSessionId: string) => {
    const hasExistingCollectionContext =
      segmentsRef.current.length > 0 ||
      sourceItemsRef.current.length > 0 ||
      supportReferencesRef.current.length > 0;
    const isContinuingCurrentSession =
      newSessionId === sessionIdRef.current && hasExistingCollectionContext;

    // NOTE: cleaned corrupted legacy comment.
    setSessionId(newSessionId);
    setIsRecording(true);
    setShowMobileRecorder(true);
    setMobileCollectionSheet(null);
    setSourceImportError('');
    setDataSource('live');
    if (!isContinuingCurrentSession && !hasExistingCollectionContext) {
    setSegments([]);
    setAnchors([]);
    setSelectedAnchor(null); // 清空当前选中的困惑点
    clearTopics(); // NOTE: cleaned corrupted legacy comment.
    clearSummary(); // NOTE: cleaned corrupted legacy comment.
    setNotes([]); // 清空当前课堂笔记
    setActionItems([]); // 清空待办任务
    setTimeline(null); // NOTE: cleaned corrupted legacy comment.
    setDataSource('live');
    setAudioUrl(null); // 清空当前音频链接
    setAudioBlob(null); // 清空当前音频数据
    setSessionMediaDurationMs(0);
    setVideoSource(null);
    setVideoInsightItems([]);
    setActiveVideoInsightId(null);
    setSourceItems([]);
    setSourceImportError('');
    setSourceFilePickerMode('all');
    setSupportReferences([]);
    liveSegmentsRef.current = [];
    anchorService.clear(newSessionId);
    }
    // NOTE: cleaned corrupted legacy comment.
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    
    // 同步保存当前会话，方便后续继续补充和回看。
    classroomDataService.saveSession({
      id: newSessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      status: 'recording',
      duration: 0,
      createdBy: studentId,
    });
  }, [studentId, clearTopics, clearSummary]);

  const handleRecordingStop = useCallback((blob?: Blob, meta?: { recordingId?: string; sessionId?: string; isContinuation?: boolean; durationMs?: number }) => {
    setIsRecording(false);
    setShowMobileRecorder(false);
    if (blob) setAudioBlob(blob);
    
    // NOTE: cleaned corrupted legacy comment.
    const currentSegments = liveSegmentsRef.current.length > 0
      ? liveSegmentsRef.current
      : segmentsRef.current;
    
    const hasLiveData = liveSegmentsRef.current.length > 0;
    const finalSegments = hasLiveData ? currentSegments : [];
    
    setSegments(currentSegments);
    setDataSource(blob || hasLiveData ? 'live' : 'demo');
    if (hasLiveData) {
      setVideoSource(null);
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
    }
    
    const effectiveSessionId = meta?.sessionId || sessionId;
    const duration = typeof meta?.durationMs === 'number' && meta.durationMs > 0
      ? meta.durationMs
      : finalSegments.length > 0 
      ? finalSegments[finalSegments.length - 1].endMs 
      : 0;
    setSessionMediaDurationMs(duration);
    
    // NOTE: cleaned corrupted legacy comment.
    classroomDataService.saveSession({
      id: effectiveSessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
    });
    
    // Persist audio and transcript to IndexedDB history.
    if (blob) {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      const liveMediaUrl = URL.createObjectURL(blob);
      previewObjectUrlsRef.current.push(liveMediaUrl);
      
      // Save audio blob first.
      saveAudioSession(blob, effectiveSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        duration,
      }).catch(err => console.error('Failed to save audio session to history:', err));
      
      // NOTE: cleaned corrupted legacy comment.
      if (finalSegments.length > 0) {
        addTranscripts(effectiveSessionId, currentUserId, finalSegments.map((seg) => ({
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1.0,
          isFinal: true,
        }))).catch(err => console.error('Failed to persist transcript to IndexedDB:', err));
      }

      const audioCaptureId = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const recordingId = meta?.recordingId || audioCaptureId;
      const recordingTitle = `录音 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      const pendingBaseSegments = meta?.isContinuation ? [...segmentsRef.current] : [];
      const pendingBaseOffsetMs = meta?.isContinuation
        ? resolveLiveRecordingAppendOffset(pendingBaseSegments, sessionMediaDurationMs)
        : 0;
      setSourceItems((prev) => [
        ...prev,
        {
          id: audioCaptureId,
          type: 'audio',
          role: 'primary',
          title: recordingTitle,
          preview: buildSourcePreviewText(finalSegments, 180),
          mediaUrl: liveMediaUrl,
          segmentCount: finalSegments.length,
          addedAt: new Date().toISOString(),
          origin: 'user',
          status: finalSegments.length > 0 ? 'ready' : 'transcribing',
          statusText: finalSegments.length > 0 ? '' : '转写稍后回来',
          sessionId: effectiveSessionId,
          durationMs: duration,
          reviewable: finalSegments.length > 0,
        },
      ]);
      if (finalSegments.length > 0) {
        void persistCaptureToWorkspace({
          sourceType: 'live-audio',
          sourceKey: `live:${audioCaptureId}`,
          role: 'primary',
          contentType: 'audio',
          title: recordingTitle,
          previewText: buildSourcePreviewText(finalSegments, 180),
          normalizedText: buildSupportReferenceSnippet(finalSegments, 2800),
          tutorContext: buildSupportReferenceSnippet(finalSegments, 2800),
          mediaUrl: liveMediaUrl,
          occurredAt: new Date().toISOString(),
          metadata: {
            from: 'live-recording',
            sessionId: effectiveSessionId,
            duration,
            segmentCount: finalSegments.length,
          },
        });
      } else {
        pendingRecordedAudiosRef.current.set(recordingId, {
          recordingId,
          itemId: audioCaptureId,
          sessionId: effectiveSessionId,
          title: recordingTitle,
          mediaUrl: liveMediaUrl,
          durationMs: duration,
          blob,
          baseSegments: pendingBaseSegments,
          baseOffsetMs: pendingBaseOffsetMs,
        });
      }
    }
    
    const tl = memoryService.buildTimeline(
      effectiveSessionId,
      finalSegments,
      anchors,
      { subject: UIConfig.defaultSubject, teacher: UIConfig.defaultTeacher || 'Teacher', date: new Date().toISOString().split('T')[0] }
    );
    setTimeline(tl);
    memoryService.save(tl);
    setViewMode('record');
  }, [anchors, persistCaptureToWorkspace, sessionId, sessionMediaDurationMs, user]);

  // NOTE: cleaned corrupted legacy comment.
  // NOTE: cleaned corrupted legacy comment.
  const handleViewModeChange = useCallback(async (newMode: 'record' | 'review') => {
    setViewMode(newMode);
    setMobileSubPage(null);
    setShowMobileRecorder(false);
    setMobileCollectionSheet(null);
    // NOTE: cleaned corrupted legacy comment.
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    if (newMode === 'record') {
      setVideoSource(null);
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setVideoWorkspaceTab('chat');
    }
    if (newMode === 'review' && segments.length === 0 && !hasCollectionContext) {
      try {
        const demoData = await loadDemoData();
        setSegments(demoData.DEMO_SEGMENTS);
        setAudioUrl(demoData.DEMO_AUDIO_URL);
        setAnchors(demoData.DEMO_ANCHORS);
        setVideoSource(null);
        setDataSource('demo');
        
        // NOTE: cleaned corrupted legacy comment.
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

  const openReviewFromCollection = useCallback(async (item?: SourceIngestItem | null) => {
    if (!item) return;
    setMobileCollectionSheet(null);
    setShowMobileRecorder(false);
    setShowCollectionPulsePreview(false);

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
          if (isMobile) {
            setMobileSubPage('ai-chat');
          }
          return;
        }
      } catch (error) {
        console.error('从收集流恢复复习态失败，将尝试回退恢复:', error);
      }

      try {
        const restoredFromFallback = await restoreReviewFromCollectionFallback(item);
        if (restoredFromFallback) {
          if (isMobile) {
            setMobileSubPage('ai-chat');
          }
          return;
        }
      } catch (fallbackError) {
        console.error('从收集流回退恢复复习态失败:', fallbackError);
      }
    }

    // 路径 B（新）：有服务端 transcriptSegments → 直接从服务端数据恢复（不必重新转写）
    if (item.reviewable && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0) {
      try {
        const restoredFromServer = await restoreFromServerTranscript(item);
        if (restoredFromServer) {
          if (isMobile) {
            setMobileSubPage('ai-chat');
          }
          return;
        }
      } catch (serverError) {
        console.error('从服务端转录数据恢复复习态失败:', serverError);
      }
    }

    // 路径 C：video + 有 URL + 无 sessionId + 无服务端数据 → 重新导入
    if (item.type === 'video' && item.attachmentUrl && !item.sessionId) {
      const imported = await importVideoLinkIntoSourceItem(item.attachmentUrl, {
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

    if (item.type === 'audio') {
      if (!audioBlob && item.mediaUrl) {
        setAudioUrl(item.mediaUrl);
      }
      if (item.durationMs) {
        setSessionMediaDurationMs(item.durationMs);
      }
    }

    if (item.reviewable) {
      setSourceImportError('这条内容还没准备好进入复习，稍后再试一次。');
      return;
    }

    await handleViewModeChange('review');
    setReviewTab('timeline');
    setVideoWorkspaceTab(item.type === 'video' ? 'chat' : 'chat');
    // 移动端默认进入 AI 对话，而非留在时间轴
    if (isMobile) {
      setMobileSubPage('ai-chat');
    }
  }, [audioBlob, handleViewModeChange, importVideoLinkIntoSourceItem, isMobile, restoreFromServerTranscript, restoreReviewFromCollectionFallback, restoreReviewSession]);

  const handleTranscriptUpdate = useCallback((newSegments: TranscriptSegment[], meta?: { recordingId?: string }) => {
    const pendingAudio = resolvePendingRecordedAudio(meta?.recordingId);
    let effectiveSegments = newSegments;

    if (pendingAudio) {
      const { appendedSegments, mergedSegments, totalDurationMs } = appendLiveRecordingSegments({
        existingSegments: pendingAudio.baseSegments,
        incomingSegments: newSegments,
        sourceItemId: pendingAudio.itemId,
        offsetMs: pendingAudio.baseOffsetMs,
      });
      const previewText = buildSourcePreviewText(appendedSegments, 180);
      const normalizedText = buildSupportReferenceSnippet(appendedSegments, 2800);
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      const mergedDurationMs = Math.max(
        totalDurationMs,
        pendingAudio.baseOffsetMs + pendingAudio.durationMs
      );

      effectiveSegments = mergedSegments;
      void addTranscripts(pendingAudio.sessionId, currentUserId, appendedSegments.map((seg) => ({
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence || 1.0,
        isFinal: true,
      }))).catch((err) => console.error('Failed to persist batch transcript to IndexedDB:', err));
      setSessionMediaDurationMs(Math.max(useSessionStore.getState().sessionMediaDurationMs, mergedDurationMs));
      setSourceItems((prev) =>
        prev.map((item) =>
          item.id === pendingAudio.itemId
            ? {
                ...item,
                preview: previewText,
                fullText: normalizedText,
                segmentCount: appendedSegments.length,
                durationMs: pendingAudio.durationMs,
                reviewable: true,
                sessionId: pendingAudio.sessionId,
                status: 'ready',
                statusText: undefined,
              }
            : item
        )
      );
      void persistCaptureToWorkspace({
        sourceType: 'live-audio',
        sourceKey: `live:${pendingAudio.itemId}`,
        role: 'primary',
        contentType: 'audio',
        title: pendingAudio.title,
        previewText,
        normalizedText,
        tutorContext: normalizedText,
        mediaUrl: pendingAudio.mediaUrl,
        occurredAt: new Date().toISOString(),
        metadata: {
          from: 'live-recording',
          sessionId: pendingAudio.sessionId,
          duration: pendingAudio.durationMs,
          segmentCount: appendedSegments.length,
        },
      });

      classroomDataService.saveSession({
        id: pendingAudio.sessionId,
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        teacherName: UIConfig.defaultTeacher || 'Teacher',
        status: 'completed',
        duration: mergedDurationMs,
      });

      const nextTimeline = memoryService.buildTimeline(
        pendingAudio.sessionId,
        mergedSegments,
        anchorsRef.current,
        {
          subject: UIConfig.defaultSubject,
          teacher: UIConfig.defaultTeacher || 'Teacher',
          date: new Date().toISOString().split('T')[0],
        }
      );
      setTimeline(nextTimeline);
      memoryService.save(nextTimeline);
      clearPendingRecordedAudio(meta?.recordingId);
    }

    liveSegmentsRef.current = effectiveSegments;
    segmentsRef.current = effectiveSegments;
    setSegments(effectiveSegments);
    setDataSource('live');
    setVideoSource(null);
  }, [clearPendingRecordedAudio, persistCaptureToWorkspace, resolvePendingRecordedAudio, user?.id]);

  const handleRecordingTranscriptionError = useCallback((message: string, meta?: { recordingId?: string }) => {
    const pendingAudio = resolvePendingRecordedAudio(meta?.recordingId);
    if (!pendingAudio) return;

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === pendingAudio.itemId
          ? {
              ...item,
              reviewable: false,
              status: 'failed',
              statusText: resolvePendingAudioFailureStatus(message),
            }
          : item
        )
    );

    clearPendingRecordedAudio(meta?.recordingId);
  }, [clearPendingRecordedAudio, resolvePendingRecordedAudio]);

  // 接收转写增强结果，并更新当前课堂内容
  const handleTranscriptEnhanced = useCallback((enhancedSegments: TranscriptSegment[]) => {
    liveSegmentsRef.current = enhancedSegments;
    setSegments(enhancedSegments);
  }, []);

const _handleVideoAssistantMessage = useCallback((payload: {
    id: string;
    prompt: string;
    content: string;
    timestamps: number[];
  }) => {
    if (!videoSource) return;

    const normalizedTimestamps = Array.from(new Set(payload.timestamps))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .sort((a, b) => a - b);
    const insightTimestamps = normalizedTimestamps.length > 0
      ? normalizedTimestamps
      : [Math.max(0, currentTime)];

    const insightId = `insight-${payload.id}`;
    setVideoInsightItems((prev) => {
      const baseItems = prev.filter((item) => !item.id.startsWith('seed-'));
      const nextItem: VideoInsightItem = {
        id: insightId,
        prompt: compactText(payload.prompt || '閺堫剝鐤嗛幓鎰版６', 48),
        summary: compactText(payload.content, 120),
        timestamps: insightTimestamps,
        color: VIDEO_INSIGHT_COLORS[baseItems.length % VIDEO_INSIGHT_COLORS.length],
      };
      return [nextItem, ...baseItems].slice(0, 12);
    });
    setActiveVideoInsightId(insightId);
  }, [currentTime, videoSource]);

  const handleTranscriptTextUpdate = useCallback((segmentId: string, nextText: string) => {
    const normalized = nextText.trim();
    if (!normalized) return;

    const targetSegment = segments.find(seg => seg.id === segmentId);
    if (!targetSegment || targetSegment.text === normalized) return;

    const updatedSegments = segments.map(seg =>
      seg.id === segmentId ? { ...seg, text: normalized } : seg
    );

    setSegments(updatedSegments);
    liveSegmentsRef.current = updatedSegments;

    const metadata = timeline
      ? { subject: timeline.subject, teacher: timeline.teacher, date: timeline.date }
      : {
          subject: UIConfig.defaultSubject,
          teacher: UIConfig.defaultTeacher || 'Teacher',
          date: new Date().toISOString().split('T')[0],
        };

    const nextTimeline = memoryService.buildTimeline(
      sessionId,
      updatedSegments,
      anchors,
      metadata
    );
    setTimeline(nextTimeline);
    memoryService.save(nextTimeline);

    // NOTE: cleaned corrupted legacy comment.
    void (async () => {
      try {
        const transcripts = await db.transcripts
          .where('sessionId')
          .equals(sessionId)
          .toArray();
        const matched = transcripts.filter(
          (item) =>
            item.startMs === targetSegment.startMs &&
            item.endMs === targetSegment.endMs
        );
        if (matched.length === 0) return;

        await db.transcripts.bulkPut(
          matched.map((item) => ({
            ...item,
            text: normalized,
          }))
        );
      } catch (err) {
        console.error('[TranscriptEdit] Persist failed:', err);
      }
    })();
  }, [anchors, segments, sessionId, timeline]);

  const handleAnchorMark = useCallback((timestamp: number) => {
    // Align anchor timestamp to nearest transcript segment when possible.
    // NOTE: cleaned corrupted legacy comment.
    let alignedTimestamp = timestamp;
    if (segments.length > 0) {
      // Prefer containing segment; fallback to nearest segment by distance.
      let nearestSeg = segments[0];
      let minDistance = Math.abs(timestamp - (nearestSeg.startMs + nearestSeg.endMs) / 2);
      
      for (const seg of segments) {
        // If timestamp falls inside this segment, keep it.
        if (timestamp >= seg.startMs && timestamp <= seg.endMs) {
          alignedTimestamp = timestamp; // NOTE: cleaned corrupted legacy comment.
          nearestSeg = seg;
          break;
        }
        // 继续找离当前时间最近的片段。
        const segMid = (seg.startMs + seg.endMs) / 2;
        const distance = Math.abs(timestamp - segMid);
        if (distance < minDistance) {
          minDistance = distance;
          nearestSeg = seg;
        }
      }
      
      // NOTE: cleaned corrupted legacy comment.
      const lastSeg = segments[segments.length - 1];
      if (timestamp > lastSeg.endMs + 5000) {
        alignedTimestamp = lastSeg.endMs;
      } else if (timestamp < segments[0].startMs - 5000) {
        alignedTimestamp = segments[0].startMs;
      }
    }
    
    // NOTE: cleaned corrupted legacy comment.
    const anchor = anchorService.mark(sessionId, studentId, alignedTimestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    
    // NOTE: cleaned corrupted legacy comment.
    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
    
    // 把学生标记的困惑同步到课堂数据里。
    classroomDataService.saveStudentAnchor(
      sessionId,
      studentId,
      studentName,
      alignedTimestamp,
      'confusion',
      transcriptContext
    );
    
    if (timeline) {
      setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
  }, [sessionId, studentId, studentName, timeline, segments]);

  // 在回放时新增时间锚点，便于后面追问和复盘。
  const handlePlaybackAnchorAdd = useCallback((timestamp: number) => {
    // NOTE: cleaned corrupted legacy comment.
    // NOTE: cleaned corrupted legacy comment.
    let alignedTimestamp = timestamp;
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1];
      if (timestamp > lastSeg.endMs) {
        alignedTimestamp = lastSeg.endMs;
      } else if (timestamp < segments[0].startMs) {
        alignedTimestamp = segments[0].startMs;
      }
    }
    
    const anchor = anchorService.mark(sessionId, studentId, alignedTimestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    setSelectedAnchor(anchor);
    
    // NOTE: cleaned corrupted legacy comment.
    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
    
    // 将困惑点写入学生侧共享数据
    classroomDataService.saveStudentAnchor(
      sessionId,
      studentId,
      studentName,
      alignedTimestamp,
      'confusion',
      transcriptContext
    );
    
    if (timeline) {
      setTimeline({ ...timeline, anchors: [...timeline.anchors, anchor] });
    }
    
    // 标记后直接切到困惑点详情
    setReviewTab('anchor-detail');
  }, [sessionId, studentId, studentName, timeline, segments]);

  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    setSelectedAnchor(anchor);
    setCurrentTime(anchor.timestamp);
    // 选中困惑点后切到详情
    setReviewTab('anchor-detail');
  }, []);

  const handleResolveAnchor = useCallback(() => {
    if (!selectedAnchor) return;
    
    anchorService.resolve(selectedAnchor.id, sessionId);
    
    // 同步更新本地和课堂数据里的锚点状态。
    classroomDataService.resolveAnchor(selectedAnchor.id);
    
    setAnchors(prev => prev.map(a => 
      a.id === selectedAnchor.id ? { ...a, resolved: true } : a
    ));
    setSelectedAnchor({ ...selectedAnchor, resolved: true });
    
    if (timeline) {
      setTimeline({
        ...timeline,
        anchors: timeline.anchors.map(a =>
          a.id === selectedAnchor.id ? { ...a, resolved: true } : a
        ),
      });
    }
  }, [selectedAnchor, sessionId, timeline]);

  const handleTimelineClick = useCallback((timeMs: number) => {
    setCurrentTime(timeMs);
    waveformRef.current?.seekTo(timeMs);
  }, []);

  const handleActionComplete = useCallback((actionId: string) => {
    setActionItems(prev => {
      const next = prev.map(item =>
        item.id === actionId ? { ...item, completed: !item.completed } : item
      );
      const completionState = next.reduce<Record<string, boolean>>((acc, item) => {
        if (item.completed) acc[item.id] = true;
        return acc;
      }, {});
      void setPreference(getActionProgressKey(sessionId), completionState).catch((err) => {
        console.error('Failed to persist action completion:', err);
      });
      return next;
    });
  }, [sessionId]);

  const handleStartNextAction = useCallback(() => {
    const nextPending = actionItems.find((item) => !item.completed);
    if (!nextPending) return;
    const nextTimestamp = typeof nextPending.relatedTimestamp === 'number'
      ? nextPending.relatedTimestamp
      : (selectedAnchor?.timestamp ?? anchors.find((anchor) => !anchor.resolved)?.timestamp ?? currentTime);
    handleUnifiedSeek(nextTimestamp, true);
  }, [actionItems, selectedAnchor?.timestamp, anchors, currentTime, handleUnifiedSeek]);

  // 生成精选片段（使用 SWR Hook 自动去重与重试）
  const handleGenerateTopics = useCallback(async (mode: TopicGenerationMode) => {
    try {
      await generateTopics(mode);
    } catch (error) {
      console.error('生成精选片段失败:', error);
      toast.error(`生成失败: ${error instanceof Error ? error.message : '网络错误'}`);
    }
  }, [segments.length, generateTopics]);

  // NOTE: cleaned corrupted legacy comment.
  const handleRegenerateByTheme = useCallback(async (theme: string) => {
    try {
      await regenerateByTheme(theme);
    } catch (error) {
      console.error('閹稿瀵屾０妯兼晸閹存劕銇戠拹?', error);
    }
  }, [regenerateByTheme]);

  // Generate class summary via SWR hook.
  const handleGenerateSummary = useCallback(async () => {
    try {
      await generateSummary();
    } catch (error) {
      console.error('生成摘要失败:', error);
    }
  }, [generateSummary]);

  // NOTE: cleaned corrupted legacy comment.
  const handlePlayTopic = useCallback((topic: HighlightTopic) => {
    if (topic.segments.length > 0) {
      const startTime = topic.segments[0].start;
      setCurrentTime(startTime);
      if (waveformRef.current) {
        waveformRef.current.seekTo(startTime);
        waveformRef.current.play();
      }
    }
  }, []);

  // NOTE: cleaned corrupted legacy comment.
  const handleClearTopics = useCallback(() => {
    clearTopics();
  }, [clearTopics]);

  // Play through all highlight topics in order.
  const handlePlayAll = useCallback(() => {
    if (isPlayingAll) {
      setIsPlayingAll(false);
      return;
    }
    
    if (highlightTopics.length > 0) {
      setIsPlayingAll(true);
      setPlayAllIndex(0);
      handlePlayTopic(highlightTopics[0]);
    }
  }, [isPlayingAll, highlightTopics, handlePlayTopic]);

  // 添加一条笔记
  const handleAddNote = useCallback((text: string, source: NoteSource = 'custom', metadata?: NoteMetadata) => {
    const newNote: Note = {
      id: crypto.randomUUID(),
      sessionId,
      studentId,
      source,
      text,
      metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setNotes(prev => [newNote, ...prev]);
  }, [sessionId, studentId]);

  // 更新已有笔记
  const handleUpdateNote = useCallback((noteId: string, text: string) => {
    setNotes(prev => prev.map(n => 
      n.id === noteId ? { ...n, text, updatedAt: new Date().toISOString() } : n
    ));
  }, []);

  // 删除一条笔记
  const handleDeleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }, []);

  // NOTE: cleaned corrupted legacy comment.
  const handleActionItemsUpdate = useCallback((items: ActionItem[]) => {
    void (async () => {
      try {
        const completionState = await getPreference<Record<string, boolean>>(getActionProgressKey(sessionId), {});
        const mergedItems = items.map((item) => ({
          ...item,
          completed: completionState[item.id] ?? item.completed,
        }));
        setActionItems(mergedItems);
      } catch (err) {
        console.error('Failed to restore action completion:', err);
        setActionItems(items);
      }
    })();
  }, [sessionId]);

  // NOTE: cleaned corrupted legacy comment.
  const totalDuration = Math.max(
    segments.length > 0 ? segments[segments.length - 1].endMs : 0,
    sessionMediaDurationMs
  );

  const appendSourceItem = useCallback((params: {
    id?: string;
    sourceKey?: string;
    type: SourceIngestType;
    role: SourceIngestRole;
    title: string;
    preview?: string;
    previewUrl?: string;
    mediaUrl?: string;
    attachmentUrl?: string;
    fullText?: string;
    segmentCount: number;
    keepPrevious?: boolean;
    origin?: 'user' | 'system';
    status?: SourceIngestItem['status'];
    statusText?: string;
    sessionId?: string;
    durationMs?: number;
    reviewable?: boolean;
  }) => {
    setSourceItems((prev) => {
      const item: SourceIngestItem = {
        id: params.id || `${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceKey: params.sourceKey,
        type: params.type,
        role: params.role,
        title: params.title,
        preview: params.preview,
        previewUrl: params.previewUrl,
        mediaUrl: params.mediaUrl,
        attachmentUrl: params.attachmentUrl,
        fullText: params.fullText,
        segmentCount: params.segmentCount,
        addedAt: new Date().toISOString(),
        origin: params.origin || 'user',
        status: params.status || 'ready',
        statusText: params.statusText,
        sessionId: params.sessionId,
        durationMs: params.durationMs,
        reviewable: params.reviewable,
      };
      if (params.keepPrevious === false) {
        const supportOnly = prev.filter((sourceItem) => sourceItem.role === 'support');
        return [...supportOnly, item];
      }
      return [...prev, item];
    });
  }, []);

  const updateSourceItem = useCallback((id: string, patch: Partial<SourceIngestItem>) => {
    setSourceItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const appendSupportSource = useCallback((params: {
    id?: string;
    sourceKey?: string;
    type: Extract<SourceIngestType, 'document' | 'text'>;
    title: string;
    segments: TranscriptSegment[];
    appendItem?: boolean;
  }) => {
    const supportId = params.id || `${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reference = buildSupportReferenceSnippet(params.segments, 2800);
    if (params.appendItem !== false) {
      appendSourceItem({
        id: supportId,
        sourceKey: params.sourceKey,
        type: params.type,
        role: 'support',
        title: params.title,
        preview: buildSourcePreviewText(params.segments, 180),
        segmentCount: params.segments.length,
        origin: 'user',
        status: 'ready',
        statusText: undefined,
      });
    }
    if (reference) {
      setSupportReferences((prev) => mergeSupportReferences(prev, [{
        id: supportId,
        title: params.title,
        snippet: reference,
      }]));
    }
    return {
      supportId,
      reference,
    };
  }, [appendSourceItem]);

  const removeCollectionItemsFromFlow = useCallback((params: {
    itemId?: string | null;
    sourceKey?: string | null;
    workspaceCaptureId?: string | null;
  }) => {
    const matchingIds = sourceItemsRef.current
      .filter((item) => {
        if (params.itemId && item.id === params.itemId) return true;
        if (params.sourceKey && resolveSourceItemSourceKey(item) === params.sourceKey) return true;
        if (params.workspaceCaptureId && item.id === `workspace-${params.workspaceCaptureId}`) return true;
        return false;
      })
      .map((item) => item.id);

    const idsToRemove = new Set<string>(matchingIds);
    if (params.itemId) idsToRemove.add(params.itemId);
    if (params.workspaceCaptureId) idsToRemove.add(`workspace-${params.workspaceCaptureId}`);

    if (idsToRemove.size === 0 && !params.sourceKey) {
      return;
    }

    setSourceItems((prev) =>
      prev.filter((item) => {
        if (idsToRemove.has(item.id)) return false;
        if (params.sourceKey && resolveSourceItemSourceKey(item) === params.sourceKey) return false;
        return true;
      })
    );
    setSupportReferences((prev) => prev.filter((item) => !idsToRemove.has(item.id)));
    setSelectedCollectionContextIds((prev) => prev.filter((itemId) => !idsToRemove.has(itemId)));
    setQuotedCollectionContextIds((prev) => prev.filter((itemId) => !idsToRemove.has(itemId)));
    setExpandedAudioTranscriptId((prev) => (prev && idsToRemove.has(prev) ? null : prev));
    setActiveCollectionMessageMenuId((prev) => (prev && idsToRemove.has(prev) ? null : prev));
    setConfirmCollectionDeleteId((prev) => (prev && idsToRemove.has(prev) ? null : prev));
    if (playingAudioMessageId && idsToRemove.has(playingAudioMessageId)) {
      stopAudioMessagePlayback();
    }
  }, [playingAudioMessageId, stopAudioMessagePlayback]);

  const archiveLocalCollectionItem = useCallback((item: SourceIngestItem) => {
    setArchivedLocalCollectionItems((prev) => {
      const sourceKey = resolveSourceItemSourceKey(item);
      const next = prev.filter((entry) => {
        if (entry.id === item.id) return false;
        if (sourceKey && resolveSourceItemSourceKey(entry) === sourceKey) return false;
        return true;
      });
      return [...next, item];
    });

    removeCollectionItemsFromFlow({
      itemId: item.id,
      sourceKey: resolveSourceItemSourceKey(item),
    });
  }, [removeCollectionItemsFromFlow]);

  const restoreLocalCollectionItem = useCallback((item: SourceIngestItem) => {
    setArchivedLocalCollectionItems((prev) => prev.filter((entry) => entry.id !== item.id));
    setSourceItems((prev) => {
      const sourceKey = resolveSourceItemSourceKey(item);
      if (prev.some((entry) => entry.id === item.id || (sourceKey && resolveSourceItemSourceKey(entry) === sourceKey))) {
        return prev;
      }
      return [...prev, item];
    });

    const snippet = compactText((item.fullText || item.preview || '').trim(), 2800);
    if (item.role === 'support' && snippet) {
      setSupportReferences((prev) => mergeSupportReferences(prev, [{
        id: item.id,
        title: getSupportReferenceDisplayTitle(item),
        snippet,
      }]));
    }
  }, []);

  const deleteLocalCollectionItem = useCallback((item: SourceIngestItem) => {
    setArchivedLocalCollectionItems((prev) => prev.filter((entry) => entry.id !== item.id));
    removeCollectionItemsFromFlow({
      itemId: item.id,
      sourceKey: resolveSourceItemSourceKey(item),
    });
  }, [removeCollectionItemsFromFlow]);

  const removeWorkspaceCaptureFromState = useCallback((params: {
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    retiredEchoIds?: string[];
  }) => {
    setWorkspaceCaptures((prev) =>
      prev.filter((item) => {
        if (params.captureId && item.id === params.captureId) return false;
        if (params.sourceKey && item.sourceKey === params.sourceKey) return false;
        return true;
      })
    );
    if (params.retiredEchoIds && params.retiredEchoIds.length > 0) {
      const retiredEchoIdSet = new Set(params.retiredEchoIds);
      setWorkspaceEchoes((prev) => prev.filter((item) => !retiredEchoIdSet.has(item.id)));
    }
    removeCollectionItemsFromFlow({
      itemId: params.itemId,
      sourceKey: params.sourceKey,
      workspaceCaptureId: params.captureId,
    });
  }, [removeCollectionItemsFromFlow]);

  const syncWorkspaceCaptureIntoState = useCallback((params: {
    capture: WorkspaceCaptureMessage;
    retiredEchoIds?: string[];
    ensureActiveSourceItem?: boolean;
  }) => {
    const capture = params.capture;
    setWorkspaceCaptures((prev) => mergeWorkspaceCaptures(prev, [capture]));

    if (params.retiredEchoIds && params.retiredEchoIds.length > 0) {
      const retiredEchoIdSet = new Set(params.retiredEchoIds);
      setWorkspaceEchoes((prev) => prev.filter((item) => !retiredEchoIdSet.has(item.id)));
    }

    if (capture.status === 'deleted') {
      removeWorkspaceCaptureFromState({
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: `workspace-${capture.id}`,
        retiredEchoIds: params.retiredEchoIds,
      });
      return;
    }

    if (capture.status === 'archived') {
      removeCollectionItemsFromFlow({
        itemId: `workspace-${capture.id}`,
        sourceKey: capture.sourceKey,
        workspaceCaptureId: capture.id,
      });
      return;
    }

    const sourceItem = buildWorkspaceCaptureSourceItem(capture);
    setSourceItems((prev) => {
      const index = prev.findIndex(
        (item) => item.id === sourceItem.id || resolveSourceItemSourceKey(item) === capture.sourceKey
      );

      if (index >= 0) {
        const current = prev[index];
        const next = [...prev];
        next[index] = {
          ...current,
          ...sourceItem,
          id: current.id,
        };
        return next;
      }

      if (!params.ensureActiveSourceItem) {
        return prev;
      }

      return [...prev, sourceItem];
    });

    const snippet = compactText((capture.tutorContext || capture.normalizedText || '').trim(), 2800);
    setSupportReferences((prev) => {
      const nextId = sourceItem.id;
      const next = prev.filter((item) => item.id !== nextId);
      if (!snippet) {
        return next.length === prev.length ? prev : next;
      }
      return mergeSupportReferences(next, [
        {
          id: nextId,
          title: sourceItem.title,
          snippet,
        },
      ]);
    });
  }, [removeCollectionItemsFromFlow, removeWorkspaceCaptureFromState]);

  const updateWorkspaceCaptureStatus = useCallback(async (params: {
    action: 'archive' | 'restore' | 'delete';
    captureId?: string | null;
    sourceKey?: string | null;
    itemId?: string | null;
    silent?: boolean;
  }) => {
    const captureId = params.captureId?.trim() || null;
    const sourceKey = params.sourceKey?.trim() || null;

    if (!captureId && !sourceKey) {
      removeCollectionItemsFromFlow({
        itemId: params.itemId,
      });
      return true;
    }

    if (!isAuthenticated || !accessToken || !user?.id) {
      if (params.action === 'delete') {
        removeWorkspaceCaptureFromState({
          captureId,
          sourceKey,
          itemId: params.itemId,
        });
      } else {
        removeCollectionItemsFromFlow({
          itemId: params.itemId,
          sourceKey,
          workspaceCaptureId: captureId,
        });
      }
      return true;
    }

    try {
      const response = await fetch('/api/workspace/captures', {
        method: params.action === 'delete' ? 'DELETE' : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(
          params.action === 'delete'
            ? { captureId, sourceKey }
            : { captureId, sourceKey, action: params.action }
        ),
      });

      const payload = await readJsonApiResponse<{
        success: boolean;
        capture?: WorkspaceCaptureMessage;
        retiredEchoIds?: string[];
        error?: string;
      }>(
        response,
        params.action === 'delete'
          ? '彻底删除收集失败'
          : params.action === 'restore'
            ? '恢复收集失败'
            : '收起这条收集失败'
      );

      if (response.status === 404 && sourceKey && params.action !== 'restore') {
        pendingCaptureStatusBySourceKeyRef.current.set(sourceKey, params.action);
        removeWorkspaceCaptureFromState({
          captureId,
          sourceKey,
          itemId: params.itemId,
        });
        if (!params.silent) {
          toast.success(params.action === 'delete' ? '这条收集会在写入完成后彻底删除' : '这条收集会在写入完成后先收起');
        }
        return true;
      }

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ||
            (params.action === 'delete'
              ? '彻底删除收集失败'
              : params.action === 'restore'
                ? '恢复收集失败'
                : '收起这条收集失败')
        );
      }

      if (payload.capture) {
        if (params.action === 'delete') {
          removeWorkspaceCaptureFromState({
            captureId: payload.capture.id || captureId,
            sourceKey: payload.capture.sourceKey || sourceKey,
            itemId: params.itemId,
            retiredEchoIds: Array.isArray(payload.retiredEchoIds) ? payload.retiredEchoIds : [],
          });
        } else {
          syncWorkspaceCaptureIntoState({
            capture: payload.capture,
            retiredEchoIds: Array.isArray(payload.retiredEchoIds) ? payload.retiredEchoIds : [],
            ensureActiveSourceItem: params.action === 'restore',
          });
        }
      }

      if (!params.silent) {
        toast.success(
          params.action === 'delete'
            ? '这条收集已彻底删除'
            : params.action === 'restore'
              ? '这条收集已放回正在看'
              : '这条收集已先收起'
        );
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!params.silent) {
        toast.error(message);
      }
      return false;
    }
  }, [accessToken, isAuthenticated, removeCollectionItemsFromFlow, removeWorkspaceCaptureFromState, syncWorkspaceCaptureIntoState, user?.id]);

  const openWorkspaceCaptureEditor = useCallback((capture: WorkspaceCaptureMessage, mode: WorkspaceCaptureEditorMode) => {
    const normalizedText = (capture.normalizedText || capture.tutorContext || '').trim();
    const previewText = (capture.previewText || '').trim();
    const draftBody =
      mode === 'text'
        ? normalizedText || previewText || capture.title
        : mode === 'transcript'
          ? normalizedText
          : previewText && previewText !== capture.title
            ? previewText
            : '';

    setWorkspaceCaptureEditor({
      capture,
      mode,
    });
    setWorkspaceCaptureEditorTitle(capture.title || '');
    setWorkspaceCaptureEditorBody(draftBody);
    setActiveCollectionMessageMenuId(null);
    setConfirmCollectionDeleteId(null);
  }, []);

  const closeWorkspaceCaptureEditor = useCallback(() => {
    if (isSavingWorkspaceCaptureEdit) return;
    setWorkspaceCaptureEditor(null);
    setWorkspaceCaptureEditorTitle('');
    setWorkspaceCaptureEditorBody('');
  }, [isSavingWorkspaceCaptureEdit]);

  const saveWorkspaceCaptureEdit = useCallback(async () => {
    if (!workspaceCaptureEditor || !isAuthenticated || !accessToken) {
      return;
    }

    const capture = workspaceCaptureEditor.capture;
    const trimmedTitle = workspaceCaptureEditorTitle.replace(/\s+/g, ' ').trim();
    const trimmedBody = workspaceCaptureEditorBody.replace(/\s+/g, ' ').trim();

    let payload: {
      captureId: string;
      sourceKey: string;
      action: 'update';
      title?: string | null;
      previewText?: string | null;
      normalizedText?: string | null;
      tutorContext?: string | null;
    } | null = null;

    if (workspaceCaptureEditor.mode === 'text') {
      if (!trimmedBody) {
        toast.error('文字内容不能为空');
        return;
      }

      payload = {
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        action: 'update',
        title: compactText(trimmedBody, 80) || capture.title,
        previewText: trimmedBody,
        normalizedText: trimmedBody,
        tutorContext: trimmedBody,
      };
    } else if (workspaceCaptureEditor.mode === 'transcript') {
      if (!trimmedBody) {
        toast.error('转写文字不能为空');
        return;
      }

      payload = {
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        action: 'update',
        previewText: trimmedBody,
        normalizedText: trimmedBody,
        tutorContext: trimmedBody,
      };
    } else {
      if (!trimmedTitle) {
        toast.error('标题不能为空');
        return;
      }

      payload = {
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        action: 'update',
        title: trimmedTitle,
        previewText: trimmedBody || null,
      };
    }

    setIsSavingWorkspaceCaptureEdit(true);
    try {
      const response = await fetch('/api/workspace/captures', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      const result = await readJsonApiResponse<{
        success: boolean;
        capture?: WorkspaceCaptureMessage;
        error?: string;
      }>(response, '更新收集失败');

      if (!response.ok || !result.success || !result.capture) {
        throw new Error(result.error || '更新收集失败');
      }

      syncWorkspaceCaptureIntoState({
        capture: result.capture,
      });
      toast.success(
        workspaceCaptureEditor.mode === 'transcript'
          ? '转写文字已更新'
          : workspaceCaptureEditor.mode === 'text'
            ? '文字已更新'
            : '标题和备注已更新'
      );
      setWorkspaceCaptureEditor(null);
      setWorkspaceCaptureEditorTitle('');
      setWorkspaceCaptureEditorBody('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      setIsSavingWorkspaceCaptureEdit(false);
    }
  }, [accessToken, isAuthenticated, syncWorkspaceCaptureIntoState, workspaceCaptureEditor, workspaceCaptureEditorBody, workspaceCaptureEditorTitle]);

  const ingestTranscriptSegments = useCallback(async (params: {
    segments: TranscriptSegment[];
    sourceType: SourceIngestType;
    sourceTitle: string;
    audioBlob?: Blob;
    mediaUrl?: string;
    mediaDurationMs?: number;
    videoSource?: ImportedVideoSource;
    sourceItemId?: string;
    persistSourceKey?: string;
    persistSourceType?: string;
    persistRole?: SourceIngestRole;
    occurredAt?: string;
  }) => {
    const incoming = Array.isArray(params.segments) ? params.segments : [];
    if (incoming.length === 0) {
      toast.warning('未提取到可用内容，请更换资料后重试。');
      return;
    }

    const existingSegments = segmentsRef.current;
    const hasExisting = existingSegments.length > 0;
    const nextSessionId = hasExisting ? sessionIdRef.current : generateSessionId();
    const sourceItemId = params.sourceItemId || `${params.sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const offsetMs = hasExisting
      ? Math.max(0, (existingSegments[existingSegments.length - 1]?.endMs || 0) + 1200)
      : 0;
    const normalizedSegments = mapSegmentsForAppend(incoming, sourceItemId, offsetMs);
    const mergedSegments = hasExisting ? [...existingSegments, ...normalizedSegments] : normalizedSegments;
    const currentUserId = user?.id || ANONYMOUS_USER_ID;
    const duration = mergedSegments[mergedSegments.length - 1]?.endMs || 0;
    const batchDurationMs = getSegmentBatchDurationMs(normalizedSegments);
    const sourceDurationMs =
      typeof params.mediaDurationMs === 'number' && params.mediaDurationMs > 0
        ? params.mediaDurationMs
        : batchDurationMs;
    const persistedDuration = hasExisting
      ? duration
      : Math.max(duration, sourceDurationMs || 0);

    if (!hasExisting) {
      setSessionId(nextSessionId);
      sessionIdRef.current = nextSessionId;
      setAnchors([]);
      setSelectedAnchor(null);
      clearTopics();
      clearSummary();
      setNotes([]);
      setActionItems([]);
      setCurrentTime(0);
      setVideoSeekNonce(0);
      setVideoPlayNonce(0);
      setShowConversationHistory(false);
      setSelectedHistoryConversation(null);
    }

    const shouldKeepVideoSource = params.sourceType === 'video' && !!params.videoSource && !hasExisting;
    if (shouldKeepVideoSource && params.videoSource) {
      setDataSource('video');
      setVideoSource(params.videoSource);
      setVideoWorkspaceTab('chat');
      const seededInsights = buildSeedVideoInsights(normalizedSegments);
      setVideoInsightItems(seededInsights);
      setActiveVideoInsightId(seededInsights[0]?.id || null);
    } else {
      setDataSource('demo');
      setVideoSource(null);
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
    }

    setSegments(mergedSegments);
    segmentsRef.current = mergedSegments;
    liveSegmentsRef.current = mergedSegments;
    setViewMode(shouldKeepVideoSource ? 'review' : 'record');
    setSourceImportError('');

    if (params.sourceItemId) {
      updateSourceItem(sourceItemId, {
        sourceKey: `ingest:${sourceItemId}`,
        type: params.sourceType,
        role: 'primary',
        title: params.sourceTitle,
        preview: buildSourcePreviewText(normalizedSegments, 180),
        previewUrl: params.sourceType === 'video' ? params.videoSource?.thumbnailUrl : undefined,
        mediaUrl: params.sourceType === 'video'
          ? params.videoSource?.playableUrl || params.videoSource?.originalUrl
          : params.mediaUrl,
        attachmentUrl: params.sourceType === 'video' ? params.videoSource?.originalUrl : undefined,
        segmentCount: normalizedSegments.length,
        status: 'ready',
        statusText: undefined,
        origin: 'user',
        sessionId: nextSessionId,
        durationMs: sourceDurationMs,
        reviewable: params.sourceType === 'audio' || params.sourceType === 'video',
      });
    } else {
      appendSourceItem({
        id: sourceItemId,
        sourceKey: `ingest:${sourceItemId}`,
        type: params.sourceType,
        role: 'primary',
        title: params.sourceTitle,
        preview: buildSourcePreviewText(normalizedSegments, 180),
        previewUrl: params.sourceType === 'video' ? params.videoSource?.thumbnailUrl : undefined,
        mediaUrl: params.sourceType === 'video'
          ? params.videoSource?.playableUrl || params.videoSource?.originalUrl
          : params.mediaUrl,
        attachmentUrl: params.sourceType === 'video' ? params.videoSource?.originalUrl : undefined,
        segmentCount: normalizedSegments.length,
        keepPrevious: hasExisting,
        origin: 'user',
        status: 'ready',
        statusText: undefined,
        sessionId: nextSessionId,
        durationMs: sourceDurationMs,
        reviewable: params.sourceType === 'audio' || params.sourceType === 'video',
      });
    }

    void persistCaptureToWorkspace({
      sourceType: params.sourceType,
      sourceKey: `ingest:${sourceItemId}`,
      role: 'primary',
      contentType: params.sourceType === 'audio' ? 'audio' : params.sourceType === 'video' ? 'video' : 'text',
      title: params.sourceTitle,
      previewText: buildSourcePreviewText(normalizedSegments, 180),
      normalizedText: buildSupportReferenceSnippet(normalizedSegments, 2800),
      sourceUrl: params.videoSource?.originalUrl,
      tutorContext: buildSupportReferenceSnippet(normalizedSegments, 2800),
      occurredAt: new Date().toISOString(),
        metadata: {
          from: 'transcript-ingest',
          sessionId: nextSessionId,
          segmentCount: normalizedSegments.length,
          duration: sourceDurationMs || persistedDuration,
          provider: params.videoSource?.provider,
          providerLabel: params.videoSource?.providerLabel,
          originalUrl: params.videoSource?.originalUrl,
          embedUrl: params.videoSource?.embedUrl,
          playableUrl: params.videoSource?.playableUrl,
          thumbnailUrl: params.videoSource?.thumbnailUrl,
          sourceMode: params.videoSource?.sourceMode,
        },
      });

    try {
      await db.transcripts.bulkAdd(
        normalizedSegments.map((seg) => ({
          sessionId: nextSessionId,
          userId: currentUserId,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1,
          isFinal: true,
        }))
      );
    } catch (error) {
      console.error('Failed to persist imported transcript segments:', error);
    }

    if (!hasExisting) {
      if (shouldKeepVideoSource && params.videoSource) {
        try {
          await saveAudioSession(null, nextSessionId, currentUserId, {
            subject: UIConfig.defaultSubject,
            topic: params.sourceTitle || params.videoSource.title || '视频复习',
            duration: persistedDuration,
            sourceType: 'video-link',
            videoUrl: params.videoSource.originalUrl,
            videoEmbedUrl: params.videoSource.embedUrl,
            videoProvider: params.videoSource.provider,
            thumbnailUrl: params.videoSource.thumbnailUrl,
            importSourceMode: params.videoSource.sourceMode as AudioSession['importSourceMode'],
            importTrace: params.videoSource.importTrace,
          });
        } catch (error) {
          console.error('Failed to persist imported video session:', error);
        }
      } else if (params.audioBlob) {
        saveAudioSession(params.audioBlob, nextSessionId, currentUserId, {
          subject: UIConfig.defaultSubject,
          topic: params.sourceTitle || UIConfig.defaultLessonTitle,
          duration: persistedDuration,
          sourceType: params.sourceType === 'video' ? 'video-file' : 'upload',
          mediaUrl: params.mediaUrl,
          mimeType: params.audioBlob.type || (params.sourceType === 'video' ? 'video/mp4' : 'audio/webm'),
        }).catch((error) => {
          console.error('Failed to persist imported audio session:', error);
        });

        if (!hasExisting && params.sourceType === 'audio') {
          setAudioBlob(params.audioBlob);
          setAudioUrl(params.mediaUrl || null);
          setSessionMediaDurationMs(sourceDurationMs || persistedDuration);
        }
      }
    }

    classroomDataService.saveSession({
      id: nextSessionId,
      subject: UIConfig.defaultSubject,
      topic: params.sourceTitle || UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration: persistedDuration,
      createdBy: studentId,
    });

    const nextTimeline = memoryService.buildTimeline(
      nextSessionId,
      mergedSegments,
      hasExisting ? anchorsRef.current : [],
      {
        subject: UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: new Date().toISOString().split('T')[0],
      }
    );
    setTimeline(nextTimeline);
    memoryService.save(nextTimeline);
  }, [appendSourceItem, clearSummary, clearTopics, persistCaptureToWorkspace, studentId, updateSourceItem, user?.id]);

  const handleVideoImportReady = useCallback(async (
    result: ImportedVideoResult,
    options?: {
      sourceItemId?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
    }
  ) => {
    const importedSegments = Array.isArray(result.segments) ? result.segments : [];
    if (importedSegments.length === 0) {
      toast.warning('视频已导入，但转写为空，请更换视频或重试。');
      return;
    }

    await ingestTranscriptSegments({
      segments: importedSegments,
      sourceType: 'video',
      sourceTitle: result.source.title || '视频链接',
      videoSource: result.source,
      sourceItemId: options?.sourceItemId,
      persistSourceKey: options?.persistSourceKey,
      persistSourceType: options?.persistSourceType,
      persistRole: options?.persistRole,
      occurredAt: options?.occurredAt,
    });
  }, [ingestTranscriptSegments]);

  const handleImportFiles = useCallback(async (
    files: FileList | File[],
    pickerMode: 'audio' | 'support' | 'all' = 'all'
  ) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    setActiveSourceImportCount((count) => count + 1);
    setSourceImportError('');

    try {
      const queuedFiles = await Promise.all(fileList.map(async (file) => {
        const isAudio = isAudioReachFile(file);
        const isVideo = isVideoReachFile(file);
        const isImage = isImageReachFile(file);
        const objectUrl = URL.createObjectURL(file);
        const mediaUrl = isAudio || isVideo ? objectUrl : undefined;
        const previewUrl = isImage ? objectUrl : undefined;
        const attachmentUrl = !isAudio && !isVideo ? objectUrl : undefined;
        const durationMs = isAudio || isVideo ? await getLocalMediaDurationMs(file) : undefined;
        if (objectUrl) {
          previewObjectUrlsRef.current.push(objectUrl);
        }
        return {
          id: `${isAudio ? 'audio' : isVideo ? 'video' : isImage ? 'image' : 'support'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          isAudio,
          isVideo,
          isImage,
          mediaUrl,
          previewUrl,
          attachmentUrl,
          durationMs,
        };
      }));
      const importedReferenceTexts: string[] = [];
      let handledFileCount = 0;
      const errorMessages: string[] = [];

      queuedFiles.forEach(({ id, file, isAudio, isVideo, isImage, mediaUrl, previewUrl, attachmentUrl, durationMs }) => {
        appendSourceItem({
          id,
          sourceKey: isAudio || isVideo ? `ingest:${id}` : `support:${id}`,
          type: isAudio ? 'audio' : isVideo ? 'video' : isImage ? 'image' : 'document',
          role: isAudio || isVideo ? 'primary' : 'support',
          title: file.name,
          preview: isAudio || isVideo ? '' : file.name,
          mediaUrl,
          previewUrl,
          attachmentUrl,
          segmentCount: 0,
          origin: 'user',
          status: isAudio || isVideo ? 'transcribing' : 'parsing',
          statusText: isAudio
            ? '转写稍后完成'
            : undefined,
          durationMs,
        });
      });

      for (const { id, file, isAudio, isVideo, isImage, mediaUrl, previewUrl, attachmentUrl, durationMs } of queuedFiles) {
        const fileReach = detectReachFromFile(file);
        try {
          if (isImage) {
            if (pickerMode === 'audio') {
              updateSourceItem(id, {
                status: 'failed',
                statusText: '这次只接收音频文件',
              });
              continue;
            }
            const parsed = await parseImageFile(file);
            const appended = appendSupportSource({
              id,
              sourceKey: `support:${id}`,
              type: 'document',
              title: parsed.title,
              segments: parsed.segments,
              appendItem: false,
            });
            updateSourceItem(id, {
              sourceKey: `support:${id}`,
              type: 'image',
              role: 'support',
              title: parsed.title,
              preview: buildSourcePreviewText(parsed.segments, 220),
              previewUrl,
              attachmentUrl,
              fullText: appended.reference,
              segmentCount: parsed.segments.length,
              status: 'ready',
              statusText: undefined,
              origin: 'user',
            });
            void persistCaptureToWorkspace({
              sourceType: 'support-import',
              sourceKey: `support:${id}`,
              role: 'support',
              contentType: 'image',
              title: parsed.title,
              previewText: buildSourcePreviewText(parsed.segments, 180),
              normalizedText: appended.reference,
              tutorContext: appended.reference,
              occurredAt: new Date().toISOString(),
              metadata: {
                from: 'file-import',
                fileType: parsed.fileType,
                fileName: file.name,
              },
            });
            importedReferenceTexts.push(
              compactText(
                parsed.segments
                  .slice(0, 20)
                  .map((segment) => segment.text)
                  .join(' '),
                1200
              )
            );
            handledFileCount += 1;
            continue;
          }

          if (isDocumentReachFile(file)) {
            if (pickerMode === 'audio') {
              updateSourceItem(id, {
                status: 'failed',
                statusText: '这次只接收音频文件',
              });
              continue;
            }
            const parsed = await parseDocumentFile(file);
            const supportType = parsed.fileType === 'txt' || parsed.fileType === 'md' ? 'text' : 'document';
            const appended = appendSupportSource({
              id,
              sourceKey: `support:${id}`,
              type: supportType,
              title: parsed.title,
              segments: parsed.segments,
              appendItem: false,
            });
            updateSourceItem(id, {
              sourceKey: `support:${id}`,
              type: supportType,
              role: 'support',
              title: parsed.title,
              preview: buildSourcePreviewText(parsed.segments, 180) || parsed.title,
              attachmentUrl,
              fullText: appended.reference,
              segmentCount: parsed.segments.length,
              status: 'ready',
              statusText: undefined,
              origin: 'user',
            });
            void persistCaptureToWorkspace({
              sourceType: 'support-import',
              sourceKey: `support:${id}`,
              role: 'support',
              contentType: 'document',
              title: parsed.title,
              previewText: buildSourcePreviewText(parsed.segments, 180),
              normalizedText: appended.reference,
              tutorContext: appended.reference,
              occurredAt: new Date().toISOString(),
              metadata: {
                from: 'file-import',
                fileType: parsed.fileType,
                fileName: file.name,
              },
            });
            importedReferenceTexts.push(
              compactText(
                parsed.segments
                  .slice(0, 20)
                  .map((segment) => segment.text)
                  .join(' '),
                1200
              )
            );
            handledFileCount += 1;
            continue;
          }

          if (isAudio || isVideo || isAudioReachFile(file) || isVideoReachFile(file)) {
            if (pickerMode === 'support') {
              updateSourceItem(id, {
                status: 'failed',
                statusText: '这次只接收资料文件',
              });
              continue;
            }
            const contextHint = buildASRContextHint({
              manualHint: asrContextHint,
              recentSegments: segmentsRef.current,
              importedReferences: [
                ...supportReferences.map((item) => item.snippet),
                ...importedReferenceTexts,
              ],
              maxChars: 3000,
            });
            const segments = await transcribeAudioFile(file, contextHint);
            const mediaBlob = new Blob([await file.arrayBuffer()], { type: file.type || (isVideo ? 'video/mp4' : 'audio/mpeg') });
            await ingestTranscriptSegments({
              segments,
              sourceType: isVideo ? 'video' : 'audio',
              sourceTitle: file.name,
              audioBlob: mediaBlob,
              mediaUrl,
              mediaDurationMs: durationMs,
              sourceItemId: id,
            });
            if (mediaUrl) {
              updateSourceItem(id, { mediaUrl, durationMs });
            }
            handledFileCount += 1;
            continue;
          }

          throw new Error(`${fileReach.label} 暂时还不能自动接入：${file.name}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isUserInputIssue = /只接收|没有识别到|暂时还不能自动接入/i.test(message);
          if (isUserInputIssue) {
            errorMessages.push(message);
          }
          updateSourceItem(id, {
            status: 'failed',
            statusText: resolveSourceFailureStatus({ isAudio, isVideo, isImage }),
            preview: isAudio || isVideo ? '' : file.name,
            origin: 'user',
          });
        }
      }

      if (handledFileCount === 0) {
        if (errorMessages.length > 0) {
          setSourceImportError(errorMessages[0]);
        }
        return;
      }

      if (errorMessages.length > 0) {
        setSourceImportError(errorMessages[0]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSourceImportError(message);
    } finally {
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
      setSourceFilePickerMode('all');
    }
  }, [
    appendSourceItem,
    appendSupportSource,
    asrContextHint,
    ingestTranscriptSegments,
    persistCaptureToWorkspace,
    supportReferences,
    updateSourceItem,
  ]);

  const handleSourceFileButtonClick = useCallback((mode: 'audio' | 'support' | 'all' = 'all') => {
    setSourceImportError('');
    setSourceFilePickerMode(mode);
    setShowMobileRecorder(false);
    setMobileCollectionSheet(null);

    // Unified picker is the default for the chat-style collection flow.
    if (mode !== 'all') {
      setDataSource('demo');
    }

    sourceFileInputRef.current?.click();
  }, []);

  const handleSourceFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      void handleImportFiles(files, sourceFilePickerMode);
    }
    if (sourceFileInputRef.current) {
      sourceFileInputRef.current.value = '';
    }
  }, [handleImportFiles, sourceFilePickerMode]);

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

  const collectionFeedItems = useMemo(
    () =>
      [...sourceItems].sort(
        (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
      ),
    [sourceItems]
  );

  // ── 收集页滚动检测 + 自动滚到底部 ──
  const scrollCollectionToBottom = useCallback((smooth = true) => {
    const el = collectionScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // 监听滚动容器，判断是否滚离底部
  useEffect(() => {
    const el = collectionScrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom < 120;
      collectionScrollNearBottomRef.current = nearBottom;
      setShowScrollToLatest(!nearBottom && collectionFeedItems.length > 0);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    // 初始检测
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [collectionFeedItems.length]);

  // 新 item 加入时，如果之前在底部则自动滚到底部
  const prevCollectionCountRef = useRef(collectionFeedItems.length);
  useEffect(() => {
    if (collectionFeedItems.length > prevCollectionCountRef.current && collectionScrollNearBottomRef.current) {
      requestAnimationFrame(() => scrollCollectionToBottom(true));
    }
    prevCollectionCountRef.current = collectionFeedItems.length;
  }, [collectionFeedItems.length, scrollCollectionToBottom]);

  const selectedCollectionContextItems = useMemo(
    () => collectionFeedItems.filter((item) => selectedCollectionContextIds.includes(item.id)),
    [collectionFeedItems, selectedCollectionContextIds]
  );

  const quotedCollectionContextItems = useMemo(
    () => collectionFeedItems.filter((item) => quotedCollectionContextIds.includes(item.id)),
    [collectionFeedItems, quotedCollectionContextIds]
  );

  const selectedCollectionListIds = useMemo(
    () =>
      selectedCollectionContextIds.map((id) =>
        id.startsWith('workspace-') ? id.replace(/^workspace-/, '') : id
      ),
    [selectedCollectionContextIds]
  );

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

  useEffect(() => {
    if (selectedCollectionContextIds.length === 0) {
      if (selectedCollectionPrimaryId) {
        setSelectedCollectionPrimaryId(null);
      }
      if (isCollectionContextSelectionMode && collectionFeedItems.length === 0) {
        setIsCollectionContextSelectionMode(false);
      }
      return;
    }

    const validIds = new Set(collectionFeedItems.map((item) => item.id));
    const nextIds = selectedCollectionContextIds.filter((id) => validIds.has(id));
    if (nextIds.length !== selectedCollectionContextIds.length) {
      setSelectedCollectionContextIds(nextIds);
      return;
    }

    const nextPrimaryId = resolveCollectionContextPrimaryId(selectedCollectionContextItems, selectedCollectionPrimaryId);
    if (nextPrimaryId !== selectedCollectionPrimaryId) {
      setSelectedCollectionPrimaryId(nextPrimaryId);
    }
  }, [
    collectionFeedItems,
    isCollectionContextSelectionMode,
    selectedCollectionContextIds,
    selectedCollectionContextItems,
    selectedCollectionPrimaryId,
  ]);

  useEffect(() => {
    setConfirmSelectedCollectionDelete(false);
  }, [isCollectionContextSelectionMode, selectedCollectionContextIds.join('|')]);

  useEffect(() => {
    if (quotedCollectionContextIds.length === 0) {
      if (quotedCollectionPrimaryId) {
        setQuotedCollectionPrimaryId(null);
      }
      return;
    }

    const validIds = new Set(collectionFeedItems.map((item) => item.id));
    const nextIds = quotedCollectionContextIds.filter((id) => validIds.has(id));
    if (nextIds.length !== quotedCollectionContextIds.length) {
      setQuotedCollectionContextIds(nextIds);
      return;
    }

    const nextPrimaryId = resolveCollectionContextPrimaryId(quotedCollectionContextItems, quotedCollectionPrimaryId);
    if (nextPrimaryId !== quotedCollectionPrimaryId) {
      setQuotedCollectionPrimaryId(nextPrimaryId);
    }
  }, [collectionFeedItems, quotedCollectionContextIds, quotedCollectionContextItems, quotedCollectionPrimaryId]);

  useEffect(() => {
    if (!activeCollectionMessageMenuId) return;
    if (collectionFeedItems.some((item) => item.id === activeCollectionMessageMenuId)) return;
    setActiveCollectionMessageMenuId(null);
  }, [activeCollectionMessageMenuId, collectionFeedItems]);

  useEffect(() => {
    if (!confirmCollectionDeleteId) return;
    if (confirmCollectionDeleteId === activeCollectionMessageMenuId) return;
    setConfirmCollectionDeleteId(null);
  }, [activeCollectionMessageMenuId, confirmCollectionDeleteId]);

  const selectedCollectionContextText = useMemo(
    () =>
      buildSelectedCollectionContextText({
        items: selectedCollectionContextItems,
        primaryId: selectedCollectionPrimaryId,
      }),
    [selectedCollectionContextItems, selectedCollectionPrimaryId]
  );

  const tutorSupportContextText = useMemo(() => {
    const base = buildTutorSupportContextText(supportReferences, workspaceEchoes);
    const activeSelectedContext = mobileAIPreferSelectedContext
      ? (mobileAILaunchSupportContextText || selectedCollectionContextText)
      : selectedCollectionContextText;
    return compactMultilineText(
      [activeSelectedContext, base].filter(Boolean).join('\n\n'),
      8500
    );
  }, [mobileAILaunchSupportContextText, mobileAIPreferSelectedContext, selectedCollectionContextText, supportReferences, workspaceEchoes]);

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

  const composerReach = useMemo<ContextReachDetection>(
    () => detectReachFromText(collectionComposerText),
    [collectionComposerText]
  );

  const composerDetectedUrl = composerReach.url || null;
  const composerLinkPreview = useMemo(
    () => (composerDetectedUrl ? parseVideoLink(composerDetectedUrl) : null),
    [composerDetectedUrl]
  );

  const composerCanAutoImportLink = (composerReach.channel === 'video-link' || composerReach.channel === 'article-link') && composerReach.shouldAutoIngest;
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

  const nudgeComposer = useCallback((draft: string) => {
    setMobileCollectionSheet(null);
    setShowMobileRecorder(false);
    setCollectionComposerText(draft);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        collectionComposerRef.current?.focus();
        collectionComposerRef.current?.setSelectionRange(draft.length, draft.length);
      });
    }
  }, []);

  const focusCollectionComposer = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      const textarea = collectionComposerRef.current;
      if (!textarea) return;
      textarea.focus();
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
    });
  }, []);

  const appendToCollectionComposer = useCallback((incomingText: string) => {
    const normalized = incomingText.replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    setCollectionComposerText((previous) => {
      const base = previous.trimEnd();
      if (!base) return normalized;
      const joiner = /[。！？.!?；;，,：:]$/.test(base) ? '' : ' ';
      return `${base}${joiner}${normalized}`;
    });

    focusCollectionComposer();
  }, [focusCollectionComposer]);

  const setQuotedCollectionContext = useCallback((items: SourceIngestItem[], primaryId?: string | null) => {
    setMobileCollectionSheet(null);
    setShowMobileRecorder(false);
    setQuotedCollectionContextIds(items.map((item) => item.id));
    setQuotedCollectionPrimaryId(resolveCollectionContextPrimaryId(items, primaryId));
    focusCollectionComposer();
  }, [focusCollectionComposer]);

  const ensureWorkspaceCaptureSourceItem = useCallback((capture: WorkspaceCaptureMessage): SourceIngestItem => {
    const sourceItem = buildWorkspaceCaptureSourceItem(capture);

    setSourceItems((prev) => {
      if (prev.some((item) => item.id === sourceItem.id)) {
        return prev;
      }

      if (sourceItem.sourceKey && prev.some((item) => resolveSourceItemSourceKey(item) === sourceItem.sourceKey)) {
        return prev;
      }

      return [...prev, sourceItem];
    });

    const snippet = compactText((capture.tutorContext || capture.normalizedText || '').trim(), 2800);
    if (snippet) {
      setSupportReferences((prev) =>
        mergeSupportReferences(prev, [
          {
            id: sourceItem.id,
            title: getSupportReferenceDisplayTitle(sourceItem),
            snippet,
          },
        ])
      );
    }

    return sourceItem;
  }, []);

  const clearCollectionContextSelection = useCallback(() => {
    setSelectedCollectionContextIds([]);
    setSelectedCollectionPrimaryId(null);
    setIsCollectionContextSelectionMode(false);
    setConfirmSelectedCollectionDelete(false);
  }, []);

  const clearQuotedCollectionContext = useCallback(() => {
    setQuotedCollectionContextIds([]);
    setQuotedCollectionPrimaryId(null);
  }, []);

  const toggleCollectionContextItem = useCallback((item: SourceIngestItem) => {
    setSelectedCollectionContextIds((prev) => {
      const exists = prev.includes(item.id);
      const nextIds = exists ? prev.filter((id) => id !== item.id) : [...prev, item.id];
      const selectedItems = collectionFeedItems
        .filter((current) => nextIds.includes(current.id))
        .concat(nextIds.includes(item.id) && !collectionFeedItems.some((current) => current.id === item.id) ? [item] : []);
      const nextPrimaryId = resolveCollectionContextPrimaryId(
        selectedItems,
        exists
          ? selectedCollectionPrimaryId === item.id
            ? null
            : selectedCollectionPrimaryId
          : item.id
      );
      setSelectedCollectionPrimaryId(nextPrimaryId);
      if (nextIds.length === 0) {
        setIsCollectionContextSelectionMode(false);
      } else if (!isCollectionContextSelectionMode) {
        setIsCollectionContextSelectionMode(true);
      }
      return nextIds;
    });
  }, [collectionFeedItems, isCollectionContextSelectionMode, selectedCollectionPrimaryId]);

  const quoteSelectedCollectionContextToComposer = useCallback(() => {
    if (selectedCollectionContextItems.length === 0) return;
    setQuotedCollectionContext(selectedCollectionContextItems, selectedCollectionPrimaryId);
    clearCollectionContextSelection();
  }, [clearCollectionContextSelection, selectedCollectionContextItems, selectedCollectionPrimaryId, setQuotedCollectionContext]);

  const quoteCollectionItemToComposer = useCallback((item: SourceIngestItem) => {
    clearCollectionContextSelection();
    setQuotedCollectionContext([item], item.id);
  }, [clearCollectionContextSelection, setQuotedCollectionContext]);

  const resolveCollectionListSourceItem = useCallback((capture: WorkspaceCaptureListItem): SourceIngestItem => {
    const workspaceCapture =
      capture.kind === 'workspace'
        ? workspaceCaptures.find((item) => item.id === capture.id || item.sourceKey === capture.sourceKey) || null
        : null;

    if (workspaceCapture) {
      return ensureWorkspaceCaptureSourceItem(workspaceCapture);
    }

    const sourceItemId = capture.sourceItemId || capture.id;
    const sourceKey = capture.sourceKey || null;
    const existing =
      sourceItems.find((item) => item.id === sourceItemId || (sourceKey && resolveSourceItemSourceKey(item) === sourceKey)) ||
      archivedLocalCollectionItems.find((item) => item.id === sourceItemId || (sourceKey && resolveSourceItemSourceKey(item) === sourceKey));

    if (existing) {
      return existing;
    }

    const type = inferWorkspaceCaptureSourceType({
      contentType: capture.contentType,
      sourceType: capture.sourceType,
      metadata: capture.metadata,
    } as WorkspaceCaptureMessage);

    return {
      id: sourceItemId,
      sourceKey: capture.sourceKey,
      type,
      role: capture.role === 'primary' ? 'primary' : 'support',
      title: capture.title,
      preview: capture.previewText,
      previewUrl: type === 'image' ? capture.mediaUrl || undefined : undefined,
      mediaUrl: (type === 'audio' || type === 'video') ? capture.mediaUrl || undefined : undefined,
      attachmentUrl: capture.sourceUrl || undefined,
      fullText: compactMultilineText(capture.normalizedText || capture.tutorContext || capture.previewText || capture.title, 3200),
      segmentCount: capture.normalizedText || capture.tutorContext ? 1 : 0,
      addedAt: capture.occurredAt || capture.createdAt,
      origin: 'user',
      sessionId: typeof capture.metadata?.sessionId === 'string' ? capture.metadata.sessionId : undefined,
      durationMs: typeof capture.metadata?.duration === 'number' ? capture.metadata.duration : undefined,
      reviewable: type === 'audio' || type === 'video',
    };
  }, [archivedLocalCollectionItems, ensureWorkspaceCaptureSourceItem, sourceItems, workspaceCaptures]);

  const quoteCollectionListItemToComposer = useCallback((capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    quoteCollectionItemToComposer(sourceItem);
    setMobileCollectionSheet(null);
  }, [quoteCollectionItemToComposer, resolveCollectionListSourceItem]);

  const openReviewFromCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    await openReviewFromCollection(sourceItem);
    setMobileCollectionSheet(null);
  }, [openReviewFromCollection, resolveCollectionListSourceItem]);

  const toggleCollectionListItemSelection = useCallback((capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    toggleCollectionContextItem(sourceItem);
  }, [resolveCollectionListSourceItem, toggleCollectionContextItem]);

  const archiveCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    if (capture.kind === 'workspace') {
      await updateWorkspaceCaptureStatus({
        action: 'archive',
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: capture.sourceItemId || `workspace-${capture.id}`,
      });
      return;
    }

    if (capture.sourceKey) {
      pendingCaptureStatusBySourceKeyRef.current.set(capture.sourceKey, 'archive');
    }
    archiveLocalCollectionItem(resolveCollectionListSourceItem(capture));
  }, [archiveLocalCollectionItem, resolveCollectionListSourceItem, updateWorkspaceCaptureStatus]);

  const restoreCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    if (capture.kind === 'workspace') {
      await updateWorkspaceCaptureStatus({
        action: 'restore',
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: capture.sourceItemId || `workspace-${capture.id}`,
      });
      return;
    }

    if (capture.sourceKey) {
      pendingCaptureStatusBySourceKeyRef.current.delete(capture.sourceKey);
    }
    restoreLocalCollectionItem(resolveCollectionListSourceItem(capture));
  }, [resolveCollectionListSourceItem, restoreLocalCollectionItem, updateWorkspaceCaptureStatus]);

  const deleteCollectionListItem = useCallback(async (capture: WorkspaceCaptureListItem) => {
    if (capture.kind === 'workspace') {
      await updateWorkspaceCaptureStatus({
        action: 'delete',
        captureId: capture.id,
        sourceKey: capture.sourceKey,
        itemId: capture.sourceItemId || `workspace-${capture.id}`,
      });
      return;
    }

    if (capture.sourceKey) {
      pendingCaptureStatusBySourceKeyRef.current.set(capture.sourceKey, 'delete');
    }
    deleteLocalCollectionItem(resolveCollectionListSourceItem(capture));
  }, [deleteLocalCollectionItem, resolveCollectionListSourceItem, updateWorkspaceCaptureStatus]);

  const editWorkspaceCaptureFromList = useCallback((capture: WorkspaceCaptureMessage, mode: WorkspaceCaptureEditorMode) => {
    openWorkspaceCaptureEditor(capture, mode);
  }, [openWorkspaceCaptureEditor]);

  const openCollectionMessageMenu = useCallback((itemId: string) => {
    setMobileCollectionSheet(null);
    setConfirmCollectionDeleteId(null);
    setActiveCollectionMessageMenuId(itemId);
  }, []);

  const closeCollectionMessageMenu = useCallback(() => {
    setActiveCollectionMessageMenuId(null);
    setConfirmCollectionDeleteId(null);
  }, []);

  const cancelCollectionMessageLongPress = useCallback(() => {
    if (collectionLongPressTimerRef.current) {
      clearTimeout(collectionLongPressTimerRef.current);
      collectionLongPressTimerRef.current = null;
    }
  }, []);

  const beginCollectionMessageLongPress = useCallback((itemId: string) => {
    cancelCollectionMessageLongPress();
    collectionLongPressTriggeredRef.current = false;
    collectionLongPressTimerRef.current = window.setTimeout(() => {
      collectionLongPressTriggeredRef.current = true;
      openCollectionMessageMenu(itemId);
    }, 360);
  }, [cancelCollectionMessageLongPress, openCollectionMessageMenu]);

  const {
    status: composerVoiceStatus,
    isRecording: isComposerVoiceRecording,
    interimText: composerVoiceInterimText,
    stopRecording: stopComposerVoiceInput,
    toggleRecording: toggleComposerVoiceInput,
  } = useVoiceInput({
    onTranscript: appendToCollectionComposer,
    onError: (message) => {
      setSourceImportError(message || '语音听写暂时没接住，请稍后再试。');
    },
  });

  const toggleComposerDictation = useCallback(async () => {
    if (showMobileRecorder || isRecording) {
      setSourceImportError('先结束原声，再开始听写。');
      return;
    }

    setSourceImportError('');
    setMobileCollectionSheet(null);
    collectionComposerRef.current?.blur();
    await toggleComposerVoiceInput();
  }, [isRecording, showMobileRecorder, toggleComposerVoiceInput]);

  const settleWechatCaptureEntry = useCallback((nextItem: SourceIngestItem) => {
    suppressNextCollectionPulsePreviewRef.current = true;
    setViewMode('record');
    setMobileSubPage(null);
    setMobileCollectionSheet(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setShowMobileRecorder(false);
    setSelectedConfusion(null);
    setConfusionChatAnchor(null);
    setSelectedAnchor(null);
    setActiveCollectionMessageMenuId(null);
    setConfirmCollectionDeleteId(null);
    setIsCollectionContextSelectionMode(false);
    setConfirmSelectedCollectionDelete(false);
    setSelectedCollectionContextIds([]);
    setSelectedCollectionPrimaryId(null);
    setQuotedCollectionContextIds([nextItem.id]);
    setQuotedCollectionPrimaryId(nextItem.id);
    setCaptureDrivenPulse(null);
    setShowCollectionPulsePreview(false);
    setMobileAIQuestion('');
    setMobileAIDisplayQuestion('');
    setMobileAILaunchImages([]);
    setMobileAILaunchSupportContextText('');
    setMobileAIConsumedQuestionNonce(null);
    setMobileAIPreferSelectedContext(false);
    setMobileAILaunchTarget(null);

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const textarea = collectionComposerRef.current;
        if (!textarea) return;
        textarea.focus();
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
        textarea.scrollIntoView({ block: 'nearest' });
      });
    }
  }, []);

  useEffect(() => {
    if (!wechatCaptureToken) return;
    if (importedWechatCaptureTokensRef.current.has(wechatCaptureToken)) return;

    const sessionStorageKey = `wechat-capture:${wechatCaptureToken}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(sessionStorageKey) === '1') {
      importedWechatCaptureTokensRef.current.add(wechatCaptureToken);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/wechat/capture/${encodeURIComponent(wechatCaptureToken)}`);
        const payload = await readJsonApiResponse<{ success: boolean; message?: WechatCaptureMessage; error?: string }>(
          response,
          '读取微信收集失败'
        );

        if (!response.ok || !payload.success || !payload.message) {
          throw new Error(payload.error || '读取微信收集失败');
        }

        if (cancelled) return;

        const message = payload.message;
        const sourceItemId = `wechat-${message.linkToken}`;
        const sourceType = inferWechatCaptureSourceType(message);
        const role = inferWechatCaptureRole(message);
        const title = inferWechatCaptureTitle(message);
        const preview = compactText(
          message.normalizedText?.trim() || message.previewText?.trim() || title,
          180
        );
        const addedAt = message.messageAt || new Date().toISOString();

        setWorkspaceCaptures((prev) =>
          mergeWorkspaceCaptures(prev, [
            {
              id: `wechat-capture-${message.linkToken}`,
              sourceKey: `wechat:${message.linkToken}`,
              sourceType: 'wechat',
              role,
              contentType: sourceType === 'document' ? 'link' : sourceType,
              title,
              previewText: preview,
              normalizedText: message.normalizedText || null,
              sourceUrl: message.sourceUrl || null,
              mediaUrl: message.mediaUrl || null,
              tutorContext: message.tutorContext || null,
              occurredAt: addedAt,
              createdAt: addedAt,
              metadata: null,
            },
          ])
        );

        const nextItem = buildWechatCaptureSourceItem(message);
        setSourceItems((prev) => {
          const index = prev.findIndex(
            (item) => item.id === nextItem.id || resolveSourceItemSourceKey(item) === nextItem.sourceKey
          );

          if (index < 0) {
            return [...prev, nextItem];
          }

          const next = [...prev];
          next[index] = {
            ...prev[index],
            ...nextItem,
          };
          return next;
        });

        const tutorSnippet = (message.tutorContext || message.normalizedText || '').trim();
        if (tutorSnippet) {
          setSupportReferences((prev) => mergeSupportReferences(prev, [{
            id: sourceItemId,
            title: getSupportReferenceDisplayTitle(nextItem),
            snippet: compactText(tutorSnippet, 2800),
          }]));
        }

        settleWechatCaptureEntry(nextItem);
        toast.success(message.echoTitle?.trim() || '这条微信内容已经接进当前收集');

        if (isAuthenticated && user?.id && accessToken) {
          void refreshDailyEcho();
        }

        importedWechatCaptureTokensRef.current.add(wechatCaptureToken);
        setSourceImportError('');
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(sessionStorageKey, '1');
          const url = new URL(window.location.href);
          url.searchParams.delete('wechat_capture');
          window.history.replaceState({}, '', url.toString());
        }

      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setSourceImportError(message || '这条微信收集还没接进来，请稍后再试。');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, isAuthenticated, refreshDailyEcho, settleWechatCaptureEntry, user?.id, wechatCaptureToken]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !accessToken) return;

    const requestKey = `${user.id}:${wechatCaptureToken || ''}`;
    if (workspaceContextRequestKeyRef.current === requestKey) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/workspace/current?includeArchived=1', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const payload = await readJsonApiResponse<{
          success: boolean;
          workspace?: { id: string; name: string };
          captures?: WorkspaceCaptureMessage[];
          echoes?: WorkspaceEchoMessage[];
          error?: string;
        }>(response, '读取当前工作区失败');

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '读取当前工作区失败');
        }

        if (cancelled) return;

          const captures = Array.isArray(payload.captures) ? payload.captures : [];
          const activeCaptures = captures.filter((item) => (item.status || 'active') === 'active');
          const echoes = Array.isArray(payload.echoes) ? payload.echoes : [];

          if (captures.length > 0) {
            setWorkspaceCaptures((prev) => mergeWorkspaceCaptures(prev, captures));
            setSourceItems((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const existingSourceKeys = new Set(
              prev
                .map((item) => resolveSourceItemSourceKey(item))
                .filter((item): item is string => Boolean(item))
            );
            const next = [...prev];

              for (const item of activeCaptures) {
                const id = `workspace-${item.id}`;
                if (existingIds.has(id)) continue;
                if (item.sourceKey && existingSourceKeys.has(item.sourceKey)) continue;
              next.push(buildWorkspaceCaptureSourceItem(item));
              existingIds.add(id);
              if (item.sourceKey) {
                existingSourceKeys.add(item.sourceKey);
              }
            }

            return next;
          });

            const incomingReferences = activeCaptures
              .map((item) => {
                const snippet = (item.tutorContext || item.normalizedText || '').trim();
                if (!snippet) return null;
                const sourceItem = buildWorkspaceCaptureSourceItem(item);
                return {
                  id: `workspace-${item.id}`,
                  title: getSupportReferenceDisplayTitle(sourceItem),
                  snippet: compactText(snippet, 2800),
                };
              })
            .filter((item): item is SupportReferenceItem => Boolean(item));

          if (incomingReferences.length > 0) {
            setSupportReferences((prev) => mergeSupportReferences(prev, incomingReferences));
          }
        }

        if (echoes.length > 0) {
          setWorkspaceEchoes((prev) => mergeWorkspaceEchoes(prev, echoes));
        }

        workspaceContextRequestKeyRef.current = requestKey;
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error('[workspace.current]', message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, isAuthenticated, user?.id, wechatCaptureToken]);

  useEffect(() => {
    if (workspaceCaptures.length === 0) return;

    setSourceItems((prev) =>
      mergeWechatWorkspaceCapturesIntoSourceItems(
        prev,
        workspaceCaptures.filter((item) => (item.status || 'active') === 'active')
      )
    );
  }, [workspaceCaptures]);

  useEffect(() => {
    if (!captureDrivenPulse) return;

    const timer = window.setTimeout(() => {
      setCaptureDrivenPulse(null);
    }, 12000);

    return () => window.clearTimeout(timer);
  }, [captureDrivenPulse]);

  const collectionPulse = useMemo<CollectionPulseState | null>(() => {
    if (captureDrivenPulse) {
      return captureDrivenPulse;
    }

    if (collectionFeedItems.length === 0) return null;

    const latestItem = collectionFeedItems[collectionFeedItems.length - 1];
    const primaryCount = collectionFeedItems.filter((item) => item.role === 'primary').length;
    const supportCount = collectionFeedItems.filter((item) => item.role === 'support').length;
    const audioCount = collectionFeedItems.filter((item) => item.type === 'audio').length;
    const textCount = collectionFeedItems.filter((item) => item.type === 'text').length;
    const documentCount = collectionFeedItems.filter((item) => item.type === 'document').length;
    const imageCount = collectionFeedItems.filter((item) => item.type === 'image').length;
    const videoCount = collectionFeedItems.filter((item) => item.type === 'video').length;

    const chips: string[] = [];
    if (audioCount > 0) chips.push(`${audioCount} 段课堂原话`);
    if (documentCount > 0) chips.push(`${documentCount} 份材料`);
    if (imageCount > 0) chips.push(`${imageCount} 张图片材料`);
    if (textCount > 0) chips.push(`${textCount} 条你的想法`);
    if (videoCount > 0) chips.push(`${videoCount} 个视频来源`);

    if (showMobileRecorder || isRecording) {
      return {
        title: '正在发酵',
        body: '这段语音正在和前面的内容一起长进同一条学习线索里，你不用先整理它。',
        chips: chips.slice(0, 3),
        actions: [],
      };
    }

    if (primaryCount > 0 && supportCount > 0) {
      return {
        title: '发酵回声',
        body: '你已经把课堂原话和补充材料放进了同一条线索。后面不需要总结，继续轻轻往里加就行。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'continue-voice', label: '再录一段' },
          { key: 'capture-confusion', label: '补一句困惑' },
        ],
      };
    }

    if (audioCount >= 2) {
      return {
        title: '发酵回声',
        body: '你已经连续留下了几段课堂原话，这节课的主线开始显出来了。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'capture-confusion', label: '记下没懂的点' },
          { key: 'add-material', label: '贴一份讲义' },
        ],
      };
    }

    if (audioCount > 0 && textCount > 0) {
      return {
        title: '发酵回声',
        body: '你不只是在收课堂内容，也已经留下了自己的理解或困惑，这会让后面的 Tutor 更有抓手。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'continue-voice', label: '继续录音' },
          { key: 'add-material', label: '补充材料' },
        ],
      };
    }

    if (latestItem.type === 'document' || latestItem.type === 'image' || latestItem.type === 'video') {
      return {
        title: '发酵回声',
        body: '这份材料已经接进来了。后面再补一句当时没懂的地方，系统会更容易看出联系。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'capture-confusion', label: '记下没懂的点' },
          { key: 'continue-voice', label: '录一段原话' },
        ],
      };
    }

    if (latestItem.type === 'audio') {
      return {
        title: '发酵回声',
        body: '这段原话已经留下来了。先别急着整理，继续往里丢材料或困惑，会更有价值。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'capture-confusion', label: '补一句困惑' },
          { key: 'add-material', label: '贴一份材料' },
        ],
      };
    }

    return {
      title: '发酵回声',
      body: '这条收集流已经开始有自己的形状了。继续轻轻追加，不用一次说完整。',
      chips: chips.slice(0, 3),
      actions: [
        { key: 'continue-voice', label: '继续录音' },
        { key: 'capture-confusion', label: '写一句想法' },
      ],
    };
  }, [captureDrivenPulse, collectionFeedItems, isRecording, showMobileRecorder]);

  const collectionPulseSignature = useMemo(() => {
    if (!collectionPulse) return '';
    return [
      collectionPulse.title,
      collectionPulse.body,
      collectionPulse.chips.join('|'),
      (collectionPulse.actions || []).map((action) => action.key).join('|'),
    ].join('::');
  }, [collectionPulse]);

  const echoFilterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    workspaceEchoes.forEach((echo) => {
      echo.chips.forEach((chip) => {
        if (!chip) return;
        counts.set(chip, (counts.get(chip) || 0) + 1);
      });
    });

    return [
      '全部',
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([chip]) => chip),
    ];
  }, [workspaceEchoes]);

  const filteredWorkspaceEchoes = useMemo(() => {
    if (selectedEchoChip === '全部') return workspaceEchoes;
    return workspaceEchoes.filter((echo) => echo.chips.includes(selectedEchoChip));
  }, [selectedEchoChip, workspaceEchoes]);

  const latestWorkspaceEchoId = workspaceEchoes[0]?.id || null;

  const historyWorkspaceEchoes = useMemo(() => {
    if (!latestWorkspaceEchoId) return filteredWorkspaceEchoes;
    return filteredWorkspaceEchoes.filter((echo) => echo.id !== latestWorkspaceEchoId);
  }, [filteredWorkspaceEchoes, latestWorkspaceEchoId]);

  const groupedWorkspaceEchoes = useMemo(() => {
    const groups: Record<'today' | 'week' | 'earlier', WorkspaceEchoMessage[]> = {
      today: [],
      week: [],
      earlier: [],
    };

    historyWorkspaceEchoes.forEach((echo) => {
      groups[resolveEchoTimeBucket(resolveEchoDisplayTime(echo))].push(echo);
    });

    return groups;
  }, [historyWorkspaceEchoes]);

  const _echoHistorySections = useMemo(
    () =>
      (['today', 'week', 'earlier'] as const)
        .map((bucket) => ({
          key: bucket,
          label: getEchoBucketLabel(bucket),
          items: groupedWorkspaceEchoes[bucket],
        }))
        .filter((section) => section.items.length > 0),
    [groupedWorkspaceEchoes]
  );

  const _latestEchoForCenter = useMemo(() => {
    if (workspaceEchoes.length === 0) return null;

    const latest = workspaceEchoes[0];
    return {
      id: latest.id,
      title: latest.title,
      body: latest.body,
      chips: latest.chips,
      recommendations: Array.isArray(latest.recommendations) ? latest.recommendations : [],
      memory: latest.memory || null,
      updatedAt: resolveEchoDisplayTime(latest),
    };
  }, [workspaceEchoes]);

  const _latestEchoIsToday = useMemo(() => {
    if (!_latestEchoForCenter?.updatedAt) return false;
    return resolveEchoTimeBucket(_latestEchoForCenter.updatedAt) === 'today';
  }, [_latestEchoForCenter]);

  const canRequestManualEcho = Boolean(isAuthenticated && user?.id && accessToken);

  const manualEchoButtonLabel = useMemo(() => {
    if (isManualEchoRefreshing) return '生成中...';
    if (isCheckingAuth) return '确认中...';
    if (!canRequestManualEcho) {
      return isGuestFastEntry ? '登录后测试' : '登录后生成';
    }
    return '测试生成';
  }, [canRequestManualEcho, isCheckingAuth, isGuestFastEntry, isManualEchoRefreshing]);

  const renderManualEchoTriggerButton = useCallback(
    (className: string) => {
      if (!ENABLE_ECHO_MANUAL_TRIGGER) return null;

      return (
        <button
          type="button"
          disabled={isManualEchoRefreshing}
          onClick={() => {
            void refreshDailyEcho({ force: true });
          }}
          className={className}
        >
          <span className="inline-flex items-center gap-2">
            {isManualEchoRefreshing ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
              />
            ) : null}
            <span>{manualEchoButtonLabel}</span>
          </span>
        </button>
      );
    },
    [isManualEchoRefreshing, manualEchoButtonLabel, refreshDailyEcho]
  );

  const manualEchoFeedbackView =
    ENABLE_ECHO_MANUAL_TRIGGER && manualEchoFeedback ? (
      <div
        aria-live="polite"
        role="status"
        className={`mt-3 rounded-[16px] border px-3 py-2.5 ${getManualEchoFeedbackClasses(manualEchoFeedback.tone)}`}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/70">
            {manualEchoFeedback.tone === 'pending' ? (
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
              />
            ) : manualEchoFeedback.tone === 'success' ? (
              <Sparkles size={12} />
            ) : manualEchoFeedback.tone === 'error' ? (
              <AlertCircle size={12} />
            ) : (
              <Clock size={12} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold leading-5">{manualEchoFeedback.title}</p>
            <p className="text-[11px] leading-5 text-current/75">{manualEchoFeedback.body}</p>
          </div>
        </div>
      </div>
    ) : null;

  const manualEchoDebugView =
    ENABLE_ECHO_MANUAL_TRIGGER && manualEchoDebugNote ? (
      <details className="mt-2 text-[11px] leading-5 text-slate-500">
        <summary className="list-none cursor-pointer select-none text-slate-400 [&::-webkit-details-marker]:hidden">
          查看测试信息
        </summary>
        <p className="mt-2 rounded-[14px] bg-slate-50 px-3 py-2 text-slate-500">{manualEchoDebugNote}</p>
      </details>
    ) : null;

  const captureActivitySummary = useMemo(() => {
    const now = new Date();
    const dayKeys = new Map<string, number>();

    collectionFeedItems.forEach((item) => {
      const date = new Date(item.addedAt);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      const key = date.toISOString().slice(0, 10);
      dayKeys.set(key, (dayKeys.get(key) || 0) + 1);
    });

    const tiles = Array.from({ length: 28 }, (_, index) => {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(now.getDate() - (27 - index));
      const key = date.toISOString().slice(0, 10);
      const count = dayKeys.get(key) || 0;
      return {
        key,
        count,
      };
    });

    const activeDays = tiles.filter((tile) => tile.count > 0).length;

    let streak = 0;
    for (let index = tiles.length - 1; index >= 0; index -= 1) {
      if (tiles[index].count > 0) {
        streak += 1;
      } else {
        break;
      }
    }

    const kindCounts = collectionFeedItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});

    const typeLabelMap: Record<string, string> = {
      audio: '录音',
      video: '视频',
      image: '图片',
      document: '材料',
      text: '想法',
    };

    const topKinds = Object.entries(kindCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => typeLabelMap[type] || type);

    return {
      totalCount: collectionFeedItems.length,
      activeDays,
      streak,
      tiles,
      topKinds,
    };
  }, [collectionFeedItems]);

  useEffect(() => {
    if (!collectionPulseSignature || isRecording || showMobileRecorder) {
      setShowCollectionPulsePreview(false);
      return;
    }

    if (suppressNextCollectionPulsePreviewRef.current) {
      suppressNextCollectionPulsePreviewRef.current = false;
      lastCollectionPulseSignatureRef.current = collectionPulseSignature;
      setShowCollectionPulsePreview(false);
      return;
    }

    if (lastCollectionPulseSignatureRef.current === collectionPulseSignature) {
      return;
    }

    lastCollectionPulseSignatureRef.current = collectionPulseSignature;
    setShowCollectionPulsePreview(true);
    const timer = window.setTimeout(() => {
      setShowCollectionPulsePreview(false);
    }, 3600);

    return () => window.clearTimeout(timer);
  }, [collectionPulseSignature, isRecording, showMobileRecorder]);

  useEffect(() => {
    if (!echoFilterOptions.includes(selectedEchoChip)) {
      setSelectedEchoChip('全部');
    }
  }, [echoFilterOptions, selectedEchoChip]);

  async function importVideoLinkIntoSourceItem(
    url: string,
    options?: {
      sourceItemId?: string;
      optimisticTitle?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
    }
  ): Promise<boolean> {
    const detected = parseVideoLink(url);
    const targetSourceId = options?.sourceItemId || `video-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTitle = options?.optimisticTitle || (() => {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./i, '');
        if (detected?.providerLabel) {
          return `${detected.providerLabel} 链接`;
        }
        return hostname || '视频链接';
      } catch {
        return detected?.providerLabel ? `${detected.providerLabel} 链接` : '视频链接';
      }
    })();

    if (options?.sourceItemId) {
      updateSourceItem(targetSourceId, {
        type: 'video',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        mediaUrl: detected?.playableUrl || url,
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: undefined,
        reviewable: false,
      });
    } else {
      appendSourceItem({
        id: targetSourceId,
        type: 'video',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        mediaUrl: detected?.playableUrl || url,
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: undefined,
        reviewable: false,
      });
    }

    setActiveSourceImportCount((count) => count + 1);
    setSourceImportError('');

    try {
      const response = await fetch('/api/video/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          mode: 'turbo',
          language: 'zh',
        }),
      });

      const payload = await readJsonApiResponse<{
        success?: boolean;
        error?: string;
        sourceMode?: ImportedVideoResult['sourceMode'];
        trace?: ImportedVideoSource['importTrace'];
        source?: Partial<ImportedVideoSource>;
        segments?: TranscriptSegment[];
        sentences?: Array<{
          id?: string;
          text?: string;
          beginTime?: number;
          endTime?: number;
          confidence?: number;
        }>;
      }>(response, '链接解析失败');

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '链接解析失败');
      }

      const segments = normalizeImportedVideoSegments(payload);
      if (segments.length === 0) {
        updateSourceItem(targetSourceId, {
          title: payload.source?.title || optimisticTitle,
          previewUrl: payload.source?.thumbnailUrl,
          mediaUrl: payload.source?.playableUrl || detected?.playableUrl || url,
          attachmentUrl: payload.source?.originalUrl || url,
          status: 'failed',
          statusText: '这条链接先收下了，稍后再试试',
        });
        return false;
      }

      await handleVideoImportReady({
        segments,
        source: {
          provider: payload.source?.provider || detected?.provider || 'generic',
          providerLabel: payload.source?.providerLabel || detected?.providerLabel || 'Web Video',
          originalUrl: payload.source?.originalUrl || url,
          resolvedUrl: payload.source?.resolvedUrl,
          embedUrl: payload.source?.embedUrl || detected?.embedUrl,
          playableUrl: payload.source?.playableUrl || detected?.playableUrl || url,
          title: payload.source?.title,
          durationSec: payload.source?.durationSec,
          thumbnailUrl: payload.source?.thumbnailUrl,
          audioUrl: payload.source?.audioUrl,
          sourceMode: payload.source?.sourceMode || payload.sourceMode,
          bvid: payload.source?.bvid,
          cid: payload.source?.cid,
          importTrace: payload.source?.importTrace || payload.trace,
        },
        sourceMode: payload.sourceMode,
        trace: payload.trace,
      }, {
        sourceItemId: targetSourceId,
        persistSourceKey: options?.persistSourceKey,
        persistSourceType: options?.persistSourceType,
        persistRole: options?.persistRole,
        occurredAt: options?.occurredAt,
      });

      return true;
    } catch {
      updateSourceItem(targetSourceId, {
        status: 'failed',
        statusText: '这条链接先收下了，稍后再试试',
      });
      return false;
    } finally {
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
    }
  }

  async function importArticleLinkIntoSourceItem(
    url: string,
    options?: {
      sourceItemId?: string;
      optimisticTitle?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
    }
  ): Promise<boolean> {
    const detected = parseVideoLink(url);
    const targetSourceId = options?.sourceItemId || `article-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTitle = options?.optimisticTitle || (() => {
      try {
        if (detected?.providerLabel) {
          return `${detected.providerLabel} 文章`;
        }
        const hostname = new URL(url).hostname.replace(/^www\./i, '');
        return hostname || '图文链接';
      } catch {
        return detected?.providerLabel ? `${detected.providerLabel} 文章` : '图文链接';
      }
    })();

    if (options?.sourceItemId) {
      updateSourceItem(targetSourceId, {
        type: 'text',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: '正在提取文章内容…',
        reviewable: false,
      });
    } else {
      appendSourceItem({
        id: targetSourceId,
        type: 'text',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: '正在提取文章内容…',
        reviewable: false,
      });
    }

    setActiveSourceImportCount((count) => count + 1);
    setSourceImportError('');

    try {
      const response = await fetch('/api/article/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          provider: detected?.provider,
        }),
      });

      const payload = await readJsonApiResponse<{
        success?: boolean;
        error?: string;
        title?: string;
        content?: string;
        text?: string;
        description?: string;
        author?: string;
        wordCount?: number;
        source?: {
          provider?: string;
          providerLabel?: string;
          originalUrl?: string;
          extractMethod?: string;
        };
        segments?: TranscriptSegment[];
        sentences?: Array<{
          id?: string;
          text?: string;
          beginTime?: number;
          endTime?: number;
          confidence?: number;
        }>;
      }>(response, '文章提取失败');

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '文章提取失败');
      }

      const segments = normalizeImportedVideoSegments(payload);
      if (segments.length === 0) {
        updateSourceItem(targetSourceId, {
          title: payload.title || optimisticTitle,
          attachmentUrl: url,
          status: 'failed',
          statusText: '文章内容为空，稍后再试试',
        });
        return false;
      }

      await handleVideoImportReady({
        segments,
        source: {
          provider: payload.source?.provider || detected?.provider || 'generic',
          providerLabel: payload.source?.providerLabel || detected?.providerLabel || '图文',
          originalUrl: payload.source?.originalUrl || url,
          playableUrl: url,
          title: payload.title,
        },
      }, {
        sourceItemId: targetSourceId,
        persistSourceKey: options?.persistSourceKey,
        persistSourceType: options?.persistSourceType,
        persistRole: options?.persistRole,
        occurredAt: options?.occurredAt,
      });

      return true;
    } catch {
      updateSourceItem(targetSourceId, {
        status: 'failed',
        statusText: '文章提取失败，稍后再试试',
      });
      return false;
    } finally {
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
    }
  }

  const importComposerVideoLink = useCallback(async (url: string) => {
    // 根据 channel 类型分发到对应的 import 函数
    if (composerReach.channel === 'article-link') {
      await importArticleLinkIntoSourceItem(url);
    } else {
      await importVideoLinkIntoSourceItem(url);
    }
  }, [importVideoLinkIntoSourceItem, importArticleLinkIntoSourceItem, composerReach.channel]);

  const openLiveRecorder = useCallback(() => {
    if (isRecording) return;

    if (isComposerVoiceRecording) {
      void stopComposerVoiceInput();
    }

    setSourceImportError('');
    setMobileCollectionSheet(null);
    setRecorderAutoStartSignal(0);
    flushSync(() => {
      setDataSource('live');
      setShowMobileRecorder(true);
    });

    const startRecordingNow = () => {
      if (recorderRef.current) {
        void recorderRef.current.startRecording();
      } else {
        setRecorderAutoStartSignal(Date.now());
      }
    };

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(startRecordingNow);
    } else {
      startRecordingNow();
    }
  }, [isComposerVoiceRecording, isRecording, stopComposerVoiceInput]);

  const handleCollectionComposerSubmit = useCallback(async () => {
    const text = collectionComposerText.trim();
    if (!text) return;

    const inlineUrl = composerDetectedUrl;
    const canAutoImportLink = Boolean(inlineUrl && composerCanAutoImportLink);
    const noteText = canAutoImportLink && inlineUrl
      ? text.replace(inlineUrl, '').replace(/\s+/g, ' ').trim()
      : text;
    const quotedItems = quotedCollectionContextItems;
    const quotedPrimaryId = resolveCollectionContextPrimaryId(quotedItems, quotedCollectionPrimaryId);
    const quotedPrimaryItem = quotedItems.find((item) => item.id === quotedPrimaryId) || quotedItems[0] || null;
    const quotedSourceKeys = quotedItems
      .map((item) => resolveSourceItemSourceKey(item))
      .filter((item): item is string => Boolean(item));

    if (noteText) {
      const nextStartMs =
        segmentsRef.current.length > 0
          ? (segmentsRef.current[segmentsRef.current.length - 1]?.endMs || 0) + 1200
          : 0;

      const draftId = `quick-note-${Date.now()}`;
      const draftTitle = `随手记录 ${new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
      const appended = appendSupportSource({
        id: draftId,
        sourceKey: `manual:${draftId}`,
        type: 'text',
        title: draftTitle,
        segments: [
          {
            id: `${draftId}-seg-1`,
            text: noteText,
            startMs: nextStartMs,
            endMs: nextStartMs + 2400,
            confidence: 1,
            isFinal: true,
          },
        ],
      });

      void persistCaptureToWorkspace({
        sourceType: 'manual-note',
        sourceKey: `manual:${draftId}`,
        role: 'support',
        contentType: inlineUrl && !canAutoImportLink ? 'link' : 'text',
        title: draftTitle,
        previewText: compactText(noteText, 180),
        normalizedText: appended.reference || noteText,
        sourceUrl: inlineUrl && !canAutoImportLink ? inlineUrl : undefined,
        tutorContext: noteText,
        occurredAt: new Date().toISOString(),
        metadata: {
          from: 'collection-composer',
          quotedSourceItemIds: quotedItems.map((item) => item.id),
          quotedSourceKeys,
          quotedPrimaryId,
          quotedPrimaryTitle: quotedPrimaryItem?.title || null,
        },
      });
    }

    setCollectionComposerText('');
    setSourceImportError('');
    clearQuotedCollectionContext();

    if (canAutoImportLink && inlineUrl) {
      void importComposerVideoLink(inlineUrl);
      return;
    }
  }, [
    appendSupportSource,
    collectionComposerText,
    composerCanAutoImportLink,
    composerDetectedUrl,
    clearQuotedCollectionContext,
    importComposerVideoLink,
    persistCaptureToWorkspace,
    quotedCollectionContextItems,
    quotedCollectionPrimaryId,
  ]);

  const handleCollectionComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || []);
    if (items.length === 0) return;

    const pastedFiles = items
      .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
      .filter((file): file is File => Boolean(file));

    if (pastedFiles.length === 0) return;

    event.preventDefault();
    setSourceImportError('');
    void handleImportFiles(pastedFiles, 'all');

  }, [handleImportFiles]);

  const handleCollectionPulseAction = useCallback((actionKey: string) => {
    switch (actionKey) {
      case 'continue-voice':
        openLiveRecorder();
        return;
      case 'capture-confusion':
        nudgeComposer('我现在没懂的是：');
        return;
      case 'add-material':
        handleSourceFileButtonClick('all');
        return;
      default:
        return;
    }
  }, [handleSourceFileButtonClick, nudgeComposer, openLiveRecorder]);

  const blobToDataUrl = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('图片读取失败'));
      };
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }, []);

  const buildTutorLaunchImages = useCallback(async (items: SourceIngestItem[] = []): Promise<TutorLaunchImageAsset[]> => {
    const imageItems = items.filter((item) => item.type === 'image').slice(0, 4);
    if (imageItems.length === 0) return [];

    const resolvedImages: Array<TutorLaunchImageAsset | null> = await Promise.all(
      imageItems.map(async (item) => {
        const previewUrl = item.previewUrl || item.mediaUrl || item.attachmentUrl || '';
        const candidates = Array.from(
          new Set(
            [item.previewUrl, item.mediaUrl, item.attachmentUrl].filter(
              (value): value is string => Boolean(value && value.trim())
            )
          )
        );

        for (const candidate of candidates) {
          const normalized = candidate.trim();
          if (!normalized) continue;

          if (normalized.startsWith('data:image/')) {
            return {
              id: item.id,
              name: item.title || '图片',
              url: normalized,
              previewUrl: item.previewUrl || normalized,
            } satisfies TutorLaunchImageAsset;
          }

          try {
            const response = await fetch(normalized);
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob.type.startsWith('image/')) continue;
            const dataUrl = await blobToDataUrl(blob);
            return {
              id: item.id,
              name: item.title || '图片',
              url: dataUrl,
              previewUrl: previewUrl || dataUrl,
            } satisfies TutorLaunchImageAsset;
          } catch {
            if (/^https?:\/\//i.test(normalized)) {
              return {
                id: item.id,
                name: item.title || '图片',
                url: normalized,
                previewUrl: previewUrl || normalized,
              } satisfies TutorLaunchImageAsset;
            }
          }
        }

        return null;
      })
    );

    return resolvedImages.filter((item): item is TutorLaunchImageAsset => Boolean(item));
  }, [blobToDataUrl]);

  const buildTutorPromptForCollectionItem = useCallback((item: SourceIngestItem) => {
    const label = getCollectionContextTypeLabel(item.type);
    const focus = getCollectionContextDisplayTitle(item, 48);
    const snippet = compactText((item.fullText || item.preview || item.title || '').trim(), 120);
    if (item.type === 'image') {
      return compactMultilineText(
        `请先看我刚选的这张${label}，直接告诉我图里最值得抓住的关键点；如果信息还不完整，也先说现在能判断什么。\n重点：${focus}\n补充识别：${snippet}`,
        260
      );
    }
    if (item.type === 'text') {
      return compactMultilineText(
        `顺着这条${label}继续帮我讲清楚，先直接说这段内容最核心在讲什么；如果只看这一条还不完整，也先告诉我现在能确定什么。\n当前内容：${focus}\n摘录：${snippet}`,
        280
      );
    }

    return compactMultilineText(
      `顺着这条${label}继续带我理解，先围绕它现在最关键的一点讲清楚；如果信息还不完整，也先告诉我能确定什么，再给我一个最值得继续追问的问题。\n当前内容：${focus}\n摘录：${snippet}`,
      280
    );
  }, []);

  const buildTutorPromptForCollectionGroup = useCallback((primaryItem: SourceIngestItem) => {
    const label = getCollectionContextTypeLabel(primaryItem.type);
    const focus = getCollectionContextDisplayTitle(primaryItem, 48);
    const snippet = compactText((primaryItem.fullText || primaryItem.preview || primaryItem.title || '').trim(), 140);
    if (primaryItem.type === 'image') {
      return compactMultilineText(
        `请结合我刚圈出的这组内容，先看这张${label}里最值得抓住的关键点；如果信息还不完整，也先说现在最可靠的判断。\n重点：${focus}\n补充识别：${snippet}`,
        260
      );
    }
    return compactMultilineText(
      `请围绕我刚圈出的这组内容继续讲，先抓住这条${label}和其他内容最关键的关系；如果信息还不完整，也先说现在最值得抓住的一点。\n重点：${focus}\n参考：${snippet}`,
      280
    );
  }, []);

  const openTutorFromCollection = useCallback((
    initialPrompt?: string,
    options?: {
      preferSelectedContext?: boolean;
      displayText?: string;
      launchImages?: TutorLaunchImageAsset[];
      supportContextText?: string;
    }
  ) => {
    setMobileCollectionSheet(null);
    setShowCollectionPulsePreview(false);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setShowMobileRecorder(false);
    setSelectedConfusion(null);
    setConfusionChatAnchor(null);
    setSelectedAnchor(null);
    setMobileAIQuestion(initialPrompt || '');
    setMobileAIDisplayQuestion(options?.displayText || '');
    setMobileAILaunchImages(options?.launchImages || []);
    setMobileAILaunchSupportContextText(options?.supportContextText || '');
    setMobileAIConsumedQuestionNonce(null);
    setMobileAIPreferSelectedContext(Boolean(options?.preferSelectedContext));
    setMobileAIQuestionNonce((prev) => prev + 1);
    setMobileAILaunchTarget(isMobile ? 'mobile-ai-chat' : videoSource ? 'video-chat' : 'review-panel');
    setViewMode('review');
    if (videoSource) {
      setVideoWorkspaceTab('chat');
    }
    if (isMobile) {
      setMobileSubPage('ai-chat');
    }
  }, [isMobile, videoSource]);

  const openTutorWithSelectedCollectionContext = useCallback(async () => {
    if (selectedCollectionContextItems.length === 0) return;

    const primaryId = resolveCollectionContextPrimaryId(selectedCollectionContextItems, selectedCollectionPrimaryId);
    const primaryItem = selectedCollectionContextItems.find((item) => item.id === primaryId) || selectedCollectionContextItems[0];
    const prompt = primaryItem ? buildTutorPromptForCollectionGroup(primaryItem) : undefined;
    const supportContextText = buildSelectedCollectionContextText({
      items: selectedCollectionContextItems,
      primaryId,
    });
    const launchImages = await buildTutorLaunchImages(selectedCollectionContextItems);
    clearCollectionContextSelection();
    openTutorFromCollection(prompt, {
      preferSelectedContext: true,
      launchImages,
      supportContextText,
    });
  }, [
    buildTutorLaunchImages,
    buildTutorPromptForCollectionGroup,
    clearCollectionContextSelection,
    openTutorFromCollection,
    selectedCollectionContextItems,
    selectedCollectionPrimaryId,
  ]);

  const applyBatchActionToSelectedCollectionContext = useCallback(async (action: 'archive' | 'delete') => {
    if (selectedCollectionContextItems.length === 0) return;
    if (action === 'delete' && !confirmSelectedCollectionDelete) {
      setConfirmSelectedCollectionDelete(true);
      return;
    }

    const items = [...selectedCollectionContextItems];
    clearCollectionContextSelection();

    let successCount = 0;
    for (const item of items) {
      const sourceKey = resolveSourceItemSourceKey(item);
      const capture =
        workspaceCaptures.find((entry) => entry.sourceKey === sourceKey) ||
        (item.id.startsWith('workspace-')
          ? workspaceCaptures.find((entry) => entry.id === item.id.slice('workspace-'.length))
          : null);

      if (!capture && !item.id.startsWith('workspace-')) {
        if (sourceKey) {
          pendingCaptureStatusBySourceKeyRef.current.set(sourceKey, action);
        }
        if (action === 'archive') {
          archiveLocalCollectionItem(item);
        } else {
          deleteLocalCollectionItem(item);
        }
        successCount += 1;
        continue;
      }

      const ok = await updateWorkspaceCaptureStatus({
        action,
        captureId: capture?.id,
        sourceKey: sourceKey || capture?.sourceKey || null,
        itemId: item.id,
        silent: true,
      });
      if (ok) {
        successCount += 1;
      }
    }

    if (successCount > 0) {
      toast.success(
        action === 'delete'
          ? `已彻底删除 ${successCount} 条收集`
          : `已先收起 ${successCount} 条收集`
      );
    } else {
      toast.error(action === 'delete' ? '批量删除失败，请稍后再试' : '批量收起失败，请稍后再试');
    }
  }, [
    clearCollectionContextSelection,
    confirmSelectedCollectionDelete,
    archiveLocalCollectionItem,
    deleteLocalCollectionItem,
    selectedCollectionContextItems,
    updateWorkspaceCaptureStatus,
    workspaceCaptures,
  ]);

  const openTutorFromCollectionItem = useCallback(async (item: SourceIngestItem) => {
    setSelectedCollectionContextIds([item.id]);
    setSelectedCollectionPrimaryId(item.id);
    setIsCollectionContextSelectionMode(false);
    setActiveCollectionMessageMenuId(null);

    let didRestoreSegments = false;

    // ── 视频 + 服务端转录 → 恢复 segments + videoSource ──
    if (item.type === 'video' && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0) {
      const sid = item.sessionId || `video-server-${item.id}-${Date.now()}`;
      const segs: TranscriptSegment[] = item.serverTranscriptSegments.map((s, i) => ({
        id: s.id || `server-${s.startMs ?? 0}-${i}`,
        text: s.text || '',
        startMs: s.startMs ?? 0,
        endMs: s.endMs ?? (s.startMs ?? 0) + 3000,
        confidence: 1,
        isFinal: true,
      }));
      setSegments(segs);
      segmentsRef.current = segs;
      liveSegmentsRef.current = segs;
      setSessionId(sid);
      sessionIdRef.current = sid;
      // 恢复 videoSource 让播放器工作
      const det = item.attachmentUrl ? parseVideoLink(item.attachmentUrl) : null;
      setVideoSource({
        provider: det?.provider || item.videoProvider || 'generic',
        providerLabel: det?.providerLabel || 'Web Video',
        originalUrl: item.attachmentUrl || item.mediaUrl || '',
        embedUrl: item.embedUrl || det?.embedUrl,
        playableUrl: item.mediaUrl || item.attachmentUrl || undefined,
        thumbnailUrl: item.previewUrl,
        title: item.title,
        durationSec: segs.length > 0 ? (segs[segs.length - 1].endMs || 0) / 1000 : undefined,
      });
      setDataSource('video');
      if (!item.sessionId) updateSourceItem(item.id, { sessionId: sid });
      didRestoreSegments = true;
    }

    // ── 音频/视频 + sessionId → 从 IndexedDB 恢复 segments ──
    if (!didRestoreSegments && item.sessionId && (item.type === 'audio' || item.type === 'video')) {
      try {
        const txs = await db.transcripts.where('sessionId').equals(item.sessionId).toArray();
        if (txs.length > 0) {
          const sorted = txs.sort((a, b) => a.startMs - b.startMs);
          const segs: TranscriptSegment[] = sorted.map((t, i) => ({
            id: `restored-${t.startMs}-${i}`,
            text: t.text,
            startMs: t.startMs,
            endMs: t.endMs,
            confidence: t.confidence,
            isFinal: t.isFinal,
          }));
          setSegments(segs);
          segmentsRef.current = segs;
          liveSegmentsRef.current = segs;
          setSessionId(item.sessionId);
          sessionIdRef.current = item.sessionId;
          if (item.type === 'audio' && item.mediaUrl) {
            setAudioBlob(null);
            setAudioUrl(item.mediaUrl);
          }
          if (item.durationMs) setSessionMediaDurationMs(item.durationMs);
          didRestoreSegments = true;
        }
      } catch (e) {
        console.error('[openTutorFromCollectionItem] IndexedDB restore failed:', e);
      }
    }

    const launchImages = await buildTutorLaunchImages([item]);
    const supportContextText = buildSelectedCollectionContextText({
      items: [item],
      primaryId: item.id,
    });
    // 有 segments 时关闭 preferSelectedContext → Tutor 走 [MM:SS] 时间戳格式
    openTutorFromCollection(buildTutorPromptForCollectionItem(item), {
      preferSelectedContext: !didRestoreSegments,
      launchImages,
      supportContextText,
    });
  }, [buildTutorLaunchImages, buildTutorPromptForCollectionItem, openTutorFromCollection]);

  const openTutorFromCollectionListItem = useCallback((capture: WorkspaceCaptureListItem) => {
    const sourceItem = resolveCollectionListSourceItem(capture);
    void openTutorFromCollectionItem(sourceItem);
    setMobileCollectionSheet(null);
  }, [openTutorFromCollectionItem, resolveCollectionListSourceItem]);

  useEffect(() => {
    if ((viewMode !== 'record' || showMobileRecorder) && isComposerVoiceRecording) {
      void stopComposerVoiceInput();
    }
  }, [isComposerVoiceRecording, showMobileRecorder, stopComposerVoiceInput, viewMode]);

  useEffect(() => {
    if (showMobileRecorder || viewMode !== 'record') {
      stopAudioMessagePlayback();
    }
  }, [showMobileRecorder, stopAudioMessagePlayback, viewMode]);

  const activeCollectionMessageMenuItem = useMemo(
    () => collectionFeedItems.find((item) => item.id === activeCollectionMessageMenuId) || null,
    [activeCollectionMessageMenuId, collectionFeedItems]
  );

  const activeCollectionMessageMenuSourceKey = useMemo(
    () => (activeCollectionMessageMenuItem ? resolveSourceItemSourceKey(activeCollectionMessageMenuItem) : null),
    [activeCollectionMessageMenuItem]
  );

  const activeCollectionMenuWorkspaceCapture = useMemo(() => {
    if (!activeCollectionMessageMenuItem) return null;

    const directId = activeCollectionMessageMenuItem.id.startsWith('workspace-')
      ? activeCollectionMessageMenuItem.id.slice('workspace-'.length)
      : null;

    return workspaceCaptures.find((item) => {
      if (directId && item.id === directId) return true;
      if (activeCollectionMessageMenuSourceKey && item.sourceKey === activeCollectionMessageMenuSourceKey) return true;
      return false;
    }) || null;
  }, [activeCollectionMessageMenuItem, activeCollectionMessageMenuSourceKey, workspaceCaptures]);

  const canUsePersistentCaptureActions = Boolean(
    activeCollectionMessageMenuSourceKey && isAuthenticated && accessToken && user?.id
  );
  const activeCollectionMessageMenuTitle = activeCollectionMessageMenuItem
    ? getCollectionContextDisplayTitle(activeCollectionMessageMenuItem, 48)
    : '';
  const activeCollectionMessageMenuPreview = activeCollectionMessageMenuItem
    ? compactMultilineText(
        activeCollectionMessageMenuItem.fullText?.trim() ||
          activeCollectionMessageMenuItem.preview?.trim() ||
          activeCollectionMessageMenuItem.title ||
          '',
        120
      )
    : '';
  const activeCollectionMessageMenuTypeLabel = activeCollectionMessageMenuItem
    ? getCollectionContextTypeLabel(activeCollectionMessageMenuItem.type)
    : '';

  const quotedCollectionPrimaryItem = useMemo(() => {
    if (quotedCollectionContextItems.length === 0) return null;
    const primaryId = resolveCollectionContextPrimaryId(quotedCollectionContextItems, quotedCollectionPrimaryId);
    return quotedCollectionContextItems.find((item) => item.id === primaryId) || quotedCollectionContextItems[0];
  }, [quotedCollectionContextItems, quotedCollectionPrimaryId]);

  const quotedCollectionSummaryText = useMemo(() => {
    if (quotedCollectionContextItems.length === 0) return '';
    if (quotedCollectionContextItems.length === 1 && quotedCollectionPrimaryItem) {
      return getCollectionContextDisplayTitle(quotedCollectionPrimaryItem, 42);
    }
    return quotedCollectionContextItems
      .slice(0, 2)
      .map((item) => getCollectionContextDisplayTitle(item, 20))
      .join(' · ');
  }, [quotedCollectionContextItems, quotedCollectionPrimaryItem]);

  const collectionComposerPlaceholder = useMemo(() => {
    if (quotedCollectionContextItems.length > 1) {
      return '继续顺着这几条内容写...';
    }
    if (quotedCollectionPrimaryItem) {
      return `继续顺着这条${getCollectionContextTypeLabel(quotedCollectionPrimaryItem.type)}写...`;
    }
    return '发一句想法，贴个链接，或者先把这节课丢进来';
  }, [quotedCollectionContextItems.length, quotedCollectionPrimaryItem]);

  const openCollectionItemOriginal = useCallback((item: SourceIngestItem) => {
    const url = item.attachmentUrl || item.mediaUrl || item.previewUrl;
    if (!url || typeof window === 'undefined') return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const renderMobileTopBar = useCallback(
    () => {
      const topBarStatus = isRecording
        ? '正在收一段原声'
        : activeSourceImportCount > 0
          ? `正在收进 ${activeSourceImportCount} 个文件`
          : '';

      return (
        <div className="flex-shrink-0 bg-[#F7F7F5] px-4 pb-1.5 pt-[max(env(safe-area-inset-top),6px)]">
          <div className="mx-auto flex w-full max-w-md items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setShowMobileRecorder(false);
                setMobileCollectionSheet('more');
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.04] hover:text-slate-600"
              aria-label="打开收集菜单"
            >
              <Menu size={18} />
            </button>
            <div className="flex min-w-0 flex-1 items-center justify-center">
              <MobileTabSwitch
                activeTab={viewMode}
                onTabChange={(tab) => handleViewModeChange(tab)}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMobileRecorder(false);
                setMobileCollectionSheet('history');
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-black/[0.04] hover:text-slate-600"
              aria-label="打开历史收集"
            >
              <History size={17} />
            </button>
          </div>
          {topBarStatus ? (
            <p className="mt-1 text-center text-[10px] font-medium text-[#787774]">{topBarStatus}</p>
          ) : null}
        </div>
      );
    },
    [activeSourceImportCount, handleViewModeChange, isRecording, viewMode]
  );

  const renderMobileRecordView = ({ desktopShell = false }: { desktopShell?: boolean } = {}) => {
    const shellWidthClass = desktopShell ? 'max-w-3xl' : 'max-w-md';
    const messageBubbleWidthClass = desktopShell ? 'max-w-[74%]' : 'max-w-[88%]';
    const collectionChromeContained = desktopShell || isDesktopMobilePreview;
    const sheetWidthClass = desktopShell ? 'max-w-2xl' : 'max-w-md';
    const backdropPositionClass = collectionChromeContained ? 'absolute inset-0' : 'fixed inset-0';
    const dockWidthClass = desktopShell ? 'max-w-3xl' : 'max-w-md';
    const dockPaddingClass = desktopShell ? 'px-6 pb-6 pt-3' : 'px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2';
    const sheetBottomOffset = desktopShell ? (showMobileRecorder ? 168 : 118) : (showMobileRecorder ? 150 : 96);
    const mobileSheetMaxHeight = desktopShell
      ? 'min(72vh, 760px)'
      : `calc(100dvh - ${sheetBottomOffset}px - max(env(safe-area-inset-top), 14px) - 12px)`;
    const mobileSheetScrollableStyle = {
      WebkitOverflowScrolling: 'touch' as const,
      touchAction: 'pan-y' as const,
    };
    const scrollPadding = desktopShell ? 28 : 18;
    const composerHasText = collectionComposerText.trim().length > 0;
    const composerRows = composerHasText ? 2 : 1;
    const showComposerAssistState =
      sourceImporting || composerVoiceStatus === 'connecting' || isComposerVoiceRecording || composerCanAutoImportLink;

    return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-20%] top-[-5%] h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(200,235,216,0.32)_0%,rgba(200,235,216,0)_72%)]" />
        <div className="absolute right-[-18%] top-[16%] h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(91,106,191,0.12)_0%,rgba(91,106,191,0)_72%)]" />
        <div className="absolute bottom-[-12%] left-[8%] h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(93,173,226,0.14)_0%,rgba(93,173,226,0)_72%)]" />
      </div>
      {!desktopShell ? renderMobileTopBar() : null}

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
        className={desktopShell ? 'relative z-10 flex-1 overflow-y-auto px-6 pt-6' : 'relative z-10 flex-1 overflow-y-auto px-4 pt-4'}
        style={{ paddingBottom: `${scrollPadding}px` }}
      >
        <div className={`mx-auto flex w-full ${shellWidthClass} flex-col gap-3`}>
          {collectionFeedItems.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#232322]" />
                  <span>今天</span>
                </div>
                {isCollectionContextSelectionMode ? (
                  <div className="text-[11px] font-medium text-[#232322]">
                    选择中
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {collectionFeedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#D3E4F4]">
                <Sparkles size={24} className="text-[#232322]" />
              </div>
              <p className="mt-4 text-[15px] font-medium text-slate-800">从一条线索开始</p>
              <p className="mt-1.5 text-center text-[13px] leading-5 text-slate-400">
                一句困惑、一张图、一份讲义<br />或者一段原声都行
              </p>
              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSourceFileButtonClick('audio')}
                  className="flex flex-col items-center gap-1.5 rounded-2xl border border-[#E9E9E7] bg-white px-4 py-3 transition hover:bg-[#EFEFEF]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FDF3C0] text-[#232322]">
                    <AudioLines size={16} />
                  </span>
                  <span className="text-[11px] text-[#787774]">原声</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSourceFileButtonClick('all')}
                  className="flex flex-col items-center gap-1.5 rounded-2xl border border-[#E9E9E7] bg-white px-4 py-3 transition hover:bg-[#EFEFEF]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#D3E4F4] text-[#232322]">
                    <ImageIcon size={16} />
                  </span>
                  <span className="text-[11px] text-[#787774]">图片</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSourceFileButtonClick('all')}
                  className="flex flex-col items-center gap-1.5 rounded-2xl border border-[#E9E9E7] bg-white px-4 py-3 transition hover:bg-[#EFEFEF]"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FADEC9] text-[#232322]">
                    <FileText size={16} />
                  </span>
                  <span className="text-[11px] text-slate-500">讲义</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {showMobileRecorder ? (
                <div className="flex justify-end">
                  <div className={`${messageBubbleWidthClass} rounded-[22px] rounded-br-[8px] border border-[#E9E9E7] bg-[#D1F4E0] px-4 py-3`}>
                    <div className="flex justify-end">
                      <div className="inline-flex items-center gap-3 rounded-full bg-white/80 px-3 py-2 text-[#232322]">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#232322] text-white">
                          <Mic size={14} />
                        </span>
                        <span className="flex items-end gap-[3px] text-[#787774]">
                          {[8, 12, 16, 11, 15, 9, 13].map((height, index) => (
                            <span
                              key={`live-wave-${height}-${index}`}
                              className="w-[3px] rounded-full bg-current"
                              style={{ height: `${height}px`, opacity: 0.95 }}
                            />
                          ))}
                        </span>
                        <span className="text-[11px] font-semibold">原声录制中</span>
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-900">
                      {currentLivePreview || '继续说下去，停下后这段语音会直接留在这里。'}
                    </p>
                    <div className="mt-2 flex items-center justify-end text-[11px] text-[#787774]">
                      {formatRelativeCollectionTime(new Date().toISOString())}
                    </div>
                  </div>
                </div>
              ) : null}

              {collectionFeedItems.map((item) => {
                const isPrimary = (item.origin || 'user') === 'user';
                const typeLabel =
                  item.type === 'audio'
                    ? '录音'
                    : item.type === 'video'
                      ? '视频'
                      : item.type === 'image'
                        ? '图片'
                        : item.type === 'document'
                          ? '材料'
                          : '文字';

                const bubbleText = item.fullText?.trim() || item.preview?.trim() || item.title;
                const collectionActionTitle = getCollectionContextDisplayTitle(item, 36);
                const audioProgress =
                  audioPlaybackState?.id === item.id
                    ? Math.max(0, Math.min(1, audioPlaybackState.progress))
                    : 0;
                const isAudioPlaying = playingAudioMessageId === item.id;
                const isAudioTranscriptOpen = expandedAudioTranscriptId === item.id;
                const fileExtensionBadge = getFileExtensionBadge(item.title);
                const showInlineStatus = Boolean(
                  item.status === 'failed' &&
                  item.statusText &&
                  item.type !== 'audio' &&
                  item.type !== 'video'
                );
                const showAudioStatusText = Boolean(item.statusText) && item.status !== 'ready';
                const showVideoStatusText = Boolean(item.statusText) && item.status === 'failed';
                const statusTone =
                  item.status === 'failed'
                    ? 'bg-rose-50 text-rose-600'
                    : item.status === 'ready'
                      ? 'bg-white/70 text-[#4f7a36]'
                      : 'bg-white/70 text-[#3d7d1f]';
                const isAttachmentMessage =
                  Boolean(item.attachmentUrl) && (item.type === 'document' || item.type === 'text');
                const isSelectedForContext = selectedCollectionContextIds.includes(item.id);
                const showInlineMoreButton = !isCollectionContextSelectionMode;
                const inlineMoreButtonClass = desktopShell
                  ? 'rounded-full border border-[#E9E9E7] bg-white p-1.5 text-[#787774] opacity-0 transition hover:bg-[#EFEFEF] hover:text-[#232322] group-hover:opacity-100'
                  : isPrimary
                    ? 'rounded-full border border-[#E9E9E7] bg-white p-1.5 text-[#232322] transition hover:bg-[#EFEFEF]'
                    : 'rounded-full border border-[#E9E9E7] bg-white p-1.5 text-[#787774] transition hover:bg-[#EFEFEF] hover:text-[#232322]';

                return (
                  <div
                    key={item.id}
                    className={`group flex ${isPrimary ? 'justify-end' : 'justify-start'}`}
                    onContextMenu={
                      desktopShell && !isCollectionContextSelectionMode
                        ? (event) => {
                            event.preventDefault();
                            openCollectionMessageMenu(item.id);
                          }
                        : undefined
                    }
                    onTouchStart={
                      !desktopShell && !isCollectionContextSelectionMode
                        ? () => beginCollectionMessageLongPress(item.id)
                        : undefined
                    }
                    onTouchEnd={!desktopShell ? cancelCollectionMessageLongPress : undefined}
                    onTouchCancel={!desktopShell ? cancelCollectionMessageLongPress : undefined}
                    onTouchMove={!desktopShell ? cancelCollectionMessageLongPress : undefined}
                    onClickCapture={
                      !desktopShell
                        ? (event) => {
                            if (!collectionLongPressTriggeredRef.current) return;
                            collectionLongPressTriggeredRef.current = false;
                            event.preventDefault();
                            event.stopPropagation();
                          }
                        : undefined
                    }
                  >
                    <div className={`${messageBubbleWidthClass} ${isPrimary ? '' : 'pl-6'}`}>
                      <div
                        className={`relative overflow-hidden rounded-2xl px-4 py-3 ${
                          isPrimary
                            ? 'rounded-br-md bg-[#F0FAF4]'
                            : 'rounded-bl-md bg-white border border-slate-100'
                        } ${isSelectedForContext ? 'ring-2 ring-[#5B6ABF]/30' : ''}`}
                      >
                        {!isCollectionContextSelectionMode ? (
                          <div className={`mb-2 flex items-center justify-between gap-2 ${isPrimary ? 'text-[#5B6ABF]' : 'text-slate-500'}`}>
                            <span className="text-[10px] font-medium uppercase tracking-wider opacity-60">
                              {typeLabel}
                            </span>
                            {showInlineMoreButton ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openCollectionMessageMenu(item.id);
                                }}
                                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                                aria-label={`更多操作：${collectionActionTitle}`}
                              >
                                <MoreHorizontal size={14} />
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {isCollectionContextSelectionMode ? (
                          <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
                            <button
                              type="button"
                              onClick={() => toggleCollectionContextItem(item)}
                              aria-pressed={isSelectedForContext}
                              className={`rounded-full px-2.5 py-1 font-medium transition ${
                                isSelectedForContext
                                  ? 'bg-[#D6DAFA] text-[#424E96]'
                                  : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {isSelectedForContext ? '已选' : '选择'}
                            </button>
                            <span className="text-[10px] text-slate-400">{getCollectionContextTypeLabel(item.type)}</span>
                          </div>
                        ) : null}
                        {item.type === 'audio' ? (
                          <div className="space-y-2">
                            <div className={`flex ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                              <button
                                type="button"
                                onClick={() => {
                                  void toggleAudioMessagePlayback(item);
                                }}
                                disabled={!item.mediaUrl}
                                className={`inline-flex max-w-full items-center gap-3 rounded-full px-3 py-2 transition ${
                                  isPrimary
                                    ? 'bg-white/60 text-slate-700'
                                    : 'bg-slate-100 text-slate-700'
                                } disabled:cursor-default disabled:opacity-80`}
                              >
                                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#232322] text-white">
                                  {isAudioPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                                </span>
                                <span className="relative flex h-5 w-[88px] items-center">
                                  <span
                                    className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-slate-200"
                                    style={{ width: '100%' }}
                                  />
                                  <span
                                    className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[#5DADE2] transition-all"
                                    style={{ width: `${Math.max(8, audioProgress * 100)}%` }}
                                  />
                                  <span className="relative z-10 flex w-full items-end justify-between px-1">
                                    {[8, 12, 16, 11, 15, 9, 13, 10].map((height, index) => (
                                      <span
                                        key={`${item.id}-wave-${index}`}
                                        className="w-[3px] rounded-full bg-slate-400"
                                        style={{ height: `${height}px`, opacity: index / 8 < audioProgress ? 0.95 : 0.35 }}
                                      />
                                    ))}
                                  </span>
                                </span>
                                <span className="text-[11px] font-semibold">
                                  {formatVoiceDurationCompact(
                                    audioPlaybackState?.id === item.id && audioPlaybackState.duration > 0
                                      ? audioPlaybackState.duration * 1000
                                      : item.durationMs
                                  )}
                                </span>
                              </button>
                            </div>
                            <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                              isPrimary ? 'justify-end text-slate-500' : 'justify-start text-slate-500'
                            }`}>
                              {showAudioStatusText ? (
                                <span className="font-medium">{item.statusText}</span>
                              ) : null}
                              {item.segmentCount > 0 && item.fullText?.trim() ? (
                                <>
                                  {showAudioStatusText ? (
                                    <span aria-hidden="true" className="opacity-40">·</span>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedAudioTranscriptId((prev) => (prev === item.id ? null : item.id))
                                    }
                                    className="rounded-full px-2.5 py-1 font-medium text-slate-500 transition hover:bg-slate-100"
                                  >
                                    {isAudioTranscriptOpen ? '收起文字' : '看文字'}
                                  </button>
                                </>
                              ) : null}
                            </div>
                            {isAudioTranscriptOpen && item.segmentCount > 0 && item.fullText?.trim() ? (
                              <div className={`rounded-xl px-3 py-2 text-sm leading-6 ${
                                isPrimary ? 'bg-white/50 text-slate-800' : 'bg-slate-50 text-slate-700'
                              }`}>
                                {bubbleText}
                              </div>
                            ) : null}
                          </div>
                        ) : item.type === 'image' ? (
                          <div className="space-y-2">
                            {item.previewUrl ? (
                              <a
                                href={item.attachmentUrl || item.previewUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block overflow-hidden rounded-[18px]"
                                aria-label={`查看原图：${item.title}`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={item.previewUrl}
                                  alt={item.title}
                                  className="max-h-60 w-full object-cover"
                                />
                              </a>
                            ) : (
                              <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                                  isPrimary ? 'bg-white/50 text-violet-500' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  <ImageIcon size={15} />
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : item.type === 'document' || isAttachmentMessage ? (
                          <div className="space-y-2">
                            {item.attachmentUrl ? (
                              <a
                                href={item.attachmentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={`block rounded-xl border px-3 py-2.5 transition ${
                                  isPrimary
                                    ? 'border-white/50 bg-white/40 hover:bg-white/60'
                                    : 'border-slate-100 bg-slate-50 hover:bg-white'
                                }`}
                              >
                                <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                                    isPrimary ? 'bg-white text-blue-500' : 'bg-white text-slate-500'
                                  }`}>
                                    <FileText size={15} />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                                  </div>
                                  {fileExtensionBadge ? (
                                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                                      {fileExtensionBadge}
                                    </span>
                                  ) : null}
                                </div>
                              </a>
                            ) : (
                              <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                                  isPrimary ? 'bg-white/70 text-[#2563eb]' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  <FileText size={15} />
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                                  {fileExtensionBadge ? <p className="text-[11px] text-slate-500">{fileExtensionBadge}</p> : null}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : item.type === 'video' ? (
                          <div className="space-y-2">
                            {(() => {
                              const videoHref = item.attachmentUrl || item.embedUrl || item.mediaUrl;
                              const hasThumbnail = !!item.previewUrl;
                              if (hasThumbnail) {
                                const inner = (
                                  <div className={`relative overflow-hidden rounded-[18px] ${
                                    isPrimary ? 'bg-[#1f2937]' : 'bg-slate-900'
                                  }`}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={item.previewUrl}
                                      alt={item.title}
                                      className="block w-full aspect-video object-cover"
                                      loading="lazy"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg">
                                        <Play size={20} className="ml-0.5" />
                                      </span>
                                    </div>
                                    {item.durationMs ? (
                                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                                        {formatVoiceDurationCompact(item.durationMs)}
                                      </span>
                                    ) : null}
                                    <div className="border-t border-white/10 bg-black/50 px-3 py-2 text-white">
                                      <p className="truncate text-sm font-medium">{item.title}</p>
                                      {item.videoProvider ? (
                                        <p className="mt-0.5 text-[11px] text-white/60">{item.videoProvider}</p>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                                return videoHref ? (
                                  <a href={videoHref} target="_blank" rel="noreferrer" className="block transition hover:opacity-90">{inner}</a>
                                ) : inner;
                              }
                              /* 无缩略图：链接卡片样式 */
                              if (videoHref) {
                                return (
                                  <a
                                    href={videoHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={`block overflow-hidden rounded-[18px] transition ${
                                      isPrimary ? 'bg-[#1f2937] hover:bg-[#111827]' : 'bg-slate-900 hover:bg-slate-800'
                                    }`}
                                  >
                                    <div className="flex min-h-[100px] items-center justify-center px-4 py-5">
                                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900">
                                        <Play size={18} className="ml-0.5" />
                                      </span>
                                    </div>
                                    <div className="border-t border-white/10 bg-black/18 px-3 py-2.5 text-white">
                                      <p className="truncate text-sm font-medium">{item.title}</p>
                                      {item.durationMs ? (
                                        <p className="mt-0.5 text-[11px] text-white/70">
                                          {formatVoiceDurationCompact(item.durationMs)}
                                        </p>
                                      ) : null}
                                    </div>
                                  </a>
                                );
                              }
                              /* 既无缩略图也无链接 */
                              return (
                                <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                                    isPrimary ? 'bg-white/70 text-fuchsia-600' : 'bg-slate-100 text-slate-500'
                                  }`}>
                                    <Link2 size={15} />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-slate-900">
                                      {item.title}
                                      {item.durationMs ? ` · ${formatVoiceDurationCompact(item.durationMs)}` : ''}
                                    </p>
                                  </div>
                                </div>
                              );
                            })()}
                            <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                              isPrimary ? 'justify-end text-white/75' : 'justify-start text-slate-500'
                            }`}>
                              {showVideoStatusText ? (
                                <span className="font-medium">{item.statusText}</span>
                              ) : item.videoImported && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void openReviewFromCollection(item);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-full bg-[#D1F4E0]/80 px-2.5 py-0.5 text-[11px] font-medium text-[#2d6a3f] transition hover:bg-[#D1F4E0]"
                                >
                                  <BookOpen size={11} />
                                  <span>已解析 · {item.serverTranscriptSegments.length}句 · 去复习</span>
                                </button>
                              ) : item.type === 'video' && item.reviewable && !item.videoImported && !item.sessionId && item.status !== 'failed' ? (
                                <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-600/80">
                                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                                  <span>解析中…</span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-sm leading-6 text-slate-900">{bubbleText}</p>
                          </div>
                        )}
                        <div className={`mt-2 flex items-center ${isPrimary ? 'justify-end' : 'justify-start'} gap-2 text-[11px] text-slate-400`}>
                          <span>{formatRelativeCollectionTime(item.addedAt)}</span>
                          {showInlineStatus ? (
                            <span className={`rounded-full px-2 py-0.5 ${statusTone}`}>
                              {item.statusText || typeLabel}
                            </span>
                          ) : null}
                        </div>
                        {!isCollectionContextSelectionMode ? (
                          <div className={`mt-3 flex items-center ${isPrimary ? 'justify-end' : 'justify-start'} gap-2.5 border-t pt-3 ${
                            isPrimary ? 'border-[#E9E9E7]' : 'border-[#E9E9E7]'
                          }`}>
                            <button
                              type="button"
                              onClick={() => openTutorFromCollectionItem(item)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[12px] font-semibold transition ${
                                isPrimary
                                  ? 'bg-[#232322] text-white hover:bg-[#111111]'
                                  : 'bg-[#232322] text-white hover:bg-[#111111]'
                              }`}
                            >
                              <MessageCircle size={14} />
                              <span>问 Tutor</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => quoteCollectionItemToComposer(item)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[12px] font-medium transition ${
                                isPrimary
                                  ? 'bg-white text-[#232322] hover:bg-[#EFEFEF]'
                                  : 'bg-[#EFEFEF] text-[#232322] hover:bg-[#E9E9E7]'
                              }`}
                            >
                              <FileText size={14} />
                              <span>引用</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* ── 回声提示条：系统内设计语言，极轻一行 ── */}
              {workspaceEchoes.length > 0 && (
                <div className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => setMobileCollectionSheet('echo')}
                    className="flex w-full items-center gap-2.5 px-4 py-3 transition-colors active:bg-[#EFEFEF]"
                  >
                    <span className="text-[11px] text-[#A3A39E]">✦</span>
                    <span className="min-w-0 flex-1 truncate text-left text-[13px] leading-5 text-[#787774]">
                      {workspaceEchoes.length === 1
                        ? '同桌留了一条回声'
                        : `同桌留了 ${workspaceEchoes.length} 条回声`}
                    </span>
                    <ChevronRight size={14} className="flex-shrink-0 text-[#A3A39E]" />
                  </button>
                </div>
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
          className={`${collectionChromeContained ? 'absolute' : 'fixed'} bottom-28 left-1/2 z-20 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-[#E9E9E7] bg-[#232322] px-4 py-2 text-[13px] font-medium text-emerald-400 shadow-lg transition-all hover:bg-[#333] active:scale-95`}
          aria-label="跳转到最新消息"
        >
          <ChevronsDown size={16} className="shrink-0" />
          <span>跳转到最新消息</span>
        </button>
      )}

      {activeCollectionMessageMenuItem ? (
        <>
          <button
            type="button"
            aria-label="关闭消息操作菜单"
            onClick={closeCollectionMessageMenu}
            className={`${backdropPositionClass} z-20 bg-slate-900/18`}
          />
          <div className={`${collectionChromeContained ? 'absolute inset-x-0 bottom-0' : 'fixed inset-x-0 bottom-0'} z-30 px-3 pb-[max(env(safe-area-inset-bottom),12px)]`}>
            <div className={`mx-auto w-full ${desktopShell ? 'max-w-sm' : 'max-w-md'} rounded-[32px] border border-[#E9E9E7] bg-white p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#D1F4E0]/30 px-2.5 py-1 text-[11px] font-semibold text-[#232322]">
                      {activeCollectionMessageMenuTypeLabel}
                    </span>
                    {selectedCollectionContextIds.includes(activeCollectionMessageMenuItem.id) ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">已加入多选</span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-[15px] font-semibold leading-6 text-slate-900">{activeCollectionMessageMenuTitle}</p>
                  {activeCollectionMessageMenuPreview && activeCollectionMessageMenuPreview !== activeCollectionMessageMenuTitle ? (
                    <p className="mt-1 text-[13px] leading-6 text-slate-500">{activeCollectionMessageMenuPreview}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={closeCollectionMessageMenu}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-[#E9E9E7] bg-white/92 text-slate-500 transition hover:bg-white hover:text-slate-700"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="mt-4 rounded-[24px] border border-[#E9E9E7] bg-[#F7F7F5] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      closeCollectionMessageMenu();
                      openTutorFromCollectionItem(activeCollectionMessageMenuItem);
                    }}
                    className="flex items-center gap-3 rounded-[18px] bg-[#232322] px-4 py-3 text-left text-sm font-semibold text-white transition hover:bg-[#111111]"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/16 text-white">
                      <MessageCircle size={16} />
                    </span>
                    <span>问 Tutor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeCollectionMessageMenu();
                      quoteCollectionItemToComposer(activeCollectionMessageMenuItem);
                    }}
                    className="flex items-center gap-3 rounded-[18px] bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                      <FileText size={16} />
                    </span>
                    <span>引用</span>
                  </button>
                  {Boolean(activeCollectionMessageMenuItem.reviewable && (activeCollectionMessageMenuItem.sessionId || activeCollectionMessageMenuItem.videoImported) && activeCollectionMessageMenuItem.status !== 'failed') ? (
                    <button
                      type="button"
                      onClick={() => {
                        closeCollectionMessageMenu();
                        void openReviewFromCollection(activeCollectionMessageMenuItem);
                      }}
                      className="col-span-2 flex items-center justify-between rounded-[18px] bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#D1F4E0] text-[#232322]">
                          <BookOpen size={16} />
                        </span>
                        <span>去复习</span>
                      </span>
                      <ChevronRight size={16} className="text-slate-300" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {activeCollectionMenuWorkspaceCapture?.contentType === 'text' ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeCollectionMessageMenu();
                      openWorkspaceCaptureEditor(activeCollectionMenuWorkspaceCapture, 'text');
                    }}
                    className="rounded-full bg-slate-100 px-3 py-2 text-[12px] font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    编辑文字
                  </button>
                ) : null}
                {activeCollectionMenuWorkspaceCapture &&
                (activeCollectionMenuWorkspaceCapture.contentType === 'audio' ||
                  activeCollectionMenuWorkspaceCapture.contentType === 'video') &&
                Boolean((activeCollectionMenuWorkspaceCapture.normalizedText || activeCollectionMenuWorkspaceCapture.tutorContext || '').trim()) ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeCollectionMessageMenu();
                      openWorkspaceCaptureEditor(activeCollectionMenuWorkspaceCapture, 'transcript');
                    }}
                    className="rounded-full bg-slate-100 px-3 py-2 text-[12px] font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    校正文字
                  </button>
                ) : null}
                {activeCollectionMenuWorkspaceCapture && activeCollectionMenuWorkspaceCapture.contentType !== 'text' ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeCollectionMessageMenu();
                      openWorkspaceCaptureEditor(activeCollectionMenuWorkspaceCapture, 'meta');
                    }}
                    className="rounded-full bg-slate-100 px-3 py-2 text-[12px] font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    改标题备注
                  </button>
                ) : null}
                {Boolean(activeCollectionMessageMenuItem.attachmentUrl || activeCollectionMessageMenuItem.mediaUrl || activeCollectionMessageMenuItem.previewUrl) ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeCollectionMessageMenu();
                      openCollectionItemOriginal(activeCollectionMessageMenuItem);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-[12px] font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    <Link2 size={14} />
                    <span>打开原件</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    closeCollectionMessageMenu();
                    toggleCollectionContextItem(activeCollectionMessageMenuItem);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-2 text-[12px] font-medium text-slate-700 transition hover:bg-slate-200"
                >
                  <Plus size={14} />
                  <span>{selectedCollectionContextIds.includes(activeCollectionMessageMenuItem.id) ? '移出多选' : '加入多选'}</span>
                </button>
              </div>

              <div className="mt-4 border-t border-slate-100 pt-3">
                {canUsePersistentCaptureActions ? (
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        void updateWorkspaceCaptureStatus({
                          action: 'archive',
                          sourceKey: activeCollectionMessageMenuSourceKey,
                          itemId: activeCollectionMessageMenuItem.id,
                        }).finally(() => {
                          closeCollectionMessageMenu();
                        });
                      }}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-[#232322]"
                    >
                      <History size={15} />
                      <span>先收起</span>
                    </button>
                    {confirmCollectionDeleteId === activeCollectionMessageMenuItem.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCollectionDeleteId(null)}
                          className="rounded-full bg-slate-100 px-3 py-2 text-[12px] font-medium text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void updateWorkspaceCaptureStatus({
                              action: 'delete',
                              sourceKey: activeCollectionMessageMenuSourceKey,
                              itemId: activeCollectionMessageMenuItem.id,
                            }).finally(() => {
                              closeCollectionMessageMenu();
                            });
                          }}
                          className="rounded-full bg-rose-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-rose-700"
                        >
                          确认删除
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCollectionDeleteId(activeCollectionMessageMenuItem.id)}
                        className="text-sm font-medium text-slate-400 transition hover:text-rose-700"
                      >
                        删除
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      removeCollectionItemsFromFlow({
                        itemId: activeCollectionMessageMenuItem.id,
                        sourceKey: activeCollectionMessageMenuSourceKey,
                      });
                      closeCollectionMessageMenu();
                    }}
                    className="text-sm font-medium text-rose-600 transition hover:text-rose-700"
                  >
                    删除这条
                  </button>
                )}
                {confirmCollectionDeleteId === activeCollectionMessageMenuItem.id ? (
                  <p className="mt-2 text-[11px] font-medium text-rose-600">删除后，这条内容不会再进入 Tutor、回声和后续记忆。</p>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {mobileCollectionSheet === 'more' ? (
        <>
          <button
            type="button"
            aria-label="关闭收集菜单"
            onClick={() => {
              setMobileCollectionSheet(null);
            }}
            className={`${backdropPositionClass} z-20 bg-slate-900/18`}
          />
        <div
          className={`${collectionChromeContained ? 'absolute inset-y-0 left-0' : 'fixed inset-y-0 left-0'} z-30 w-[86vw] max-w-[360px]`}
        >
          <div className="flex h-full flex-col overflow-hidden rounded-r-[30px] border-r border-[#E9E9E7] bg-white">
            <div className="border-b border-[#f2ebe4] px-5 pb-4 pt-[max(env(safe-area-inset-top),20px)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-2xl font-semibold tracking-[-0.02em] text-slate-900">收集</p>
                  <p className="mt-1 text-xs text-slate-500">
                    已收 {captureActivitySummary.totalCount} 条 · 活跃 {captureActivitySummary.activeDays} 天 · 回声{' '}
                    {workspaceEchoes.length} 条
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileCollectionSheet(null);
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-[#E9E9E7] bg-white/92 text-slate-500 transition hover:bg-white hover:text-slate-700"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                <div className="rounded-[18px] bg-slate-50 px-4 py-3 text-left">
                  <p className="text-sm font-semibold text-slate-900">
                    {captureActivitySummary.streak > 0
                      ? `已经连续 ${captureActivitySummary.streak} 天在收`
                      : '先从今天收一点开始'}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {captureActivitySummary.topKinds.length > 0
                      ? `最近收得最多的是：${captureActivitySummary.topKinds.join(' · ')}`
                      : '一句困惑、一张图、一份讲义或一段原声，都可以先发进来。'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setMobileCollectionSheet('history')}
                  className="flex w-full items-center gap-3 rounded-[18px] bg-[#07c160] px-4 py-3 text-left text-white shadow-[0_14px_30px_rgba(7,193,96,0.18)] transition hover:bg-[#06b458]"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/18 text-white">
                    <Boxes size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">全部收集</p>
                    <p className="mt-0.5 text-xs leading-5 text-white/85">从以前收进来的课、图和材料里继续接着学。</p>
                  </div>
                  <ChevronRight size={16} className="text-white/80" />
                </button>

                <button
                  type="button"
                  onClick={() => setMobileCollectionSheet('echo')}
                  className="flex w-full items-center gap-3 rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-left transition hover:border-slate-300 hover:bg-white"
                >
                  <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#232322]">
                    <Sparkles size={16} />
                    {showCollectionPulsePreview && collectionPulse ? (
                      <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full bg-[#232322]" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">回声</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">
                      {workspaceEchoes.length > 0 ? '同桌有话想跟你说。' : '先继续收集，回声会安静出现。'}
                    </p>
                  </div>
                  <ChevronRight size={16} className="text-slate-300" />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : mobileCollectionSheet ? (
        <>
          <button
            type="button"
            aria-label="关闭收集附加层"
            onClick={() => {
              setMobileCollectionSheet(null);
            }}
            className={`${backdropPositionClass} z-20 bg-slate-900/18`}
          />
          <div
            className={`${collectionChromeContained ? 'absolute inset-x-0' : 'fixed inset-x-0'} z-30 ${dockPaddingClass}`}
            style={{ bottom: `${sheetBottomOffset}px` }}
          >
            <div
              className={`mx-auto flex w-full ${sheetWidthClass} flex-col overflow-hidden rounded-[30px] border border-[#E9E9E7] bg-white`}
              style={{ maxHeight: mobileSheetMaxHeight }}
            >
              <div className="flex items-center justify-between border-b border-[#E9E9E7] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {mobileCollectionSheet === 'echo'
                      ? '回声'
                      : mobileCollectionSheet === 'history'
                        ? '历史收集'
                        : '收集菜单'}
                  </p>
                  {mobileCollectionSheet === 'echo' ? (
                    <p className="text-xs text-slate-500">安静地长出来的东西。</p>
                  ) : null}
                </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileCollectionSheet(null);
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-[16px] border border-[#E9E9E7] bg-white/92 text-slate-500 transition hover:bg-white hover:text-slate-700"
                  >
                    <X size={16} />
                  </button>
              </div>

              {mobileCollectionSheet === 'echo' ? (
                <div
                  data-mobile-sheet-scrollable="echo"
                  className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
                  style={mobileSheetScrollableStyle}
                >
                  {workspaceEchoes.length > 0 ? (
                    <>
                      {workspaceEchoes.map((echo) => (
                        <EchoCard
                          key={echo.id}
                          echo={{
                            id: echo.id,
                            kind: echo.kind,
                            title: echo.title,
                            body: echo.body,
                            highlights: echo.highlights,
                            takeaway: echo.takeaway,
                            sourceCaptureIds: echo.sourceCaptureIds,
                            createdAt: echo.createdAt,
                            updatedAt: echo.updatedAt,
                          }}
                          onShare={(echoData) => {
                            setSharingEcho(echoData);
                          }}
                        />
                      ))}
                      {ENABLE_ECHO_MANUAL_TRIGGER ? (
                        <div className="pt-2">
                          {renderManualEchoTriggerButton(
                            'text-[11px] font-medium text-stone-400 transition hover:text-stone-600 disabled:cursor-not-allowed disabled:opacity-60'
                          )}
                        </div>
                      ) : null}
                      {manualEchoFeedbackView}
                      {manualEchoDebugView}
                    </>
                  ) : (
                    <div className="flex flex-col items-center py-12">
                      <span className="text-2xl text-[#A3A39E]/40">✦</span>
                      <p className="mt-3 text-[14px] leading-7 text-[#A3A39E]">
                        先继续收集，回声会安静地出现。
                      </p>
                      {ENABLE_ECHO_MANUAL_TRIGGER ? (
                        <div className="mt-4">
                          {renderManualEchoTriggerButton(
                            'text-xs font-medium text-stone-400 transition hover:text-stone-600 disabled:cursor-not-allowed disabled:opacity-60'
                          )}
                        </div>
                      ) : null}
                      {manualEchoFeedbackView}
                      {manualEchoDebugView}
                    </div>
                  )}
                </div>
              ) : null}

              {mobileCollectionSheet === 'history' ? (
                <div className="min-h-0 flex-1 overflow-hidden rounded-b-[30px]">
                  <WorkspaceCaptureList
                    captures={allCollectionItems}
                    onClose={() => setMobileCollectionSheet(null)}
                    onOpenReview={openReviewFromCollectionListItem}
                    onQuoteCapture={quoteCollectionListItemToComposer}
                    onAskTutorAboutCapture={openTutorFromCollectionListItem}
                    onToggleSelectCapture={toggleCollectionListItemSelection}
                    onArchiveCapture={archiveCollectionListItem}
                    onRestoreCapture={restoreCollectionListItem}
                    onDeleteCapture={deleteCollectionListItem}
                    onEditCapture={editWorkspaceCaptureFromList}
                    onAISearch={() => setShowAISearch(true)}
                    selectedCaptureIds={selectedCollectionListIds}
                    selectionMode={isCollectionContextSelectionMode}
                    maxHeight="100%"
                    showHeader={false}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {isCollectionContextSelectionMode && selectedCollectionContextItems.length > 0 ? (
        <div className={`relative z-20 flex-shrink-0 ${desktopShell ? 'px-6 pb-2 pt-3' : 'px-3 pb-2 pt-2'}`}>
          <div
            className={`mx-auto w-full ${dockWidthClass} rounded-[28px] border border-[#E9E9E7] bg-white px-3.5 py-3`}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center rounded-full bg-[#232322] px-2.5 py-1 text-[12px] font-semibold text-white">
                    {selectedCollectionContextItems.length} 条
                  </span>
                  <p className="text-[12px] font-medium text-[#232322]">已加入这次操作</p>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={openTutorWithSelectedCollectionContext}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#232322] px-3.5 py-2.5 text-[11px] font-semibold text-white transition hover:bg-[#111111]"
                  >
                    <MessageCircle size={14} />
                    <span>问 Tutor</span>
                  </button>
                  <button
                    type="button"
                    onClick={quoteSelectedCollectionContextToComposer}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    <FileText size={14} />
                    <span>引用</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void applyBatchActionToSelectedCollectionContext('archive');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#E9E9E7] bg-[#FDF3C0]/50 px-3 py-2.5 text-[11px] font-medium text-[#232322] transition hover:border-[#E9E9E7] hover:bg-[#FDF3C0]"
                  >
                    <History size={14} />
                    <span>先收起</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void applyBatchActionToSelectedCollectionContext('delete');
                    }}
                    className={`rounded-full px-3 py-2.5 text-[11px] font-medium transition ${
                      confirmSelectedCollectionDelete
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'text-slate-400 hover:bg-rose-50 hover:text-rose-700'
                    }`}
                  >
                    {confirmSelectedCollectionDelete ? '确认删除' : '删除'}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={clearCollectionContextSelection}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-[#E9E9E7] bg-white/86 text-slate-500 transition hover:bg-white hover:text-slate-700"
                aria-label="退出多选"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          {confirmSelectedCollectionDelete ? (
            <p className={`mx-auto mt-2 w-full ${dockWidthClass} px-1 text-[11px] font-medium text-rose-600`}>
              再点一次删除，就会彻底移除这些内容。
            </p>
          ) : null}
        </div>
      ) : null}

      {showMobileRecorder ? (
        <div className={`relative z-30 flex-shrink-0 bg-[#F7F7F7] ${desktopShell ? 'px-4 pb-5 pt-2' : 'px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-2'}`} style={{ borderTop: '0.5px solid #E0E0E0' }}>
          <div className={`mx-auto w-full ${dockWidthClass}`}>
            <Recorder
              ref={recorderRef}
              activeSessionId={sessionId}
              continueCurrentSession={collectionFeedItems.length > 0 || segments.length > 0}
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
        <div className={`relative z-20 flex-shrink-0 bg-[#F7F7F7] ${desktopShell ? 'px-4 pb-5 pt-2' : 'px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5'}`} style={{ borderTop: '0.5px solid #E0E0E0' }}>
          <div className={`mx-auto w-full ${dockWidthClass}`}>
            {quotedCollectionContextItems.length > 0 ? (
              <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12px]">
                <ChevronRight size={12} className="flex-shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-slate-500">
                  {quotedCollectionContextItems.length > 1
                    ? `已引用 ${quotedCollectionContextItems.length} 条内容`
                    : quotedCollectionPrimaryItem?.type === 'audio'
                      ? '已引用一段原声'
                      : `已引用${quotedCollectionPrimaryItem ? getCollectionContextTypeLabel(quotedCollectionPrimaryItem.type) : '内容'}`}
                  {quotedCollectionSummaryText ? `：${quotedCollectionSummaryText}` : ''}
                </span>
                <button
                  type="button"
                  onClick={clearQuotedCollectionContext}
                  className="flex-shrink-0 text-slate-300 hover:text-slate-500"
                  aria-label="取消引用"
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}
            {composerLinkPreview ? (
              <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12px]">
                <Link2 size={12} className="flex-shrink-0 text-indigo-400" />
                <span className="min-w-0 flex-1 truncate text-slate-500">
                  {composerLinkPreview.providerLabel} 链接{composerCanAutoImportLink ? ' · 发送后自动解析' : ''}
                </span>
              </div>
            ) : null}
            <div className="flex items-end gap-1">
              <button
                type="button"
                onClick={openLiveRecorder}
                disabled={isComposerVoiceRecording || composerVoiceStatus === 'connecting'}
                className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center text-slate-500 transition hover:text-slate-700 disabled:text-slate-300"
                aria-label="录制原声"
              >
                <AudioLines size={24} strokeWidth={1.5} />
              </button>
              <div className="min-w-0 flex-1 rounded-lg bg-white px-3 py-[7px]">
                <textarea
                  ref={collectionComposerRef}
                  data-testid="collection-composer-input"
                  value={collectionComposerText}
                  onChange={(event) => {
                    setSourceImportError('');
                    setCollectionComposerText(event.target.value);
                  }}
                  onPaste={handleCollectionComposerPaste}
                  placeholder={collectionComposerPlaceholder}
                  rows={composerRows}
                  className="max-h-28 min-h-[22px] w-full resize-none appearance-none border-0 bg-transparent px-0 py-0 text-[15px] leading-[22px] text-slate-900 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-slate-400"
                />
                {showComposerAssistState ? (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {sourceImporting
                      ? activeSourceImportCount > 1
                        ? `${activeSourceImportCount} 个文件已收下`
                        : '文件已收下'
                      : composerVoiceStatus === 'connecting'
                        ? '正在打开语音听写...'
                        : isComposerVoiceRecording
                          ? compactText(composerVoiceInterimText || '正在听你说...', 28)
                          : ''}
                  </p>
                ) : null}
                {!sourceImporting && sourceImportError ? (
                  <p className="mt-1 text-[11px] text-rose-400">{compactText(sourceImportError, 40)}</p>
                ) : null}
              </div>
              {composerHasText ? (
                <button
                  type="button"
                  data-testid="collection-composer-submit"
                  onClick={handleCollectionComposerSubmit}
                  disabled={isComposerVoiceRecording || composerVoiceStatus === 'connecting'}
                  className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white transition hover:bg-indigo-600 disabled:opacity-40"
                  aria-label="发送到收集流"
                >
                  <ArrowUp size={18} strokeWidth={2.5} />
                </button>
              ) : (
                <>
                <button
                  type="button"
                  onClick={() => {
                    void toggleComposerDictation();
                  }}
                  disabled={showMobileRecorder || isRecording}
                  className={`flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center transition ${
                    composerVoiceStatus === 'connecting' || isComposerVoiceRecording
                      ? 'text-indigo-500'
                      : 'text-slate-500 hover:text-slate-700'
                  } disabled:text-slate-300`}
                  aria-label={isComposerVoiceRecording || composerVoiceStatus === 'connecting' ? '停止语音听写' : '语音转文字'}
                >
                  <Mic size={24} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  data-testid="collection-upload-button"
                  onClick={() => handleSourceFileButtonClick('all')}
                  className={`flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center transition ${
                    sourceImporting
                      ? 'text-indigo-500'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  aria-label="上传文件"
                >
                  <Plus size={26} strokeWidth={1.5} />
                </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
  };

  const renderSharedWorkspacePanel = useCallback((tab: SharedWorkspaceTab) => {
    if (tab === 'highlights') {
      return (
        <HighlightsPanel
          topics={highlightTopics}
          selectedTopic={selectedTopic}
          onTopicSelect={setSelectedTopic}
          onPlayTopic={handlePlayTopic}
          onSeek={handleUnifiedSeek}
          onPlayAll={handlePlayAll}
          isPlayingAll={isPlayingAll}
          playAllIndex={playAllIndex}
          currentTime={currentTime}
          totalDuration={totalDuration}
          isLoading={isLoadingTopics}
          onGenerate={handleGenerateTopics}
          onRegenerateByTheme={handleRegenerateByTheme}
          onClear={handleClearTopics}
        />
      );
    }

    if (tab === 'summary') {
      return (
        <SummaryPanel
          summary={classSummary}
          isLoading={isLoadingSummary}
          onGenerate={handleGenerateSummary}
          onSeek={handleUnifiedSeek}
          onAddNote={(text, takeaway) => {
            handleAddNote(text, 'takeaways', {
              selectedText: takeaway.label,
              extra: { timestamps: takeaway.timestamps }
            });
          }}
        />
      );
    }

    if (tab === 'apps') {
      return (
        <WorkshopYellowPage
          sessionId={sessionId}
          dataSource={dataSource}
          transcript={segments}
          anchors={anchors}
          summaryOverview={classSummary?.overview}
          keyDifficulties={classSummary?.keyDifficulties}
          onOpenAppWindow={openWorkshopWindow}
        />
      );
    }

    return (
      <NotesPanel
        notes={notes}
        onAddNote={handleAddNote}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
        onSeek={handleUnifiedSeek}
      />
    );
  }, [
    anchors,
    classSummary,
    currentTime,
    dataSource,
    handleAddNote,
    handleClearTopics,
    handleDeleteNote,
    handleGenerateSummary,
    handleGenerateTopics,
    handlePlayAll,
    handlePlayTopic,
    handleRegenerateByTheme,
    handleUnifiedSeek,
    handleUpdateNote,
    highlightTopics,
    isLoadingSummary,
    isLoadingTopics,
    isPlayingAll,
    notes,
    openWorkshopWindow,
    playAllIndex,
    selectedTopic,
    segments,
    setSelectedTopic,
    sessionId,
    totalDuration,
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
    topics: memoryService.extractTopics(timeline.segments).map(t => ({
      id: t.id,
      title: t.title,
      startMs: t.startMs,
      endMs: t.endMs,
    })),
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

  if (showSplash) {
    return (
      <AppLoading 
        progress={loadingProgress}
        message={loadingProgress >= 100 ? '即将进入' : undefined}
        onComplete={loadingProgress >= 100 ? handleSplashComplete : undefined}
      />
    );
  }

  const shouldAllowPageScroll = !isMobile && (viewMode === 'record' || (viewMode === 'review' && !!videoSource));
  const useFixedViewportLayout = !(!isMobile && viewMode === 'record');
  const rootClassName = isDesktopMobilePreview
    ? 'relative flex h-full min-h-0 flex-col overflow-hidden'
    : `${useFixedViewportLayout ? 'h-dvh' : 'min-h-dvh'} flex flex-col main-content-enter browser-safe-top ${
        shouldAllowPageScroll ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
      }`;
  const rootStyle = isDesktopMobilePreview
    ? { height: '100%' as const }
    : useFixedViewportLayout
      ? { height: '100dvh', minHeight: '-webkit-fill-available' }
      : { minHeight: '100dvh' };

  return (
    <div
      className={rootClassName}
      style={rootStyle}
    >
      {/* NOTE: cleaned corrupted legacy comment. */}
      {!isMobile && <DegradedModeBanner status={serviceStatus} />}
      
      {/* NOTE: cleaned corrupted legacy comment. */}
      {!isMobile && (
        <Header 
          lessonTitle={viewMode === 'record' ? '课堂收集' : '课堂复习'}
          courseName=""
          viewMode={viewMode}
        />
      )}

      {/* NOTE: cleaned corrupted legacy comment. */}
      {!isMobile && (
        <div className="border-b px-6 py-3 no-print flex-shrink-0 relative z-20" style={{ background: 'var(--edu-bg-secondary)', borderColor: 'var(--edu-border-light)' }}>
          <div className="flex items-center justify-between">
            <div 
              className="flex items-center gap-2 p-1 rounded-xl" 
              style={{ background: 'var(--edu-bg-soft)' }}
            >
              <button
                onClick={() => handleViewModeChange('record')}
                data-testid="mode-record-button"
                className={`mode-tab flex items-center gap-1.5 ${viewMode === 'record' ? 'active' : ''}`}
              >
                <Mic size={14} strokeWidth={ICON_TAB_STROKE} />
                收集
              </button>
              <button
                onClick={() => handleViewModeChange('review')}
                data-testid="mode-review-button"
                className={`mode-tab flex items-center gap-1.5 ${viewMode === 'review' ? 'active' : ''}`}
              >
                <BookOpen size={14} strokeWidth={ICON_TAB_STROKE} />
                复习
              </button>
            </div>
            
              <div className="flex items-center gap-4">
              <ServiceStatus compact pollInterval={60000} />
              
              <div className="flex items-center gap-3 text-sm min-w-0 flex-wrap">
                <span className={`badge ${dataSource === 'live' ? 'badge-live' : 'badge-demo'} flex-shrink-0`}>
                  {dataSource === 'live' ? '实时' : dataSource === 'video' ? '视频' : '演示'}
                </span>
                
                <div className="flex items-center gap-2 text-gray-500 min-w-0 flex-wrap">
                  <span className="whitespace-nowrap">困惑点</span>
                  <span className="font-semibold text-navy">{anchors.length}</span>
                    {unresolvedCount > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span data-testid="unresolved-count" data-count={unresolvedCount} className="text-[#FADEC9] font-semibold whitespace-nowrap">{unresolvedCount} 待解决</span>
                      </>
                    )}
                  </div>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* 主内容区 */}
      {viewMode === 'record' ? (
        <>
          {/* NOTE: cleaned corrupted legacy comment. */}
          {isMobile ? (
            <>
              {renderMobileRecordView()}
            </>
          ) : (
            <div className="flex-1 min-h-0 page-enter" style={{ background: 'var(--edu-bg-primary)' }}>
              {renderMobileRecordView({ desktopShell: true })}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Desktop review layout */}
          {!isMobile ? (
            <div
              className={`flex-1 min-h-0 flex page-enter ${videoSource ? 'overflow-visible' : 'overflow-hidden'}`}
              style={{ background: 'var(--edu-bg-primary)' }}
            >
              {videoSource ? (
                <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                  {/* NOTE: cleaned corrupted legacy comment. */}
                  <div className="min-h-0 flex flex-col lg:w-[55%] xl:w-[58%] border-r" style={{ borderColor: 'var(--edu-border-light)' }}>
                    {/* NOTE: cleaned corrupted legacy comment. */}
                    <div className="shrink-0 bg-black">
                      <VideoReviewPlayer
                        source={videoSource}
                        className="w-full"
                        seekToMs={currentTime}
                        seekNonce={videoSeekNonce}
                        playNonce={videoPlayNonce}
                        onTimeUpdate={setCurrentTime}
                        totalDurationMs={totalDuration}
                      />
                    </div>

                    {/* Collapsible transcript strip. */}
                    <div className="shrink-0 border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                      <button
                        onClick={() => uiActions.toggleTranscriptBar()}
                        className="w-full flex items-center justify-between px-4 py-2 text-xs hover:bg-gray-50 transition-colors"
                        style={{ background: 'var(--edu-bg-soft)' }}
                      >
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-gray-500 font-medium">转录字幕</span>
                          <span className="text-gray-400">{segments.length} 段</span>
                        </div>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showTranscriptBar ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {showTranscriptBar && (
                        <div className="max-h-[300px] overflow-y-auto px-4 py-3 bg-white">
                          <TranscriptFlowView
                            segments={segments}
                            variant="video"
                            currentTime={currentTime}
                            editable={true}
                            onSegmentTextUpdate={handleTranscriptTextUpdate}
                            enableWordExplainer={true}
                            fullContextText={segments.map(s => `[${formatTime(s.startMs)}] ${s.text}`).join('\n')}
                            onTimestampClick={(timeMs) => handleUnifiedSeek(timeMs, true)}
                            onMarkConfusion={(timeMs, _segmentId) => {
                              handleAnchorMark(timeMs);
                            }}
                            confusionTimestamps={anchors.map(a => ({ timestamp: a.timestamp, resolved: a.resolved }))}
                            defaultExpanded={true}
                            showHeader={true}
                            headerTitle="视频内容"
                          />
                        </div>
                      )}
                    </div>

                    {/* Visual timeline and highlighted dialogue rounds. */}
                    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--edu-bg-primary)' }}>
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">高亮时间轴</span>
                            <span className="text-xs text-gray-400">{videoInsightItems.filter(i => !i.id.startsWith('seed-')).length} 条片段</span>
                          </div>
                        </div>
                        <VideoInsightTimeline
                          items={videoInsightItems}
                          activeItemId={activeVideoInsightId}
                          totalDuration={totalDuration}
                          formatTime={formatTime}
                          onSelectItem={setActiveVideoInsightId}
                          onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
                        />
                        {videoInsightItems.length === 0 && (
                          <div className="py-10 text-center">
                            <div className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center bg-gray-50">
                              <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <p className="text-sm text-gray-400 mb-1">暂时还没有高亮</p>
                            <p className="text-xs text-gray-300">当右侧开始对话或标记重点后，这里会慢慢长出时间线。</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* NOTE: cleaned corrupted legacy comment. */}
                  <div className="min-h-0 flex flex-col flex-1 bg-white overflow-hidden">
                    {/* NOTE: cleaned corrupted legacy comment. */}
                    <div
                      className="flex items-center gap-0.5 px-3 py-2 border-b shrink-0 overflow-x-auto"
                      style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}
                    >
                      {VIDEO_WORKSPACE_TABS.map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => {
                            setVideoWorkspaceTab(tab.key);
                            if (tab.key !== 'confusion') setConfusionChatAnchor(null);
                          }}
                          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-all whitespace-nowrap ${
                            videoWorkspaceTab === tab.key
                              ? 'bg-white text-[#787774] font-medium'
                              : 'text-gray-500 hover:text-gray-800 hover:bg-white/60'
                          }`}
                        >
                          {tab.LucideIcon && <tab.LucideIcon size={ICON_TAB} strokeWidth={ICON_TAB_STROKE} />}
                          {tab.label}
                          {tab.key === 'confusion' && anchors.filter(a => !a.resolved).length > 0 && (
                            <span className="ml-0.5 w-1.5 h-1.5 bg-red-400 rounded-full inline-block animate-pulse" />
                          )}
                          {tab.key === 'highlights' && highlightTopics.length > 0 && (
                            <span className="ml-0.5 text-xs opacity-60">({highlightTopics.length})</span>
                          )}
                          {tab.key === 'notes' && notes.length > 0 && (
                            <span className="ml-0.5 text-xs opacity-60">({notes.length})</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* NOTE: cleaned corrupted legacy comment. */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {/* NOTE: cleaned corrupted legacy comment. */}
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

                      {/* NOTE: cleaned corrupted legacy comment. */}
                      {videoWorkspaceTab === 'confusion' && (
                        <div className="h-full overflow-hidden flex flex-col">
                          {confusionChatAnchor ? (
                            <>
                              {/* NOTE: cleaned corrupted legacy comment. */}
                              <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                                <button
                                  onClick={() => setConfusionChatAnchor(null)}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200/60 transition-colors text-gray-500"
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
                              {/* NOTE: cleaned corrupted legacy comment. */}
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
                              {/* 閺嶅洩顔囬崶鐗堝劀閹稿鎸?*/}
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
                                    <span className="text-xs text-gray-400">{anchors.length} 个困惑点</span>
                                    {anchors.filter(a => !a.resolved).length > 0 && (
                                      <span className="text-xs text-red-400">{anchors.filter(a => !a.resolved).length} 个待解决</span>
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
                                      className={`w-full text-left p-3 rounded-xl border transition-all hover:shadow-sm group ${
                                        anchor.resolved
                                          ? 'border-green-100 bg-green-50/50'
                                          : 'border-[#E9E9E7] bg-[#FDF3C0]/20 hover:border-[#E9E9E7]'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${anchor.resolved ? 'bg-green-400' : 'bg-[#FADEC9]'}`} />
                                        <span className="text-xs font-mono text-gray-400">{formatTime(anchor.timestamp)}</span>
                                        <span className="text-xs text-gray-500">困惑点 #{index + 1}</span>
                                        {anchor.resolved ? (
                                          <span className="text-xs text-green-500 ml-auto">已解决</span>
                                        ) : (
                                        <span className="ml-auto text-xs text-[#787774]">点击对话</span>
                                        )}
                                      </div>
                                      {anchor.note && (
                                        <p className="mt-1.5 text-sm text-gray-600 line-clamp-2 pl-4">{anchor.note}</p>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <div className="py-10 text-center">
                                  <div className="w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center bg-gray-50">
                                    <svg className="w-7 h-7 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </div>
                                  <p className="mb-1 text-sm text-gray-400">暂时还没有困惑点</p>
                                  <p className="text-xs text-gray-300">点击上方按钮，标记你没听懂的地方。</p>
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
              {/* NOTE: cleaned corrupted legacy comment. */}
              <ResizablePanel
                className="flex-1"
                defaultLeftWidth={320}
                minLeftWidth={260}
                maxLeftWidth={820}
                storageKey="meetmind-left-panel-width"
                leftPanel={
                  /* NOTE: cleaned corrupted legacy comment. */
                  <div className="h-full flex flex-col bg-white" style={{ borderRight: '1px solid var(--edu-border-light)' }}>
                    {/* NOTE: cleaned corrupted legacy comment. */}
                    <div 
                      className="flex items-center gap-1 px-3 py-2.5 border-b overflow-x-auto flex-shrink-0 relative z-10 tab-buttons-container" 
                      style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}
                    >
                      {REVIEW_WORKSPACE_TABS.map((tab) => (
                        <button
                          key={tab.key}
                          data-testid={tab.testId}
                          onClick={() => setReviewTab(tab.key)}
                          className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-all whitespace-nowrap tab-button ${
                            reviewTab === tab.key
                              ? 'bg-white text-[#787774] font-medium'
                              : 'text-gray-500 hover:text-navy hover:bg-white/50'
                          }`}
                        >
                          {tab.LucideIcon && <tab.LucideIcon size={ICON_TAB} strokeWidth={ICON_TAB_STROKE} />}
                          {tab.label}
                          {tab.key === 'anchor-detail' && selectedAnchor && !selectedAnchor.resolved && (
                            <span className="ml-1 w-2 h-2 bg-[#FADEC9] rounded-full inline-block animate-pulse" />
                          )}
                          {tab.key === 'highlights' && highlightTopics.length > 0 && (
                            <span className="ml-1 text-xs text-skyblue-600">({highlightTopics.length})</span>
                          )}
                          {tab.key === 'summary' && classSummary && <span className="ml-1 text-xs text-mint-600">OK</span>}
                          {tab.key === 'notes' && notes.length > 0 && (
                            <span className="ml-1 text-xs text-[#787774]">({notes.length})</span>
                          )}
                        </button>
                      ))}
                    </div>
                    
                    {/* NOTE: cleaned corrupted legacy comment. */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {reviewTab === 'timeline' && timelineForView && (
                        <TimelineView
                          timeline={timelineForView}
                          currentTime={currentTime}
                          selectedBreakpoint={selectedBreakpoint}
                          onTimeClick={handleTimelineClick}
                          onBreakpointClick={(bp) => {
                            const anchor = anchors.find(a => a.id === bp.id);
                            if (anchor) handleAnchorSelect(anchor);
                          }}
                          onSegmentTextUpdate={handleTranscriptTextUpdate}
                          enableWordExplainer={true}
                          fullContextText={segments.map(s => `[${formatTime(s.startMs)}] ${s.text}`).join('\n')}
                        />
                      )}
                      
                      {reviewTab === 'anchor-detail' && (
                        <AnchorDetailPanel
                          anchor={selectedAnchor}
                          segments={segments}
                          onSeek={(timeMs) => {
                            handleUnifiedSeek(timeMs);
                          }}
                          onPlay={(startMs) => {
                            waveformRef.current?.seekTo(startMs);
                            waveformRef.current?.play();
                          }}
                          onResolve={handleResolveAnchor}
                          onAddNote={(text, anchorId) => {
                            handleAddNote(text, 'anchor', {
                              anchorId,
                              timestamp: selectedAnchor?.timestamp,
                            });
                          }}
                          onClose={() => setReviewTab('timeline')}
                        />
                      )}
                      
                      {isSharedWorkspaceTab(reviewTab) && renderSharedWorkspacePanel(reviewTab)}
                    </div>
                  </div>
                }
                rightPanel={
                  /* NOTE: cleaned corrupted legacy comment. */
                  <div className="h-full flex flex-col bg-white ai-chat-container">
                    {/* NOTE: cleaned corrupted legacy comment. */}
                    {(audioBlob || audioUrl) && (
                      <div className="flex-shrink-0 border-b" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)', maxHeight: '120px' }}>
                        <WaveformPlayer
                          ref={waveformRef}
                          src={audioBlob || audioUrl || undefined}
                          anchors={anchors.map(a => ({
                            id: a.id,
                            timestamp: a.timestamp,
                            resolved: a.resolved,
                            type: a.type,
                          } as WaveformAnchor))}
                          onTimeUpdate={setCurrentTime}
                          onPlayStateChange={setIsPlaying}
                          onAnchorClick={(anchor) => {
                            const found = anchors.find(a => a.id === anchor.id);
                            if (found) handleAnchorSelect(found);
                          }}
                          onAnchorAdd={handlePlaybackAnchorAdd}
                          allowAddAnchor={true}
                          selectedAnchorId={selectedAnchor?.id}
                          compact={true}
                        />
                      </div>
                    )}
                    
                    {/* NOTE: cleaned corrupted legacy comment. */}
                    <div className="flex-1 min-h-0 flex flex-col" style={{ minHeight: 'var(--ai-chat-min-height, 300px)' }}>
                      {/* NOTE: cleaned corrupted legacy comment. */}
                      {!showConversationHistory && (
                        <div 
                          className="flex-shrink-0 px-3 py-2 flex items-center gap-2 border-b"
                          style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}
                        >
                          <button
                            onClick={() => setSelectedAnchor(null)}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-all flex items-center gap-1.5 ${
                              !selectedAnchor
                                ? 'bg-[#232322] text-white'
                                : 'bg-white text-gray-600 hover:text-[#787774] hover:bg-[#EFEFEF] border border-gray-200'
                            }`}
                            title="基于整节课内容与 AI 对话"
                          >
                            <span>对话</span>
                            整节课对话
                          </button>
                          {selectedAnchor && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-[#E9E9E7] text-xs">
                              <span className={`w-2 h-2 rounded-full ${selectedAnchor.resolved ? 'bg-mint' : 'bg-[#FADEC9] animate-pulse'}`} />
                              <span className="text-[#232322] font-medium">
                                困惑点 {formatTime(selectedAnchor.timestamp)}
                              </span>
                              <button
                                onClick={() => setSelectedAnchor(null)}
                                className="ml-1 text-gray-400 hover:text-gray-600"
                                title="返回整节课对话"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          )}
                          {!selectedAnchor && anchors.length > 0 && (
                            <span className="text-xs text-gray-400 ml-auto">
                              点击左侧困惑点可切换到针对性解答
                            </span>
                          )}
                        </div>
                      )}
                      
                      {/* NOTE: cleaned corrupted legacy comment. */}
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {showConversationHistory ? (
                          selectedHistoryConversation ? (
                            <div className="h-full flex flex-col">
                              <div className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                                <span className="text-sm text-gray-600 truncate flex-1 mr-2">{selectedHistoryConversation.title}</span>
                                <div className="flex items-center gap-1">
                                  {/* Back to list icon button. */}
                                  <button
                                    onClick={() => setSelectedHistoryConversation(null)}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-navy hover:bg-gray-100 transition-colors"
                                    title="返回列表"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                    </svg>
                                  </button>
                                  {/* NOTE: cleaned corrupted legacy comment. */}
                                  <button
                                    onClick={() => {
                                      setShowConversationHistory(false);
                                      setSelectedHistoryConversation(null);
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-[#232322] hover:text-[#232322] hover:bg-[#EFEFEF] transition-colors"
                                    title="新对话"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                              <div className="flex-1 min-h-0">
                                <AIChat
                                  conversationId={selectedHistoryConversation.conversationId}
                                  sessionId={sessionId}
                                  contextText={tutorSupportContextText}
                                  onTimestampClick={(timeMs) => {
                                    handleUnifiedSeek(timeMs, true);
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col">
                              <div className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                                <span className="text-sm font-medium text-navy">历史对话</span>
                                {/* NOTE: cleaned corrupted legacy comment. */}
                                <button
                                  onClick={() => {
                                    setShowConversationHistory(false);
                                    setSelectedHistoryConversation(null);
                                  }}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[#787774] hover:text-[#232322] hover:bg-[#EFEFEF] transition-colors"
                                  title="新对话"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                  </svg>
                                </button>
                              </div>
                              <div className="flex-1 min-h-0">
                                <ConversationList
                                  sessionId={sessionId}
                                  onSelect={(conv) => setSelectedHistoryConversation(conv)}
                                  showSearch={true}
                                  maxHeight="100%"
                                />
                              </div>
                            </div>
                          )
                        ) : (
                          <AITutor
                            breakpoint={mobileAIPreferSelectedContext && mobileAILaunchTarget === 'review-panel' ? null : selectedBreakpoint}
                            segments={segments}
                            isLoading={false}
                            onResolve={handleResolveAnchor}
                            onActionItemsUpdate={handleActionItemsUpdate}
                            sessionId={sessionId}
                            supportContextText={tutorSupportContextText}
                            preferSupportContext={mobileAILaunchTarget === 'review-panel' ? mobileAIPreferSelectedContext : false}
                            launchQuestion={mobileAILaunchTarget === 'review-panel' && mobileAIConsumedQuestionNonce !== mobileAIQuestionNonce ? mobileAIQuestion : ''}
                            launchDisplayText={mobileAILaunchTarget === 'review-panel' ? mobileAIDisplayQuestion : ''}
                            launchImages={mobileAILaunchTarget === 'review-panel' ? mobileAILaunchImages : []}
                            launchQuestionNonce={mobileAILaunchTarget === 'review-panel' ? mobileAIQuestionNonce : 0}
                            onLaunchQuestionConsumed={mobileAILaunchTarget === 'review-panel' ? consumeMobileAIQuestion : undefined}
                            onSeek={(timeMs) => {
                              handleUnifiedSeek(timeMs, true);
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                }
              />

              {/* NOTE: cleaned corrupted legacy comment. */}
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
          ) : (
            /* 手机端主内容区 */
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white">
              <div className="flex-shrink-0 bg-[#F7F7F5] px-4 pb-2 pt-[max(env(safe-area-inset-top),10px)]">
                <div className="mx-auto flex w-full max-w-md items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#5B6ABF] text-white">
                    <GraduationCap size={16} strokeWidth={2} />
                  </div>

                  <div className="flex min-w-0 flex-1 items-center justify-center">
                    <MobileTabSwitch
                      activeTab={viewMode}
                      onTabChange={(tab) => handleViewModeChange(tab)}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    {isAuthenticated && user ? (
                      <button
                        onClick={() => setIsMenuOpen(true)}
                        className="h-8 w-8 overflow-hidden rounded-full"
                      >
                        <Avatar className="h-full w-full">
                          {user.avatar ? (
                            <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                          ) : null}
                          <AvatarFallback className="bg-slate-100 text-xs text-slate-500">用户</AvatarFallback>
                        </Avatar>
                      </button>
                    ) : (
                      <a
                        href="/login"
                        className="inline-flex h-7 items-center justify-center rounded-full bg-[#5B6ABF] px-2.5 text-[11px] font-medium text-white"
                      >
                        登录
                      </a>
                    )}

                    <DedaoMenuButton onClick={() => setIsMenuOpen(true)} />
                  </div>
                </div>
              </div>

              {/* NOTE: cleaned corrupted legacy comment. */}
              {!mobileSubPage && (
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
                    ref={waveformRef}
                    src={audioBlob || audioUrl || undefined}
                    anchors={anchors.map(a => ({
                      id: a.id,
                      timestamp: a.timestamp,
                      resolved: a.resolved,
                      type: a.type,
                    } as WaveformAnchor))}
                    onTimeUpdate={setCurrentTime}
                    onPlayStateChange={setIsPlaying}
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

              {/* NOTE: cleaned corrupted legacy comment. */}
              {mobileSubPage === null && (
                <>
                  {videoSource && (
                    <div className="px-4 pt-3">
                      <VideoReviewPlayer
                        source={videoSource}
                        seekToMs={currentTime}
                        seekNonce={videoSeekNonce}
                        playNonce={videoPlayNonce}
                        onTimeUpdate={setCurrentTime}
                        totalDurationMs={totalDuration}
                      />
                    </div>
                  )}

                  {/* NOTE: cleaned corrupted legacy comment. */}
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

                  {/* NOTE: cleaned corrupted legacy comment. */}
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

                  {/* 全局 AI 入口，适合基于当前课堂继续追问。 */}
                  <MobileAIFab
                    onClick={() => {
                      setSelectedAnchor(null);  // Clear selected anchor before entering global AI chat.
                      clearMobileAILaunchState();
                      setMobileSubPage('ai-chat');
                    }}
                    visible={!selectedConfusion}
                    pulse={segments.length > 0 && anchors.length === 0}
                    tooltip="和 AI 聊聊这节课"
                  />
                </>
              )}

              {/* NOTE: cleaned corrupted legacy comment. */}
              {mobileSubPage === 'ai-chat' && (
                <div className="flex-1 min-h-0 flex flex-col bg-[#F7F7F5]">
                  <div className="flex-shrink-0 px-3 pb-2 pt-2">
                    <div className="rounded-[24px] border border-[#E9E9E7] bg-white/94 px-3 py-2.5 shadow-[0_12px_24px_rgba(148,163,184,0.08)]">
                      <div className="flex items-start gap-2.5">
                        <button
                          onClick={() => {
                            // 如果没有有效的复习内容（无 segments），直接返回收集页
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
                          className="flex h-9 w-9 items-center justify-center rounded-[14px] border border-[#efe5d8] bg-white text-slate-600 shadow-[0_6px_14px_rgba(148,163,184,0.08)] transition hover:-translate-y-0.5 hover:text-slate-900"
                          aria-label="返回"
                        >
                          <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[15px] font-semibold tracking-[-0.03em] text-slate-900">AI 助教</p>
                            <span className="inline-flex items-center rounded-full bg-[#f6efe6] px-2 py-1 text-[10px] font-semibold text-[#9a6b2f]">
                              {showConversationHistory
                                ? '历史对话'
                                : mobileAIPreferSelectedContext && mobileAILaunchTarget === 'mobile-ai-chat'
                                  ? '跟随已选内容'
                                  : '跟随当前课堂'}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-4.5 text-slate-500">
                            {showConversationHistory
                              ? '回看这节课之前的问答，快速接回思路。'
                              : mobileAIPreferSelectedContext && mobileAILaunchTarget === 'mobile-ai-chat'
                                ? '优先围绕你刚圈出的重点继续，不用来回切换。'
                                : '不离开复习，直接把这节课继续问下去。'}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-1 rounded-[14px] border border-[#efe5d8] bg-[#f7f2eb] p-1">
                          <button
                            onClick={() => {
                              setShowConversationHistory(false);
                              setSelectedHistoryConversation(null);
                            }}
                            className={`inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[11px] font-medium transition-all ${
                              !showConversationHistory
                                ? 'bg-white text-[#c57a16] shadow-[0_6px_14px_rgba(148,163,184,0.10)]'
                                : 'text-slate-400 hover:text-slate-600'
                            }`}
                            title="当前对话"
                          >
                            <MessageCircle size={13} strokeWidth={1.9} />
                            <span>当前</span>
                          </button>
                          <button
                            onClick={() => setShowConversationHistory(true)}
                            className={`inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[11px] font-medium transition-all ${
                              showConversationHistory
                                ? 'bg-white text-[#c57a16] shadow-[0_6px_14px_rgba(148,163,184,0.10)]'
                                : 'text-slate-400 hover:text-slate-600'
                            }`}
                            title="历史对话"
                          >
                            <History size={13} strokeWidth={1.9} />
                            <span>历史</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2">
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
                            setSelectedAnchor(anchor);
                          }
                        }}
                        className="overflow-hidden rounded-[20px] border border-[#efe5d8] shadow-[0_10px_24px_rgba(148,163,184,0.08)]"
                      />
                    </div>
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden rounded-[28px] border border-[#E9E9E7] bg-white/92 px-3 pb-3 shadow-[0_18px_38px_rgba(148,163,184,0.10)]">
                    {showConversationHistory ? (
                      selectedHistoryConversation ? (
                        // 历史对话详情
                        <div className="h-full flex flex-col">
                          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-xs text-gray-600 truncate flex-1 mr-2">{selectedHistoryConversation.title}</span>
                            <div className="flex items-center gap-1">
                              {/* 返回列表 */}
                              <button
                                onClick={() => setSelectedHistoryConversation(null)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                                title="返回列表"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                </svg>
                              </button>
                              {/* NOTE: cleaned corrupted legacy comment. */}
                              <button
                                onClick={() => {
                                  setShowConversationHistory(false);
                                  setSelectedHistoryConversation(null);
                                }}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#EFEFEF]"
                                title="新对话"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <div className="flex-1 min-h-0">
                            <AIChat
                              conversationId={selectedHistoryConversation.conversationId}
                              sessionId={sessionId}
                              isMobile={true}
                              contextText={tutorSupportContextText}
                              onTimestampClick={(timeMs) => {
                                handleUnifiedSeek(timeMs, true);
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        // 历史对话列表
                        <ConversationList
                          sessionId={sessionId}
                          onSelect={(conv) => setSelectedHistoryConversation(conv)}
                          showSearch={true}
                          maxHeight="100%"
                        />
                      )
                    ) : (
                      // NOTE: cleaned corrupted legacy comment.
                      <AITutor
                        breakpoint={mobileAIPreferSelectedContext && mobileAILaunchTarget === 'mobile-ai-chat' ? null : selectedBreakpoint}
                        segments={segments}
                        isLoading={false}
                        onResolve={handleResolveAnchor}
                        onActionItemsUpdate={handleActionItemsUpdate}
                        sessionId={sessionId}
                        supportContextText={tutorSupportContextText}
                        preferSupportContext={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAIPreferSelectedContext : false}
                        launchQuestion={mobileAILaunchTarget === 'mobile-ai-chat' && mobileAIConsumedQuestionNonce !== mobileAIQuestionNonce ? mobileAIQuestion : ''}
                        launchDisplayText={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAIDisplayQuestion : ''}
                        launchImages={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAILaunchImages : []}
                        launchQuestionNonce={mobileAILaunchTarget === 'mobile-ai-chat' ? mobileAIQuestionNonce : 0}
                        onLaunchQuestionConsumed={mobileAILaunchTarget === 'mobile-ai-chat' ? consumeMobileAIQuestion : undefined}
                        isMobile={true}
                        hideMobileHeader={true}
                        onSeek={(timeMs) => {
                          handleUnifiedSeek(timeMs, true);
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* NOTE: cleaned corrupted legacy comment. */}
              {mobileSubPage === 'highlights' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">精选片段</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <HighlightsPanel
                      topics={highlightTopics}
                      selectedTopic={selectedTopic}
                      onTopicSelect={setSelectedTopic}
                      onPlayTopic={handlePlayTopic}
                      onSeek={handleUnifiedSeek}
                      onPlayAll={handlePlayAll}
                      isPlayingAll={isPlayingAll}
                      playAllIndex={playAllIndex}
                      currentTime={currentTime}
                      totalDuration={totalDuration}
                      isLoading={isLoadingTopics}
                      onGenerate={handleGenerateTopics}
                      onRegenerateByTheme={handleRegenerateByTheme}
                      onClear={handleClearTopics}
                    />
                  </div>
                </div>
              )}

              {/* NOTE: cleaned corrupted legacy comment. */}
              {mobileSubPage === 'summary' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">课堂摘要</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <SummaryPanel
                      summary={classSummary}
                      isLoading={isLoadingSummary}
                      onGenerate={handleGenerateSummary}
                      onSeek={handleUnifiedSeek}
                      onAddNote={(text, takeaway) => {
                        handleAddNote(text, 'takeaways', {
                          selectedText: takeaway.label,
                          extra: { timestamps: takeaway.timestamps }
                        });
                      }}
                    />
                  </div>
                </div>
              )}

              {/* NOTE: cleaned corrupted legacy comment. */}
              {mobileSubPage === 'notes' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">我的笔记</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <NotesPanel
                      notes={notes}
                      onAddNote={handleAddNote}
                      onUpdateNote={handleUpdateNote}
                      onDeleteNote={handleDeleteNote}
                      onSeek={handleUnifiedSeek}
                    />
                  </div>
                </div>
              )}

              {/* NOTE: cleaned corrupted legacy comment. */}
              {mobileSubPage === 'apps' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">AI工坊</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {renderSharedWorkspacePanel('apps')}
                  </div>
                </div>
              )}

              {/* NOTE: cleaned corrupted legacy comment. */}
              {mobileSubPage === 'tasks' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => setMobileSubPage(null)}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">今日任务</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ActionList
                      items={actionItems}
                      onComplete={handleActionComplete}
                      onStartNext={handleStartNextAction}
                    />
                  </div>
                </div>
              )}

              {/* Right-side drawer menu. */}
              <DedaoMenu
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                onNavigate={(page) => setMobileSubPage(page)}
                showApps={true}
                userRole="student"
                badges={{
                  highlights: highlightTopics.length,
                  notes: notes.length,
                  apps: segments.length > 0 ? 1 : 0,
                  tasks: actionItems.filter(i => !i.completed).length,
                }}
              />
            </div>
          )}
        </>
      )}

      {workspaceCaptureEditor ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/28 p-3 md:items-center">
          <button
            type="button"
            aria-label="关闭收集编辑器"
            className="absolute inset-0"
            onClick={closeWorkspaceCaptureEditor}
          />
          <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_28px_70px_rgba(15,23,42,0.22)]">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-slate-900">
                    {workspaceCaptureEditor.mode === 'transcript'
                      ? '校正文字'
                      : workspaceCaptureEditor.mode === 'text'
                        ? '编辑文字'
                        : '编辑标题/备注'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {workspaceCaptureEditor.mode === 'transcript'
                      ? '把这条转写校正成你真正想保留的版本。'
                      : workspaceCaptureEditor.mode === 'text'
                        ? '直接改这条文字收集，改完会同步回你正在看的收集里。'
                        : '改一下标题或补一句备注，后面更容易回看。'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeWorkspaceCaptureEditor}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                  aria-label="关闭编辑器"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="space-y-4 px-5 py-4">
              {workspaceCaptureEditor.mode === 'meta' ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-slate-700">标题</span>
                  <input
                    value={workspaceCaptureEditorTitle}
                    onChange={(event) => setWorkspaceCaptureEditorTitle(event.target.value)}
                    placeholder="给这条收集起个更好找的名字"
                    aria-label="收集标题"
                    className="w-full rounded-2xl border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-3 text-sm text-[#232322] outline-none transition focus:border-[#232322] focus:bg-white focus:ring-2 focus:ring-[#232322]/10"
                  />
                </label>
              ) : null}

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {workspaceCaptureEditor.mode === 'transcript'
                    ? '文字内容'
                    : workspaceCaptureEditor.mode === 'text'
                      ? '正文'
                      : '备注'}
                </span>
                <textarea
                  value={workspaceCaptureEditorBody}
                  onChange={(event) => setWorkspaceCaptureEditorBody(event.target.value)}
                  placeholder={
                    workspaceCaptureEditor.mode === 'transcript'
                      ? '把更准确的转写写在这里'
                      : workspaceCaptureEditor.mode === 'text'
                        ? '把你真正想保留的文字写在这里'
                        : '可选，补一句备注方便以后回看'
                  }
                  aria-label={
                    workspaceCaptureEditor.mode === 'transcript'
                      ? '收集转写文字'
                      : workspaceCaptureEditor.mode === 'text'
                        ? '收集正文'
                        : '收集备注'
                  }
                  rows={workspaceCaptureEditor.mode === 'meta' ? 4 : 8}
                  className="w-full resize-none rounded-2xl border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-3 text-sm leading-6 text-[#232322] outline-none transition focus:border-[#232322] focus:bg-white focus:ring-2 focus:ring-[#232322]/10"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={closeWorkspaceCaptureEditor}
                className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void saveWorkspaceCaptureEdit();
                }}
                disabled={isSavingWorkspaceCaptureEdit}
                className="rounded-full bg-[#232322] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#111111] disabled:cursor-not-allowed disabled:bg-[#232322]/40"
              >
                {isSavingWorkspaceCaptureEdit ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
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
      
      {/* 主要内容区域 */}
      <AISearchPanel
        open={showAISearch}
        onClose={() => setShowAISearch(false)}
        onNavigateToCapture={(captureId: string) => {
          const item = allCollectionItems.find((c) => c.id === captureId);
          if (item) {
            setShowAISearch(false);
            setMobileCollectionSheet(null);
            void openReviewFromCollectionListItem(item);
          }
        }}
        accessToken={accessToken}
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
    </div>
  );
}



// NOTE: cleaned corrupted legacy comment.
function SearchParamsReader() {
  const searchParams = useSearchParams();
  const isGuestFastEntry = searchParams.get('guest') === '1';
  const forcedWorkspaceTab = searchParams.get('workspace') === 'apps' ? 'apps' : null;
  const forceMobilePreview = searchParams.get('mobile') === '1';
  const wechatCaptureToken = searchParams.get('wechat_capture');

  if (forceMobilePreview) {
    return (
      <div className="min-h-dvh bg-[#F7F7F5]">
        <div className="flex items-start justify-center px-5 pb-10 pt-6">
          <div className="relative h-[860px] w-[400px] rounded-[44px] bg-[#0b1220] p-[10px] shadow-[0_35px_80px_rgba(15,23,42,0.32)]">
            <div className="absolute left-1/2 top-[18px] z-20 h-7 w-32 -translate-x-1/2 rounded-full bg-[#0b1220]" />
            <div className="relative h-full overflow-hidden rounded-[34px] bg-[#f7f3ec]">
              <StudentAppContent
                isGuestFastEntry={isGuestFastEntry}
                forcedWorkspaceTab={forcedWorkspaceTab}
                forceMobilePreview
                wechatCaptureToken={wechatCaptureToken}
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
      wechatCaptureToken={wechatCaptureToken}
    />
  );
}

// NOTE: cleaned corrupted legacy comment.
export default function StudentApp() {
  return (
    <Suspense fallback={<AppLoading message="正在加载..." />}>
      <SearchParamsReader />
    </Suspense>
  );
}
