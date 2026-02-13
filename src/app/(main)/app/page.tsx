'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Header } from '@/components/Header';
import { ServiceStatus, DegradedModeBanner } from '@/components/ServiceStatus';
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
import { useResponsive } from '@/hooks/useResponsive';
import { UIConfig } from '@/lib/config';
import { toast } from 'sonner';

// SWR 数据 Hooks - 统一管理 API 请求
import { useTopics, useSummary } from '@/hooks/data';

// WaveformPlayer 使用 forwardRef，需要静态导入以支持 ref
import { WaveformPlayer, type WaveformPlayerRef, type WaveformAnchor } from '@/components/WaveformPlayer';

// 开屏动画组件
import { AppLoading } from '@/components/AppLoading';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// 静态导入所有组件 - 解决 Next.js dynamic import chunk 加载失败问题
import { Recorder } from '@/components/Recorder';
import { TimelineView } from '@/components/TimelineView';
import { ActionList } from '@/components/ActionList';
import { ActionSidebar } from '@/components/ActionSidebar';
import { ActionDrawer } from '@/components/ActionDrawer';
import { ResizablePanel } from '@/components/layout/ResizablePanel';
import { AudioUploader } from '@/components/AudioUploader';
import { VideoLinkImporter } from '@/components/VideoLinkImporter';
import { VideoReviewPlayer } from '@/components/VideoReviewPlayer';
import { AITutor } from '@/components/AITutor';
import { TranscriptPreviewPanel } from '@/components/TranscriptPreviewPanel';
import { TranscriptFlowView } from '@/components/TranscriptFlowView';
import { VideoInsightTimeline, type VideoInsightItem } from '@/components/VideoInsightTimeline';

import type { ConfusionMarker } from '@/components/mobile/PodcastPlayer';
import type { ConversationHistory } from '@/types/conversation';
import type { AudioSession } from '@/lib/db';

// 用户引导组件
import { useOnboarding } from '@/hooks/useOnboarding';
import { OnboardingGuide, WelcomeModal } from '@/components/OnboardingGuide';
import { HighlightsPanel } from '@/components/HighlightsPanel';
import { SummaryPanel } from '@/components/SummaryPanel';
import { NotesPanel } from '@/components/NotesPanel';
import { AnchorDetailPanel } from '@/components/AnchorDetailPanel';
import { AppMatrixPanel } from '@/components/apps/AppMatrixPanel';
import { ConversationList } from '@/components/ConversationHistory/ConversationList';
import { AIChat } from '@/components/AIChat';
import { SessionHistoryList } from '@/components/SessionHistoryList';

// 演示数据延迟加载
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

// 移动端组件导入 - 直接导入避免 barrel file 导致的 tree-shaking 失效
import { MiniPlayer } from '@/components/mobile/MiniPlayer';
import { MobileTabSwitch } from '@/components/mobile/MobileTabSwitch';
import { DedaoTimeline, toDedaoEntries } from '@/components/mobile/DedaoTimeline';
import { DedaoConfusionCard } from '@/components/mobile/DedaoConfusionCard';
import { DedaoMenu, DedaoMenuButton } from '@/components/mobile/DedaoMenu';
import { MobileAIFab } from '@/components/mobile/MobileAIFab';

type ViewMode = 'record' | 'review';
type DataSource = 'live' | 'demo' | 'video';

type SharedWorkspaceTab = 'highlights' | 'summary' | 'notes' | 'apps';
type WorkspaceTab = 'timeline' | 'anchor-detail' | 'chat' | 'confusion' | SharedWorkspaceTab;
type ReviewTab = Extract<WorkspaceTab, 'timeline' | 'anchor-detail' | SharedWorkspaceTab>;
type VideoWorkspaceTab = Extract<WorkspaceTab, 'chat' | 'confusion' | SharedWorkspaceTab>;

interface WorkspaceTabConfig<T extends WorkspaceTab> {
  key: T;
  label: string;
  icon: string;
  testId?: string;
}

const SHARED_WORKSPACE_TABS: WorkspaceTabConfig<SharedWorkspaceTab>[] = [
  { key: 'highlights', label: '精选', icon: '⚡' },
  { key: 'summary', label: '摘要', icon: '📝' },
  { key: 'apps', label: '应用矩阵', icon: '🧩', testId: 'review-tab-apps' },
  { key: 'notes', label: '笔记', icon: '📄' },
];

const VIDEO_WORKSPACE_TABS: WorkspaceTabConfig<VideoWorkspaceTab>[] = [
  { key: 'chat', label: '对话', icon: '💬' },
  { key: 'confusion', label: '困惑点', icon: '🎯' },
  ...SHARED_WORKSPACE_TABS,
];

const REVIEW_WORKSPACE_TABS: WorkspaceTabConfig<ReviewTab>[] = [
  { key: 'timeline', label: '时间轴', icon: '📋' },
  { key: 'anchor-detail', label: '困惑点', icon: '🎯' },
  ...SHARED_WORKSPACE_TABS,
];

function isSharedWorkspaceTab(tab: WorkspaceTab): tab is SharedWorkspaceTab {
  return tab === 'highlights' || tab === 'summary' || tab === 'notes' || tab === 'apps';
}

const ACTION_PROGRESS_KEY_PREFIX = 'action_progress:';

function getActionProgressKey(sessionId: string): string {
  return `${ACTION_PROGRESS_KEY_PREFIX}${sessionId}`;
}

interface ActionItem {
  id: string;
  type: 'replay' | 'exercise' | 'review';
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  relatedTimestamp?: number;
}

const VIDEO_INSIGHT_COLORS = ['#B48EFA', '#7FD4B2', '#7FADEB', '#F2AE8F', '#F0CD70', '#90D4DD'];

function compactText(value: string, maxLength: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildSeedVideoInsights(segments: TranscriptSegment[]): VideoInsightItem[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const valid = segments.filter((seg) => seg && typeof seg.text === 'string' && seg.text.trim().length > 0);
  if (valid.length === 0) return [];

  const maxPoints = 5;
  const step = Math.max(1, Math.floor(valid.length / maxPoints));
  const timestamps: number[] = [];
  for (let index = 0; index < valid.length && timestamps.length < maxPoints; index += step) {
    timestamps.push(Math.max(0, valid[index].startMs));
  }

  if (timestamps.length === 0) {
    timestamps.push(Math.max(0, valid[0].startMs));
  }

  return [
    {
      id: 'seed-overview',
      prompt: '导入完成，时间轴预览',
      summary: compactText(valid.slice(0, 3).map((seg) => seg.text).join(' '), 120),
      timestamps: Array.from(new Set(timestamps)).sort((a, b) => a - b),
      color: VIDEO_INSIGHT_COLORS[0],
    },
  ];
}

// 包装组件 - 处理 useSearchParams 需要 Suspense 边界的问题
function StudentAppContent({ isGuestFastEntry }: { isGuestFastEntry: boolean }) {
  // 开屏动画状态 - 访客快速入口跳过 Splash
  const [showSplash, setShowSplash] = useState(!isGuestFastEntry);
  const [appReady, setAppReady] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(isGuestFastEntry ? 50 : 0); // 访客模式从50%开始，感知更快
  
  // 获取当前登录用户
  const { user, isAuthenticated } = useAuth();
  
  // 响应式状态
  const { isMobile, mounted } = useResponsive();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedConfusion, setSelectedConfusion] = useState<ConfusionMarker | null>(null);
  const [mobileSubPage, setMobileSubPage] = useState<'highlights' | 'summary' | 'notes' | 'tasks' | 'apps' | 'ai-chat' | 'transcript' | null>(null);
  const [mobileAIQuestion, setMobileAIQuestion] = useState<string>(''); // 移动端AI对话的初始问题
  
  const [viewMode, setViewMode] = useState<ViewMode>('record');
  const [sessionId, setSessionId] = useState<string>('demo-session');
  const [isRecording, setIsRecording] = useState(false);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [timeline, setTimeline] = useState<ClassTimeline | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoSeekNonce, setVideoSeekNonce] = useState(0);
  const [videoPlayNonce, setVideoPlayNonce] = useState(0);
  const [dataSource, setDataSource] = useState<DataSource>('live');
  const [serviceStatus, setServiceStatus] = useState<ServiceStatusType | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [videoSource, setVideoSource] = useState<ImportedVideoSource | null>(null);
  
  // 新增状态：精选片段、摘要、笔记
  const [reviewTab, setReviewTab] = useState<ReviewTab>('timeline');
  const [videoWorkspaceTab, setVideoWorkspaceTab] = useState<VideoWorkspaceTab>('chat');
  const [showTranscriptBar, setShowTranscriptBar] = useState(false);
  const [confusionChatAnchor, setConfusionChatAnchor] = useState<Anchor | null>(null);
  const [videoInsightItems, setVideoInsightItems] = useState<VideoInsightItem[]>([]);
  const [activeVideoInsightId, setActiveVideoInsightId] = useState<string | null>(null);
  // 使用 SWR Hooks 管理精选片段和摘要 - 自动去重、缓存、重试
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
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);
  
  // 历史对话相关状态
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const [selectedHistoryConversation, setSelectedHistoryConversation] = useState<ConversationHistory | null>(null);
  
  // 录音历史相关状态
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  
  // 行动清单抽屉状态
  const [isActionDrawerOpen, setIsActionDrawerOpen] = useState(false);
  
  // 用户引导状态
  const [showWelcome, setShowWelcome] = useState(false);
  const onboarding = useOnboarding({ isMobile });
  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const waveformRef = useRef<WaveformPlayerRef>(null);
  const hasRestoredState = useRef(false);  // 是否已恢复状态

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

    // 兼容少数“秒单位”来源（如 46 表示 46s），统一转换为毫秒
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
    setVideoSeekNonce((prev) => prev + 1);
    if (autoPlay) {
      setVideoPlayNonce((prev) => prev + 1);
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
  
  // 引导结束后的清理：关闭引导期间打开的面板
  useEffect(() => {
    // 当引导结束时，关闭引导期间打开的面板
    if (!onboarding.isActive) {
      // 给用户一点时间看最后的操作结果，然后关闭面板
      const timer = setTimeout(() => {
        setIsActionDrawerOpen(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [onboarding.isActive]);
  
  // 录音中关闭/刷新页面时警告用户
  useEffect(() => {
    if (!isRecording) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isRecording]);

  // 获取当前用户的 studentId 和 studentName
  const studentId = user?.id || 'anonymous';
  const studentName = user?.nickname || user?.username || '匿名用户';

  const persistedCurrentTime = Math.max(0, Math.floor(currentTime / 5000) * 5000);

  // 保存应用状态到 IndexedDB（用于刷新恢复）
  const saveAppState = useCallback(async () => {
    if (!hasRestoredState.current) return;

    const snapshot: PersistedAppState = {
      version: APP_STATE_VERSION,
      savedAt: Date.now(),
      viewMode,
      sessionId,
      dataSource,
      showSessionHistory,
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
    showSessionHistory,
    showTranscriptBar,
    videoWorkspaceTab,
    viewMode,
  ]);

  // 当关键状态变化时保存
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
    setShowSessionHistory(false);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setActionItems([]);
    clearTopics();
    clearSummary();
    setNotes([]);
    liveSegmentsRef.current = loadedSegments;

    const isVideoSession = session.sourceType === 'video-link' && !!session.videoUrl;
    if (isVideoSession) {
      const provider = session.videoProvider || 'bilibili';
      const restoredSource: ImportedVideoSource = {
        provider,
        providerLabel: provider === 'bilibili' ? 'Bilibili' : provider,
        originalUrl: session.videoUrl || '',
        embedUrl: session.videoEmbedUrl,
        thumbnailUrl: session.thumbnailUrl,
        title: session.topic,
        durationSec: session.duration ? session.duration / 1000 : undefined,
        sourceMode: session.importSourceMode as ImportedVideoSource['sourceMode'],
        importTrace: session.importTrace as ImportedVideoSource['importTrace'],
        bvid: session.videoUrl?.match(/BV[a-zA-Z0-9]+/)?.[0],
      };
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
      } else {
        setAudioBlob(null);
      }
      setAudioUrl(null);
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

  // 初始化 - 恢复状态（仅在首次加载时执行）
  // 优化：使用并行加载和批量操作提升性能
  useEffect(() => {
    if (hasRestoredState.current) return;

    const initializeApp = async () => {
      const baseProgress = isGuestFastEntry ? 30 : 10;
      setLoadingProgress(baseProgress);

      const [, rawSavedAppState, savedOnboardingState] = await Promise.all([
        checkServices().then(setServiceStatus),
        getPersistedAppState(),
        getPreference<{ completedFlows?: string[]; skippedFlows?: string[] } | null>('onboarding_state', null).catch(() => null),
      ]);

      setLoadingProgress(isGuestFastEntry ? 60 : 40);

      const isFirstVisit = isGuestFastEntry || !savedOnboardingState ||
        (!savedOnboardingState.completedFlows?.includes('welcome') &&
         !savedOnboardingState.skippedFlows?.includes('welcome'));

      const normalizedSavedState = rawSavedAppState && typeof rawSavedAppState === 'object'
        ? rawSavedAppState
        : null;
      const hasFreshState = isPersistedAppStateFresh(normalizedSavedState);
      const savedAppState = hasFreshState ? normalizedSavedState : null;
      const finalViewMode: ViewMode = isFirstVisit && !savedAppState
        ? 'record'
        : (savedAppState?.viewMode || 'record');

      setLoadingProgress(isGuestFastEntry ? 75 : 50);

      if (savedAppState?.sessionId) {
        setSessionId(savedAppState.sessionId);
      }
      if (savedAppState?.reviewTab) {
        setReviewTab(savedAppState.reviewTab);
      }
      if (savedAppState?.videoWorkspaceTab) {
        setVideoWorkspaceTab(savedAppState.videoWorkspaceTab);
      }
      if (typeof savedAppState?.showTranscriptBar === 'boolean') {
        setShowTranscriptBar(savedAppState.showTranscriptBar);
      }
      if (savedAppState?.dataSource) {
        setDataSource(savedAppState.dataSource);
      }
      if (typeof savedAppState?.showSessionHistory === 'boolean') {
        setShowSessionHistory(savedAppState.showSessionHistory);
      }

      if (finalViewMode === 'review') {
        let restoredFromSession = false;
        if (savedAppState?.sessionId) {
          restoredFromSession = await restoreReviewSession(savedAppState.sessionId, {
            selectedAnchorId: savedAppState.selectedAnchorId || null,
            currentTime: savedAppState.currentTime,
            reviewTab: savedAppState.reviewTab || null,
            videoWorkspaceTab: savedAppState.videoWorkspaceTab || null,
            showTranscriptBar: savedAppState.showTranscriptBar,
          });
        }

        if (!restoredFromSession) {
          setViewMode('review');
          setSessionId('demo-session');
          setShowSessionHistory(false);
          setDataSource('demo');
          setVideoSource(null);
          setVideoInsightItems([]);
          setActiveVideoInsightId(null);
          setVideoWorkspaceTab('chat');
          setShowTranscriptBar(false);

          setLoadingProgress(60);

          const [demoData, existingTranscriptCount] = await Promise.all([
            loadDemoData(),
            db.transcripts.where('sessionId').equals('demo-session').count().catch(() => 0),
          ]);

          setLoadingProgress(80);

          setSegments(demoData.DEMO_SEGMENTS);
          setAudioUrl(demoData.DEMO_AUDIO_URL);
          setAudioBlob(null);
          setAnchors(demoData.DEMO_ANCHORS);

          const tl = memoryService.buildTimeline(
            'demo-session',
            demoData.DEMO_SEGMENTS,
            demoData.DEMO_ANCHORS,
            { subject: UIConfig.defaultSubject, teacher: 'Demo Teacher', date: new Date().toISOString().split('T')[0] }
          );
          setTimeline(tl);

          if (savedAppState?.selectedAnchorId) {
            const restoredAnchor = demoData.DEMO_ANCHORS.find((anchor) => anchor.id === savedAppState.selectedAnchorId);
            if (restoredAnchor) {
              setSelectedAnchor(restoredAnchor);
              setCurrentTime(restoredAnchor.timestamp);
            }
          } else if (typeof savedAppState?.currentTime === 'number' && Number.isFinite(savedAppState.currentTime)) {
            setSelectedAnchor(null);
            setCurrentTime(Math.max(0, Math.floor(savedAppState.currentTime)));
          } else {
            const firstUnresolved = demoData.DEMO_ANCHORS.find((anchor) => !anchor.resolved);
            if (firstUnresolved) {
              setSelectedAnchor(firstUnresolved);
              setCurrentTime(firstUnresolved.timestamp);
            }
          }

          if (savedAppState?.reviewTab) {
            setReviewTab(savedAppState.reviewTab);
          }

          setLoadingProgress(90);

          queueMicrotask(() => {
            classroomDataService.saveSession({
              id: 'demo-session',
              subject: UIConfig.defaultSubject,
              topic: 'Australia\'s Moving Experience',
              teacherName: 'Demo Teacher',
              duration: demoData.DEMO_SEGMENTS.length > 0 ? demoData.DEMO_SEGMENTS[demoData.DEMO_SEGMENTS.length - 1].endMs : 0,
              status: 'completed',
              createdBy: studentId,
            });

            const anchorsToAdd = demoData.DEMO_ANCHORS.map((anchor) => {
              const contextSegments = demoData.DEMO_SEGMENTS.filter(
                (segment) => segment.startMs <= anchor.timestamp + 5000 && segment.endMs >= anchor.timestamp - 5000
              );
              const transcriptContext = contextSegments.map((segment) => segment.text).join(' ').slice(0, 200);
              return {
                id: anchor.id,
                timestamp: anchor.timestamp,
                type: anchor.type,
                transcriptContext,
              };
            });
            classroomDataService.bulkSaveStudentAnchors('demo-session', studentId, studentName, anchorsToAdd);

            if (existingTranscriptCount === 0) {
              db.transcripts.bulkAdd(
                demoData.DEMO_SEGMENTS.map((segment) => ({
                  sessionId: 'demo-session',
                  userId: ANONYMOUS_USER_ID, // demo 数据使用匿名用户
                  text: segment.text,
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  confidence: segment.confidence || 1.0,
                  isFinal: true,
                }))
              ).catch((error) => console.error('保存演示转录到 IndexedDB 失败:', error));
            }
          });
        } else {
          setLoadingProgress(90);
        }
      } else {
        setViewMode('record');
        setSelectedAnchor(null);
        if (!savedAppState) {
          setDataSource('live');
          setShowSessionHistory(false);
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
      }

      setLoadingProgress(100);
      setAppReady(true);
      hasRestoredState.current = true;

      if (isFirstVisit && !savedAppState && !isGuestFastEntry) {
        setTimeout(() => setShowWelcome(true), 800);
      }
    };

    initializeApp();
  }, [isGuestFastEntry]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // 备用：监听 onboarding 加载完成后检查（只在首次触发，访客模式跳过）
  const hasTriggeredWelcome = useRef(false);
  useEffect(() => {
    if (!isGuestFastEntry && !onboarding.isLoading && appReady && !showSplash && !hasTriggeredWelcome.current && onboarding.shouldShowFlow('welcome')) {
      hasTriggeredWelcome.current = true;
      setShowWelcome(true);
    }
  }, [isGuestFastEntry, onboarding, appReady, showSplash]);

  // 处理开屏动画完成
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const handleRecordingStart = useCallback((newSessionId: string) => {
    // 清除旧会话的所有状态
    setSessionId(newSessionId);
    setIsRecording(true);
    setSegments([]);
    setAnchors([]);
    setSelectedAnchor(null); // 清除选中的困惑点
    clearTopics(); // 清除精选片段（使用 SWR Hook）
    clearSummary(); // 清除摘要（使用 SWR Hook）
    setNotes([]); // 清除笔记
    setActionItems([]); // 清除行动清单
    setTimeline(null); // 清除时间轴
    setDataSource('live');
    setAudioUrl(null); // 清除示例音频URL
    setAudioBlob(null); // 清除音频 blob
    setVideoSource(null);
    setVideoInsightItems([]);
    setActiveVideoInsightId(null);
    liveSegmentsRef.current = [];
    anchorService.clear(newSessionId);
    // 清理历史对话相关状态
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    
    // 创建课程会话记录 (供教师端读取)
    classroomDataService.saveSession({
      id: newSessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      status: 'recording',
      duration: 0,
      createdBy: studentId,
    });
  }, [studentId, clearTopics, clearSummary]);

  const handleRecordingStop = useCallback((blob?: Blob) => {
    setIsRecording(false);
    if (blob) setAudioBlob(blob);
    
    // 使用 liveSegmentsRef 判断是否有实时转录数据
    const currentSegments = liveSegmentsRef.current.length > 0 
      ? liveSegmentsRef.current 
      : segments;
    
    const hasLiveData = liveSegmentsRef.current.length > 0;
    const finalSegments = currentSegments;
    
    setSegments(finalSegments);
    setDataSource(hasLiveData ? 'live' : 'demo');
    if (hasLiveData) {
      setVideoSource(null);
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
    }
    
    // 计算课程时长
    const duration = finalSegments.length > 0 
      ? finalSegments[finalSegments.length - 1].endMs 
      : 0;
    
    // 更新课程会话状态
    classroomDataService.saveSession({
      id: sessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
    });
    
    // 保存音频和转录到 IndexedDB 历史记录
    if (blob && hasLiveData) {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      
      // 保存音频
      saveAudioSession(blob, sessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        duration,
      }).catch(err => console.error('保存录音到历史失败:', err));
      
      // 保存转录到 IndexedDB（供历史记录加载）
      addTranscripts(sessionId, currentUserId, finalSegments.map((seg) => ({
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence || 1.0,
        isFinal: true,
      }))).catch(err => console.error('保存转录到 IndexedDB 失败:', err));
    }
    
    const tl = memoryService.buildTimeline(
      sessionId,
      finalSegments,
      anchors,
      { subject: UIConfig.defaultSubject, teacher: UIConfig.defaultTeacher || 'Teacher', date: new Date().toISOString().split('T')[0] }
    );
    setTimeline(tl);
    memoryService.save(tl);
    setViewMode('review');
  }, [sessionId, anchors, segments, user]);

  // 处理 viewMode 切换，同时清理历史对话相关状态
  // 如果切换到复习模式且没有数据，自动加载 demo 数据
  const handleViewModeChange = useCallback(async (newMode: 'record' | 'review') => {
    setViewMode(newMode);
    setMobileSubPage(null);
    // 切换模式时清理历史对话面板状态
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setShowSessionHistory(false);
    if (newMode === 'record') {
      setVideoSource(null);
      setVideoInsightItems([]);
      setActiveVideoInsightId(null);
      setVideoWorkspaceTab('chat');
    }
    if (newMode === 'review' && segments.length === 0) {
      try {
        const demoData = await loadDemoData();
        setSegments(demoData.DEMO_SEGMENTS);
        setAudioUrl(demoData.DEMO_AUDIO_URL);
        setAnchors(demoData.DEMO_ANCHORS);
        setVideoSource(null);
        setDataSource('demo');
        
        // 构建时间轴
        const tl = memoryService.buildTimeline(
          sessionId,
          demoData.DEMO_SEGMENTS,
          demoData.DEMO_ANCHORS,
          { subject: UIConfig.defaultSubject, teacher: 'Demo Teacher', date: new Date().toISOString().split('T')[0] }
        );
        setTimeline(tl);
        
        // 选中第一个未解决的困惑点
        const firstUnresolved = demoData.DEMO_ANCHORS.find(a => !a.resolved);
        if (firstUnresolved) {
          setSelectedAnchor(firstUnresolved);
          setCurrentTime(firstUnresolved.timestamp);
        }
        
        // 首次进入复习模式时触发复习引导（有数据后）
        // 如果当前没有引导在进行，且 review 流程未完成
        if (!onboarding.isActive && onboarding.shouldShowFlow('review')) {
          setTimeout(() => onboarding.startFlow('review'), 500);
        }
      } catch (err) {
        console.error('Failed to load demo data:', err);
      }
    } else if (newMode === 'review' && segments.length > 0) {
      // 已有数据，首次进入复习模式时触发引导
      if (!onboarding.isActive && onboarding.shouldShowFlow('review')) {
        setTimeout(() => onboarding.startFlow('review'), 300);
      }
    }
  }, [segments.length, sessionId, onboarding]);

  useEffect(() => {
    if (viewMode !== 'review' || !videoSource) return;
    if (onboarding.isActive || !onboarding.shouldShowFlow('video-review')) return;
    const timer = setTimeout(() => onboarding.startFlow('video-review'), 300);
    return () => clearTimeout(timer);
  }, [viewMode, videoSource, onboarding]);

  // 从历史记录加载会话并进入复习模式
  const handleLoadHistorySession = useCallback(async (session: AudioSession) => {
    try {
      const restored = await restoreReviewSession(session.sessionId, {
        reviewTab: 'timeline',
        videoWorkspaceTab: 'chat',
        currentTime: 0,
        showTranscriptBar: false,
      });
      if (!restored) {
        throw new Error('session-not-restored');
      }
    } catch (err) {
      console.error('加载历史会话失败:', err);
      toast.error('加载历史会话失败，请重试');
    }
  }, [restoreReviewSession]);

  const handleTranscriptUpdate = useCallback((newSegments: TranscriptSegment[]) => {
    liveSegmentsRef.current = newSegments;
    setSegments(newSegments);
    setDataSource('live');
    setVideoSource(null);
  }, []);

  // 处理转录增强完成后的更新
  const handleTranscriptEnhanced = useCallback((enhancedSegments: TranscriptSegment[]) => {
    console.log('[Page] Received enhanced transcript:', enhancedSegments.length, 'segments');
    liveSegmentsRef.current = enhancedSegments;
    setSegments(enhancedSegments);
  }, []);

  const handleVideoImportReady = useCallback(async (result: ImportedVideoResult) => {
    const importedSegments = Array.isArray(result.segments) ? result.segments : [];
    if (importedSegments.length === 0) {
      toast.warning('视频已导入，但转录为空，请更换视频或重试。');
      return;
    }

    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    setViewMode('review');
    setDataSource('video');
    setVideoSource(result.source);
    setVideoWorkspaceTab('chat');
    setCurrentTime(0);
    setVideoSeekNonce(0);
    setVideoPlayNonce(0);

    setSegments(importedSegments);
    setAnchors([]);
    setSelectedAnchor(null);
    clearTopics();
    clearSummary();
    setNotes([]);
    setActionItems([]);
    setAudioBlob(null);
    setAudioUrl(null);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    liveSegmentsRef.current = importedSegments;

    const duration = importedSegments[importedSegments.length - 1]?.endMs || 0;
    const seededInsights = buildSeedVideoInsights(importedSegments);
    setVideoInsightItems(seededInsights);
    setActiveVideoInsightId(seededInsights[0]?.id || null);

    try {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      await db.transcripts.bulkAdd(
        importedSegments.map((seg) => ({
          sessionId: newSessionId,
          userId: currentUserId,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1.0,
          isFinal: true,
        }))
      );

      // 保存到 audioSessions 以便在历史列表中显示
      await saveAudioSession(null, newSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: result.source.title || '视频复习',
        duration,
        sourceType: 'video-link',
        videoUrl: result.source.originalUrl,
        videoEmbedUrl: result.source.embedUrl,
        videoProvider: result.source.provider,
        thumbnailUrl: result.source.thumbnailUrl,
        importSourceMode: result.source.sourceMode as AudioSession['importSourceMode'],
        importTrace: result.source.importTrace,
      });
    } catch (error) {
      console.error('保存视频转录到 IndexedDB 失败:', error);
    }

    classroomDataService.saveSession({
      id: newSessionId,
      subject: UIConfig.defaultSubject,
      topic: result.source.title || '视频复习',
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
      createdBy: studentId,
    });

    const nextTimeline = memoryService.buildTimeline(
      newSessionId,
      importedSegments,
      [],
      {
        subject: UIConfig.defaultSubject,
        teacher: UIConfig.defaultTeacher || 'Teacher',
        date: new Date().toISOString().split('T')[0],
      }
    );
    setTimeline(nextTimeline);
    memoryService.save(nextTimeline);
  }, [clearSummary, clearTopics, studentId, user?.id]);

  const handleUploadedTranscriptReady = useCallback(async (newSegments: TranscriptSegment[], blob?: Blob) => {
    const newSessionId = generateSessionId();
    // 清除旧会话的所有状态
    setSessionId(newSessionId);
    setSegments(newSegments);
    setAnchors([]); // 清除旧困惑点
    setSelectedAnchor(null); // 清除选中的困惑点
    clearTopics(); // 清除精选片段（使用 SWR Hook）
    clearSummary(); // 清除摘要（使用 SWR Hook）
    setNotes([]); // 清除笔记
    setActionItems([]); // 清除行动清单
    setAudioBlob(blob || null);
    setAudioUrl(null); // 清除示例音频URL
    setDataSource('live');
    setVideoSource(null);
    setVideoInsightItems([]);
    setActiveVideoInsightId(null);
    liveSegmentsRef.current = [];
    
    // 将转录数据保存到 IndexedDB（供教师端读取）
    try {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      await db.transcripts.bulkAdd(
        newSegments.map((seg) => ({
          sessionId: newSessionId,
          userId: currentUserId,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 1.0,
          isFinal: true,
        }))
      );
      console.log(`已保存 ${newSegments.length} 条转录到 IndexedDB, sessionId: ${newSessionId}`);
    } catch (error) {
      console.error('保存转录到 IndexedDB 失败:', error);
    }
    
    // 更新 classroomDataService 会话信息（供教师端读取）
    const duration = newSegments.length > 0
      ? newSegments[newSegments.length - 1].endMs
      : 0;
    classroomDataService.saveSession({
      id: newSessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
      createdBy: studentId,
    });
    
    // 保存上传的音频到 IndexedDB 历史记录
    if (blob) {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      saveAudioSession(blob, newSessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        duration,
      }).catch((err) => console.error('保存上传音频到历史失败:', err));
    }
    
    // 构建时间轴
    const timelineData = memoryService.buildTimeline(
      newSessionId,
      newSegments,
      [], // 新会话没有困惑点
      { subject: UIConfig.defaultSubject, teacher: UIConfig.defaultTeacher || 'Teacher', date: new Date().toISOString().split('T')[0] }
    );
    setTimeline(timelineData);
    
    // 自动切换到复习模式
    setViewMode('review');
  }, [clearSummary, clearTopics, studentId, user?.id]);

  const handleVideoAssistantMessage = useCallback((payload: {
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
        prompt: compactText(payload.prompt || '本轮提问', 48),
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

    // 按 session + 时间范围匹配持久化记录，避免依赖应用层临时 id。
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
    // 修正时间戳：如果 segments 存在，将 anchor 时间戳对齐到最近的 segment
    // 这是因为前端 elapsedMs 和后端 ASR 时间戳可能存在偏差
    let alignedTimestamp = timestamp;
    if (segments.length > 0) {
      // 找到最近的 segment（优先找包含该时间点的，否则找最接近的）
      let nearestSeg = segments[0];
      let minDistance = Math.abs(timestamp - (nearestSeg.startMs + nearestSeg.endMs) / 2);
      
      for (const seg of segments) {
        // 如果时间点在 segment 范围内，直接使用
        if (timestamp >= seg.startMs && timestamp <= seg.endMs) {
          alignedTimestamp = timestamp; // 在范围内，保持原值
          nearestSeg = seg;
          break;
        }
        // 否则找最近的
        const segMid = (seg.startMs + seg.endMs) / 2;
        const distance = Math.abs(timestamp - segMid);
        if (distance < minDistance) {
          minDistance = distance;
          nearestSeg = seg;
        }
      }
      
      // 如果原始时间戳超出 segments 范围较多（>5秒），对齐到最近 segment
      const lastSeg = segments[segments.length - 1];
      if (timestamp > lastSeg.endMs + 5000) {
        alignedTimestamp = lastSeg.endMs;
        console.log('[AnchorMark] Timestamp aligned:', timestamp, '->', alignedTimestamp, '(was beyond segments range)');
      } else if (timestamp < segments[0].startMs - 5000) {
        alignedTimestamp = segments[0].startMs;
        console.log('[AnchorMark] Timestamp aligned:', timestamp, '->', alignedTimestamp, '(was before segments range)');
      }
    }
    
    // 同时写入旧版 anchor-service (保持兼容) 和新版共享存储
    const anchor = anchorService.mark(sessionId, studentId, alignedTimestamp, 'confusion');
    setAnchors(prev => [...prev, anchor]);
    
    // 获取当前时间点附近的转录内容作为上下文
    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
    
    // 写入共享存储 (供教师端读取)
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

  // 回放时添加困惑点标注
  const handlePlaybackAnchorAdd = useCallback((timestamp: number) => {
    // 回放时 timestamp 来自波形播放位置，通常与 segments 对齐
    // 但仍做校验确保在有效范围内
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
    
    // 获取转录上下文
    const contextSegments = segments.filter(
      s => s.startMs <= alignedTimestamp + 5000 && s.endMs >= alignedTimestamp - 5000
    );
    const transcriptContext = contextSegments.map(s => s.text).join(' ').slice(0, 200);
    
    // 写入共享存储
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
    
    // 自动切换到困惑点详情面板
    setReviewTab('anchor-detail');
  }, [sessionId, studentId, studentName, timeline, segments]);

  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    setSelectedAnchor(anchor);
    setCurrentTime(anchor.timestamp);
    // 自动切换到困惑点详情面板
    setReviewTab('anchor-detail');
  }, []);

  const handleResolveAnchor = useCallback(() => {
    if (!selectedAnchor) return;
    
    anchorService.resolve(selectedAnchor.id, sessionId);
    
    // 同步更新共享存储
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

  // 生成精选片段 - 使用 SWR Hook（自动请求去重、缓存、重试）
  const handleGenerateTopics = useCallback(async (mode: TopicGenerationMode) => {
    try {
      console.log('[生成精选片段] 开始，模式:', mode, '片段数:', segments.length);
      await generateTopics(mode);
      console.log('[生成精选片段] 完成');
    } catch (error) {
      console.error('生成精选片段失败:', error);
      alert(`生成失败: ${error instanceof Error ? error.message : '网络错误'}`);
    }
  }, [segments.length, generateTopics]);

  // 按主题重新生成片段 - 使用 SWR Hook
  const handleRegenerateByTheme = useCallback(async (theme: string) => {
    try {
      await regenerateByTheme(theme);
    } catch (error) {
      console.error('按主题生成失败:', error);
    }
  }, [regenerateByTheme]);

  // 生成课堂摘要 - 使用 SWR Hook
  const handleGenerateSummary = useCallback(async () => {
    try {
      await generateSummary();
    } catch (error) {
      console.error('生成摘要失败:', error);
    }
  }, [generateSummary]);

  // 播放精选片段
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

  // 清空精选片段 - 使用 SWR Hook
  const handleClearTopics = useCallback(() => {
    clearTopics();
  }, [clearTopics]);

  // 播放全部片段
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

  // 添加笔记
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

  // 更新笔记
  const handleUpdateNote = useCallback((noteId: string, text: string) => {
    setNotes(prev => prev.map(n => 
      n.id === noteId ? { ...n, text, updatedAt: new Date().toISOString() } : n
    ));
  }, []);

  // 删除笔记
  const handleDeleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
  }, []);

  // 处理 AI 家教生成的行动清单
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

  // 计算总时长
  const totalDuration = segments.length > 0 
    ? segments[segments.length - 1].endMs 
    : 0;

  const renderInputSourceTabs = useCallback((layout: 'mobile' | 'desktop') => {
    const isMobileLayout = layout === 'mobile';
    const activeClass = isMobileLayout
      ? 'border border-amber-200 bg-gradient-to-b from-white to-amber-50 text-amber-700 font-semibold shadow-[0_6px_14px_rgba(214,165,87,0.18)]'
      : 'bg-white text-navy font-medium shadow-sm';
    const inactiveClass = isMobileLayout
      ? 'border border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/70'
      : 'text-gray-500 hover:text-navy';
    const buttonBaseClass = isMobileLayout
      ? 'shrink-0 min-w-[84px] px-2.5 py-2 text-[12px] leading-none rounded-xl transition-all duration-200 whitespace-nowrap flex items-center justify-center gap-1.5'
      : 'px-4 py-2 text-sm rounded-lg transition-all whitespace-nowrap';
    const wrapperClass = isMobileLayout
      ? 'w-full flex items-center gap-1 p-1 rounded-2xl border border-amber-100/80 bg-white/85 backdrop-blur-sm overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shadow-[0_10px_24px_rgba(214,165,87,0.14)]'
      : 'flex items-center gap-2 p-1 rounded-xl';

    const sourceTabs = [
      {
        key: 'live',
        icon: '🎙️',
        label: '实时录音',
        testId: 'source-live-button',
        active: dataSource === 'live' && !showSessionHistory,
        onClick: () => { setDataSource('live'); setShowSessionHistory(false); },
      },
      {
        key: 'demo',
        icon: '📁',
        label: '上传音频',
        testId: 'source-upload-button',
        active: dataSource === 'demo' && !showSessionHistory,
        onClick: () => { setDataSource('demo'); setShowSessionHistory(false); },
      },
      {
        key: 'video',
        icon: '🎬',
        label: '视频链接',
        testId: 'source-video-button',
        active: dataSource === 'video' && !showSessionHistory,
        onClick: () => { setDataSource('video'); setShowSessionHistory(false); },
      },
      {
        key: 'history',
        icon: '📋',
        label: isMobileLayout ? '历史' : '录音历史',
        testId: 'source-history-button',
        active: showSessionHistory,
        onClick: () => setShowSessionHistory(true),
      },
    ] as const;

    return (
      <div
        className={wrapperClass}
        style={isMobileLayout ? undefined : { background: 'var(--edu-bg-soft)' }}
        data-onboarding="input-methods"
      >
        {sourceTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={tab.onClick}
            data-testid={tab.testId}
            className={`${buttonBaseClass} ${tab.active ? activeClass : inactiveClass}`}
          >
            <span aria-hidden className={isMobileLayout ? 'text-[13px] leading-none' : undefined}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    );
  }, [dataSource, showSessionHistory]);

  const renderInputSecondaryPanels = useCallback((layout: 'mobile' | 'desktop') => {
    const isMobileLayout = layout === 'mobile';
    const historyMaxHeight = isMobileLayout ? '400px' : '500px';
    const cardPaddingClass = isMobileLayout ? 'p-4' : 'p-6';
    const titleClass = isMobileLayout
      ? 'text-base font-semibold text-gray-900 mb-3 flex items-center gap-2'
      : 'text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2';
    const helperText = isMobileLayout
      ? '支持 MP3、WAV、WebM 等格式'
      : '支持 MP3、WAV、WebM 等格式，上传后自动转录并进入复习模式';
    const helperTextClass = isMobileLayout
      ? 'mt-3 text-xs text-gray-500 text-center'
      : 'mt-4 text-sm text-gray-500 text-center';

    return (
      <>
        <div className="card-edu p-0 overflow-hidden" style={{ maxHeight: historyMaxHeight, display: showSessionHistory ? undefined : 'none' }}>
          <SessionHistoryList
            userId={user?.id}
            onSessionSelect={handleLoadHistorySession}
            onClose={() => setShowSessionHistory(false)}
            activeSessionId={sessionId}
            maxHeight={historyMaxHeight}
            showHeader={false}
          />
        </div>
        <div className={`card-edu ${cardPaddingClass}`} style={{ display: dataSource === 'video' && !showSessionHistory ? undefined : 'none' }}>
          <h3 className={titleClass}>
            <span>🎬</span>
            导入视频链接
          </h3>
          <VideoLinkImporter
            onImportReady={handleVideoImportReady}
            onError={(error) => {
              console.error('视频导入失败:', error);
              toast.error(String(error));
            }}
            disabled={isRecording}
          />
        </div>
        <div className={`card-edu ${cardPaddingClass}`} style={{ display: dataSource === 'demo' && !showSessionHistory ? undefined : 'none' }}>
          <h3 className={titleClass}>
            <span>📁</span>
            上传课堂录音
          </h3>
          <AudioUploader
            onTranscriptReady={handleUploadedTranscriptReady}
            onError={(error) => {
              console.error('上传失败:', error);
            }}
            disabled={isRecording}
          />
          <p className={helperTextClass}>
            {helperText}
          </p>
        </div>
      </>
    );
  }, [
    dataSource,
    handleLoadHistorySession,
    handleUploadedTranscriptReady,
    handleVideoImportReady,
    isRecording,
    sessionId,
    showSessionHistory,
    user?.id,
  ]);

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
        <AppMatrixPanel
          sessionId={sessionId}
          dataSource={dataSource}
          transcript={segments}
          anchors={anchors}
          summaryOverview={classSummary?.overview}
          keyDifficulties={classSummary?.keyDifficulties}
          onSeek={handleUnifiedSeek}
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
    playAllIndex,
    segments,
    selectedTopic,
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

  // 客户端未挂载时显示加载状态，避免 Hydration 错误
  if (!mounted) {
    return <AppLoading message="准备学习环境" />;
  }

  // 显示开屏动画（等待应用准备就绪）
  if (showSplash) {
    return (
      <AppLoading 
        progress={loadingProgress}
        message={loadingProgress >= 100 ? "即将进入" : undefined}
        onComplete={loadingProgress >= 100 ? handleSplashComplete : undefined}
      />
    );
  }

  const shouldAllowPageScroll = !isMobile && viewMode === 'review' && !!videoSource;

  return (
    <div
      className={`h-dvh flex flex-col main-content-enter browser-safe-top ${
        shouldAllowPageScroll ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
      }`}
      style={{ height: '100dvh', minHeight: '-webkit-fill-available' }}
    >
      {/* 移动端隐藏降级横幅 */}
      {!isMobile && <DegradedModeBanner status={serviceStatus} />}
      
      {/* 桌面端 Header - 移动端隐藏 */}
      {!isMobile && (
        <Header 
          lessonTitle={viewMode === 'record' ? '课堂录音' : '课堂回顾'}
          courseName=""
        />
      )}

      {/* 桌面端模式切换栏 - 移动端隐藏，增加 z-index 防止被遮挡 */}
      {!isMobile && (
        <div className="border-b px-6 py-3 no-print flex-shrink-0 relative z-20" style={{ background: 'var(--edu-bg-secondary)', borderColor: 'var(--edu-border-light)' }}>
          <div className="flex items-center justify-between">
            <div 
              className="flex items-center gap-2 p-1 rounded-xl" 
              style={{ background: 'var(--edu-bg-soft)' }}
              data-onboarding="mode-switch"
            >
              <button
                onClick={() => handleViewModeChange('record')}
                data-testid="mode-record-button"
                className={`mode-tab ${viewMode === 'record' ? 'active' : ''}`}
              >
                <span className="mr-1.5">🎙️</span>
                录音
              </button>
              <button
                onClick={() => handleViewModeChange('review')}
                data-testid="mode-review-button"
                className={`mode-tab ${viewMode === 'review' ? 'active' : ''}`}
              >
                <span className="mr-1.5">📚</span>
                复习
              </button>
            </div>
            
              <div className="flex items-center gap-4">
              <ServiceStatus compact pollInterval={60000} />
              
              <div className="flex items-center gap-3 text-sm min-w-0 flex-wrap">
                <span className={`badge ${dataSource === 'live' ? 'badge-live' : 'badge-demo'} flex-shrink-0`}>
                  {dataSource === 'live' ? '🎙️ 实时' : dataSource === 'video' ? '🎬 视频' : '📋 演示'}
                </span>
                
                <div className="flex items-center gap-2 text-gray-500 min-w-0 flex-wrap">
                  <span className="whitespace-nowrap">困惑点</span>
                  <span className="font-semibold text-navy">{anchors.length}</span>
                    {unresolvedCount > 0 && (
                      <>
                        <span>·</span>
                        <span data-testid="unresolved-count" data-count={unresolvedCount} className="text-coral-500 font-semibold whitespace-nowrap">{unresolvedCount} 待解决</span>
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
          {/* 移动端录音页面 - 得到风格 */}
          {isMobile ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 极简顶部栏：Logo + Tab + 用户 + 菜单 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-2 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                
                {/* Tab 切换 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    data-onboarding="mode-switch"
                  />
                </div>
                
                {/* 用户头像/登录按钮 */}
                {isAuthenticated && user ? (
                  <button
                    onClick={() => setIsMenuOpen(true)}
                    className="w-8 h-8 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                  >
                    <Avatar className="w-full h-full">
                      {user.avatar ? (
                        <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="bg-transparent text-sm">👤</AvatarFallback>
                    </Avatar>
                  </button>
                ) : (
                  <a
                    href="/login"
                    className="px-2.5 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg flex-shrink-0"
                  >
                    登录
                  </a>
                )}
                
                {/* 菜单按钮 */}
                <DedaoMenuButton onClick={() => setIsMenuOpen(true)} />
              </div>

              {/* 录音内容区 */}
              <div className="flex-1 flex flex-col p-4 overflow-hidden min-h-0">
                <div className="w-full max-w-md mx-auto flex flex-col flex-1 min-h-0">
                  {/* 录音或上传切换 */}
                  <div className="flex-shrink-0 mb-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-medium tracking-[0.02em] text-slate-500">选择输入方式</span>
                      <span className="text-[10px] text-slate-400">课堂采集入口</span>
                    </div>
                    {renderInputSourceTabs('mobile')}
                  </div>

                  <div className="flex-1 min-h-0" style={{ display: dataSource === 'live' && !showSessionHistory ? undefined : 'none' }}>
                    <Recorder
                      onRecordingStart={handleRecordingStart}
                      onRecordingStop={handleRecordingStop}
                      onTranscriptUpdate={handleTranscriptUpdate}
                      onTranscriptTextUpdate={handleTranscriptTextUpdate}
                      onTranscriptEnhanced={handleTranscriptEnhanced}
                      onAnchorMark={handleAnchorMark}
                    />
                  </div>

                  {renderInputSecondaryPanels('mobile')}
                  
                  {/* 已标记的困惑点 */}
                  {anchors.length > 0 && (
                    <div className="card-edu p-4 animate-slide-up">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span>🎯</span>
                        已标记的困惑点
                        <span className="ml-auto text-xs font-normal text-gray-400">{anchors.length} 个</span>
                      </h3>
                      <div className="space-y-2 max-h-32 overflow-y-auto">
                        {anchors.map((anchor, index) => (
                                  <div
                                            key={anchor.id}
                                            className="flex items-center gap-2 p-2 rounded-lg"
                                            style={{ background: 'var(--edu-bg-soft)' }}
                                          >
                                            <div className={`w-2 h-2 rounded-full ${
                                              anchor.resolved ? 'bg-mint' : 'bg-coral'
                                            }`} />
                            <span className="text-xs font-mono text-gray-600">
                              {formatTime(anchor.timestamp)}
                            </span>
                            <span className="text-xs text-gray-500">
                              困惑点 #{index + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧菜单 */}
              <DedaoMenu
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                onNavigate={(page) => setMobileSubPage(page)}
                showApps={false}
                userRole="student"
                badges={{
                  highlights: highlightTopics.length,
                  notes: notes.length,
                  tasks: actionItems.filter(i => !i.completed).length,
                }}
              />
            </div>
          ) : (
            /* 桌面端录音页面 - 教育风格 */
            <div className="flex-1 flex items-center justify-center p-8 page-enter relative overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 背景装饰 */}
              <div className="absolute top-10 right-10 w-48 h-48 opacity-20 pointer-events-none">
                <Image
                  src="/illustrations/learning.svg"
                  alt=""
                  fill
                  sizes="192px"
                  className="w-full h-full"
                />
              </div>
              <div className="absolute bottom-10 left-10 w-32 h-32 opacity-15 pointer-events-none">
                <Image
                  src="/illustrations/ai-tutor.svg"
                  alt=""
                  fill
                  sizes="128px"
                  className="w-full h-full"
                />
              </div>
              
              <div className="w-full max-w-2xl mx-auto relative z-10 h-full min-h-0 flex flex-col gap-6">
                {/* 录音或上传切换 */}
                <div className="flex-shrink-0 flex items-center justify-center gap-4 mb-4">
                  <span className="text-sm text-gray-500">选择输入方式：</span>
              {renderInputSourceTabs('desktop')}
            </div>

            {/* Recorder 始终挂载，通过 CSS 显示/隐藏，防止切换 tab 时录音状态丢失 */}
            <div className="relative flex-1 min-h-0" style={{ display: dataSource === 'live' && !showSessionHistory ? undefined : 'none' }}>
              {/* 装饰插画 */}
              <div className="absolute -right-20 -top-10 w-24 h-24 opacity-30 pointer-events-none hidden lg:block">
                <Image
                  src="/illustrations/recording.svg"
                  alt=""
                  fill
                  sizes="96px"
                  className="w-full h-full"
                />
              </div>
              <Recorder
                onRecordingStart={handleRecordingStart}
                onRecordingStop={handleRecordingStop}
                onTranscriptUpdate={handleTranscriptUpdate}
                onTranscriptTextUpdate={handleTranscriptTextUpdate}
                onTranscriptEnhanced={handleTranscriptEnhanced}
                onAnchorMark={handleAnchorMark}
              />
            </div>
            {renderInputSecondaryPanels('desktop')}
            
                {/* 已标记的困惑点 */}
                {anchors.length > 0 && (
                  <div className="card-edu p-5 animate-slide-up">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <span>🎯</span>
                      已标记的困惑点
                      <span className="ml-auto text-xs font-normal text-gray-400">{anchors.length} 个</span>
                    </h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {anchors.map((anchor, index) => (
                          <div
                            key={anchor.id}
                            className="flex items-center gap-3 p-3 rounded-xl transition-colors"
                            style={{ background: 'var(--edu-bg-soft)' }}
                          >
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              anchor.resolved ? 'bg-mint' : 'bg-coral'
                            }`} />
                            <span className="text-sm font-mono text-gray-600">
                              {formatTime(anchor.timestamp)}
                            </span>
                            <span className="text-sm text-gray-500">
                              困惑点 #{index + 1}
                            </span>
                            {anchor.resolved && (
                              <span className="ml-auto text-xs text-mint-600">已解决</span>
                            )}
                          </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* 桌面端布局 */}
          {!isMobile ? (
            <div
              className={`flex-1 min-h-0 flex page-enter ${videoSource ? 'overflow-visible' : 'overflow-hidden'}`}
              style={{ background: 'var(--edu-bg-primary)' }}
            >
              {videoSource ? (
                <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
                  {/* ===== 左侧：视频 + 可折叠字幕 + 时间轴 ===== */}
                  <div className="min-h-0 flex flex-col lg:w-[55%] xl:w-[58%] border-r" style={{ borderColor: 'var(--edu-border-light)' }}>
                    {/* 视频播放器 */}
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

                    {/* 可折叠字幕条 */}
                    <div className="shrink-0 border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                      <button
                        onClick={() => setShowTranscriptBar(prev => !prev)}
                        className="w-full flex items-center justify-between px-4 py-2 text-xs hover:bg-gray-50 transition-colors"
                        style={{ background: 'var(--edu-bg-soft)' }}
                      >
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="text-gray-500 font-medium">转录字幕</span>
                          <span className="text-gray-400">{segments.length} 句</span>
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
                            onMarkConfusion={(timeMs, segmentId) => {
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

                    {/* 可视化时间轴 + 高亮片段列表 */}
                    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: 'var(--edu-bg-primary)' }}>
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-800">高亮时间轴</span>
                            <span className="text-xs text-gray-400">{videoInsightItems.filter(i => !i.id.startsWith('seed-')).length} 轮对话</span>
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
                            <p className="text-sm text-gray-400 mb-1">暂无高亮</p>
                            <p className="text-xs text-gray-300">在右侧对话后，高亮点会自动出现在这里</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ===== 右侧：5 Tab 工作面板 ===== */}
                  <div className="min-h-0 flex flex-col flex-1 bg-white overflow-hidden">
                    {/* 标签栏 */}
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
                              ? 'bg-white text-amber-600 font-medium shadow-sm'
                              : 'text-gray-500 hover:text-gray-800 hover:bg-white/60'
                          }`}
                        >
                          <span>{tab.icon}</span>
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

                    {/* 内容区 */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      {/* 对话 Tab - 全局 AI 对话（使用 CSS 隐藏保留组件状态） */}
                      <div className={`h-full min-h-0 ${videoWorkspaceTab === 'chat' ? '' : 'hidden'}`}>
                          <AITutor
                            breakpoint={null}
                            segments={segments}
                            isLoading={false}
                            onResolve={() => {}}
                            sessionId={sessionId}
                            onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
                          />
                      </div>

                      {/* 困惑点 Tab - 列表 / 独立对话 */}
                      {videoWorkspaceTab === 'confusion' && (
                        <div className="h-full overflow-hidden flex flex-col">
                          {confusionChatAnchor ? (
                            <>
                              {/* 困惑点对话头部 */}
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
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${confusionChatAnchor.resolved ? 'bg-green-400' : 'bg-amber-400 animate-pulse'}`} />
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
                              {/* 困惑点独立对话 */}
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
                                  onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
                                />
                              </div>
                            </>
                          ) : (
                            <div className="h-full overflow-y-auto p-4">
                              {/* 标记困惑按钮 */}
                              <button
                                onClick={() => {
                                  handleAnchorMark(currentTime);
                                }}
                                className="w-full mb-4 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-amber-200 text-amber-600 hover:bg-amber-50 hover:border-amber-300 transition-all text-sm font-medium"
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
                                      <span className="text-xs text-red-400">{anchors.filter(a => !a.resolved).length} 个未解决</span>
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
                                          : 'border-amber-100 bg-amber-50/50 hover:border-amber-200'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${anchor.resolved ? 'bg-green-400' : 'bg-amber-400'}`} />
                                        <span className="text-xs font-mono text-gray-400">{formatTime(anchor.timestamp)}</span>
                                        <span className="text-xs text-gray-500">困惑 #{index + 1}</span>
                                        {anchor.resolved ? (
                                          <span className="text-xs text-green-500 ml-auto">已解决</span>
                                        ) : (
                                          <span className="text-xs text-amber-500 ml-auto">点击对话 →</span>
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
                                  <p className="text-sm text-gray-400 mb-1">暂无困惑点</p>
                                  <p className="text-xs text-gray-300">点击上方按钮标记你不理解的地方</p>
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
              {/* 可拖拽左右面板 */}
              <ResizablePanel
                className="flex-1"
                defaultLeftWidth={320}
                minLeftWidth={260}
                maxLeftWidth={820}
                storageKey="meetmind-left-panel-width"
                leftPanel={
                  /* 左栏 - 多功能面板 */
                  <div className="h-full flex flex-col bg-white" style={{ borderRight: '1px solid var(--edu-border-light)' }}>
                    {/* 标签页切换 - 增强可点击性和防遮挡 */}
                    <div 
                      className="flex items-center gap-1 px-3 py-2.5 border-b overflow-x-auto flex-shrink-0 relative z-10 tab-buttons-container" 
                      style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}
                    >
                      {REVIEW_WORKSPACE_TABS.map((tab) => (
                        <button
                          key={tab.key}
                          data-onboarding={tab.key === 'timeline' ? 'timeline' : undefined}
                          data-testid={tab.testId}
                          onClick={() => setReviewTab(tab.key)}
                          className={`px-3 py-2 text-sm rounded-lg transition-all whitespace-nowrap tab-button ${
                            reviewTab === tab.key
                              ? 'bg-white text-amber-600 font-medium shadow-sm'
                              : 'text-gray-500 hover:text-navy hover:bg-white/50'
                          }`}
                        >
                          {tab.icon} {tab.label}
                          {tab.key === 'anchor-detail' && selectedAnchor && !selectedAnchor.resolved && (
                            <span className="ml-1 w-2 h-2 bg-coral rounded-full inline-block animate-pulse" />
                          )}
                          {tab.key === 'highlights' && highlightTopics.length > 0 && (
                            <span className="ml-1 text-xs text-skyblue-600">({highlightTopics.length})</span>
                          )}
                          {tab.key === 'summary' && classSummary && <span className="ml-1 text-xs text-mint-600">✓</span>}
                          {tab.key === 'notes' && notes.length > 0 && (
                            <span className="ml-1 text-xs text-amber-600">({notes.length})</span>
                          )}
                        </button>
                      ))}
                    </div>
                    
                    {/* 标签页内容 */}
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
                  /* 中栏 - AI 对话区（现在是右侧主面板） */
                  <div className="h-full flex flex-col bg-white ai-chat-container">
                    {/* 精简波形播放器 - compact 模式，置于顶部 */}
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
                    
                    {/* AI 家教区 - 确保有足够的显示空间 */}
                    <div className="flex-1 min-h-0 flex flex-col" data-onboarding="ai-tutor" style={{ minHeight: 'var(--ai-chat-min-height, 300px)' }}>
                      {/* AI 对话模式切换栏 */}
                      {!showConversationHistory && (
                        <div 
                          className="flex-shrink-0 px-3 py-2 flex items-center gap-2 border-b"
                          style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}
                        >
                          <button
                            onClick={() => setSelectedAnchor(null)}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-all flex items-center gap-1.5 ${
                              !selectedAnchor
                                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-sm'
                                : 'bg-white text-gray-600 hover:text-amber-600 hover:bg-amber-50 border border-gray-200'
                            }`}
                            title="基于整节课内容与 AI 对话"
                          >
                            <span>💬</span>
                            整节课对话
                          </button>
                          {selectedAnchor && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-amber-200 text-xs">
                              <span className={`w-2 h-2 rounded-full ${selectedAnchor.resolved ? 'bg-mint' : 'bg-coral animate-pulse'}`} />
                              <span className="text-amber-700 font-medium">
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
                      
                      {/* 内容区 */}
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {showConversationHistory ? (
                          selectedHistoryConversation ? (
                            <div className="h-full flex flex-col">
                              <div className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                                <span className="text-sm text-gray-600 truncate flex-1 mr-2">{selectedHistoryConversation.title}</span>
                                <div className="flex items-center gap-1">
                                  {/* 返回列表 - 使用图标 */}
                                  <button
                                    onClick={() => setSelectedHistoryConversation(null)}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-navy hover:bg-gray-100 transition-colors"
                                    title="返回列表"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                                    </svg>
                                  </button>
                                  {/* 新对话 - 使用图标 */}
                                  <button
                                    onClick={() => {
                                      setShowConversationHistory(false);
                                      setSelectedHistoryConversation(null);
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 transition-colors"
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
                                {/* 新对话按钮 */}
                                <button
                                  onClick={() => {
                                    setShowConversationHistory(false);
                                    setSelectedHistoryConversation(null);
                                  }}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-amber-600 hover:text-amber-700 hover:bg-amber-50 transition-colors"
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
                            breakpoint={selectedBreakpoint}
                            segments={segments}
                            isLoading={false}
                            onResolve={handleResolveAnchor}
                            onActionItemsUpdate={handleActionItemsUpdate}
                            sessionId={sessionId}
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

              {/* 右侧 - 图标条 */}
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

              {/* 行动清单抽屉 */}
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
            /* 移动端教育风格布局 */
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 极简顶部栏：Logo + Tab + 用户 + 菜单 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-2 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                
                {/* Tab 切换 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    data-onboarding="mode-switch"
                  />
                </div>
                
                {/* 用户头像/登录按钮 */}
                {isAuthenticated && user ? (
                  <button
                    onClick={() => setIsMenuOpen(true)}
                    className="w-8 h-8 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                  >
                    <Avatar className="w-full h-full">
                      {user.avatar ? (
                        <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="bg-transparent text-sm">👤</AvatarFallback>
                    </Avatar>
                  </button>
                ) : (
                  <a
                    href="/login"
                    className="px-2.5 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg flex-shrink-0"
                  >
                    登录
                  </a>
                )}
                
                {/* 菜单按钮 */}
                <DedaoMenuButton onClick={() => setIsMenuOpen(true)} data-onboarding="menu-button" />
              </div>

              {/* 单行极简播放器 */}
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

              {/* 隐藏的波形播放器（用于实际音频播放） */}
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

              {/* 主内容区：根据 mobileSubPage 条件渲染 */}
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

                  {/* 时间轴列表（占满剩余空间） */}
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

                  {/* 困惑点详情卡片 */}
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
                      setMobileAIQuestion(question);
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

                  {/* 悬浮 AI 对话按钮 - 进入全局 AI 对话 */}
                  <MobileAIFab
                    onClick={() => {
                      setSelectedAnchor(null);  // 清除选中的困惑点，进入全局对话模式
                      setMobileAIQuestion('');
                      setMobileSubPage('ai-chat');
                    }}
                    visible={!selectedConfusion}
                    pulse={segments.length > 0 && anchors.length === 0}
                    tooltip="和 AI 聊聊这节课"
                  />
                </>
              )}

              {/* 移动端 AI 对话页面 */}
              {mobileSubPage === 'ai-chat' && (
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  {/* 子页面头部 */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                    <button
                      onClick={() => {
                        setMobileSubPage(null);
                        setMobileAIQuestion('');
                        setShowConversationHistory(false);
                        setSelectedHistoryConversation(null);
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <span className="font-medium text-gray-900">AI 助教</span>
                    
                    {/* 历史记录切换 - ChatGPT 风格图标按钮 */}
                    <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                      {/* 当前对话 */}
                      <button
                        onClick={() => {
                          setShowConversationHistory(false);
                          setSelectedHistoryConversation(null);
                        }}
                        className={`w-8 h-8 flex items-center justify-center rounded-md transition-all ${
                          !showConversationHistory
                            ? 'bg-white text-amber-600 shadow-sm'
                            : 'text-gray-400 hover:text-gray-600'
                        }`}
                        title="当前对话"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </button>
                      {/* 历史记录 */}
                      <button
                        onClick={() => setShowConversationHistory(true)}
                        className={`w-8 h-8 flex items-center justify-center rounded-md transition-all ${
                          showConversationHistory
                            ? 'bg-white text-amber-600 shadow-sm'
                            : 'text-gray-400 hover:text-gray-600'
                        }`}
                        title="历史对话"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  
                  {/* MiniPlayer 播放进度条 */}
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
                    className="border-b border-gray-100"
                  />
                  
                  {/* AI 对话区 */}
                  <div className="flex-1 min-h-0">
                    {showConversationHistory ? (
                      selectedHistoryConversation ? (
                        // 继续历史对话
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
                              {/* 新对话 */}
                              <button
                                onClick={() => {
                                  setShowConversationHistory(false);
                                  setSelectedHistoryConversation(null);
                                }}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50"
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
                      // 当前困惑点对话
                      <AITutor
                        breakpoint={selectedBreakpoint}
                        segments={segments}
                        isLoading={false}
                        onResolve={handleResolveAnchor}
                        onActionItemsUpdate={handleActionItemsUpdate}
                        sessionId={sessionId}
                        initialQuestion={mobileAIQuestion}
                        isMobile={true}
                        onSeek={(timeMs) => {
                          handleUnifiedSeek(timeMs, true);
                        }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* 移动端精选页面 */}
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

              {/* 移动端摘要页面 */}
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

              {/* 移动端笔记页面 */}
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

              {/* 移动端应用矩阵页面 */}
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
                    <span className="font-medium text-gray-900">应用矩阵</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {renderSharedWorkspacePanel('apps')}
                  </div>
                </div>
              )}

              {/* 移动端任务页面 */}
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

              {/* 右侧菜单 */}
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
      
      {/* 用户引导组件 */}
      <WelcomeModal
        isOpen={showWelcome}
        onStart={() => {
          setShowWelcome(false);
          // 标记 welcome 流程完成，然后启动 recording 引导
          onboarding.markFlowComplete('welcome');
          setTimeout(() => {
            onboarding.startFlow('recording');
          }, 100);
        }}
        onSkip={() => {
          setShowWelcome(false);
          // 标记 welcome 被跳过
          onboarding.markFlowSkipped('welcome');
        }}
      />
      
      <OnboardingGuide
        step={onboarding.currentStep}
        stepIndex={onboarding.currentStepIndex}
        totalSteps={onboarding.totalSteps}
        onNext={onboarding.nextStep}
        onSkip={onboarding.skipFlow}
        isActive={onboarding.isActive}
      />
    </div>
  );
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

// 读取 URL 参数的内部组件
function SearchParamsReader() {
  const searchParams = useSearchParams();
  const isGuestFastEntry = searchParams.get('guest') === '1';
  return <StudentAppContent isGuestFastEntry={isGuestFastEntry} />;
}

// 默认导出 - 用 Suspense 包裹 useSearchParams
export default function StudentApp() {
  return (
    <Suspense fallback={<AppLoading message="加载中..." />}>
      <SearchParamsReader />
    </Suspense>
  );
}
