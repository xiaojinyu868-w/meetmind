'use client';

import { useState, useEffect, useCallback, useRef, Suspense, type ChangeEvent, type DragEvent } from 'react';
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
import { runMemoryMigration } from '@/lib/services/memory-migration';
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

// SWR data hooks for API state management.
import { useTopics, useSummary } from '@/hooks/data';

// WaveformPlayer uses forwardRef and needs static import for ref support.
import { WaveformPlayer, type WaveformPlayerRef, type WaveformAnchor } from '@/components/WaveformPlayer';

// NOTE: cleaned corrupted legacy comment.
import { AppLoading } from '@/components/AppLoading';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// NOTE: cleaned corrupted legacy comment.
import { Recorder } from '@/components/Recorder';
import { TimelineView } from '@/components/TimelineView';
import { ActionList } from '@/components/ActionList';
import { ActionSidebar } from '@/components/ActionSidebar';
import { ActionDrawer } from '@/components/ActionDrawer';
import { ResizablePanel } from '@/components/layout/ResizablePanel';
import { VideoLinkImporter } from '@/components/VideoLinkImporter';
import { VideoReviewPlayer } from '@/components/VideoReviewPlayer';
import { AITutor } from '@/components/AITutor';
import { TranscriptFlowView } from '@/components/TranscriptFlowView';
import { VideoInsightTimeline, type VideoInsightItem } from '@/components/VideoInsightTimeline';

import type { ConfusionMarker } from '@/components/mobile/PodcastPlayer';
import type { ConversationHistory } from '@/types/conversation';
import type { AudioSession } from '@/lib/db';

// Onboarding components.
import { useOnboarding } from '@/hooks/useOnboarding';
import { OnboardingGuide, WelcomeModal } from '@/components/OnboardingGuide';
import { HighlightsPanel } from '@/components/HighlightsPanel';
import { SummaryPanel } from '@/components/SummaryPanel';
import { NotesPanel } from '@/components/NotesPanel';
import { AnchorDetailPanel } from '@/components/AnchorDetailPanel';
import { WorkshopYellowPage } from '@/components/apps/WorkshopYellowPage';
import { WorkshopWindowManager, type FloatingWorkshopWindowState, getDefaultDisplayMode } from '@/components/apps/windows/WorkshopWindowManager';
import { ConversationList } from '@/components/ConversationHistory/ConversationList';
import { AIChat } from '@/components/AIChat';
import { SessionHistoryList } from '@/components/SessionHistoryList';
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

// NOTE: cleaned corrupted legacy comment.
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
  { key: 'highlights', label: '精选', icon: '精' },
  { key: 'summary', label: '摘要', icon: '摘' },
  { key: 'apps', label: 'AI工坊', icon: '坊', testId: 'review-tab-apps' },
  { key: 'notes', label: '笔记', icon: '记' },
];

const VIDEO_WORKSPACE_TABS: WorkspaceTabConfig<VideoWorkspaceTab>[] = [
  { key: 'chat', label: '对话', icon: '聊' },
  { key: 'confusion', label: '困惑点', icon: '疑' },
  ...SHARED_WORKSPACE_TABS,
];

const REVIEW_WORKSPACE_TABS: WorkspaceTabConfig<ReviewTab>[] = [
  { key: 'timeline', label: '时间轴', icon: '轴' },
  { key: 'anchor-detail', label: '困惑点', icon: '疑' },
  ...SHARED_WORKSPACE_TABS,
];

function isSharedWorkspaceTab(tab: WorkspaceTab): tab is SharedWorkspaceTab {
  return tab === 'highlights' || tab === 'summary' || tab === 'notes' || tab === 'apps';
}

const ACTION_PROGRESS_KEY_PREFIX = 'action_progress:';
const WORKSHOP_WINDOW_STATE_PREFIX = 'app_workspace_open_windows:';
const MAX_ACTIVE_WORKSHOP_WINDOWS = 2;

function getActionProgressKey(sessionId: string): string {
  return `${ACTION_PROGRESS_KEY_PREFIX}${sessionId}`;
}

function getWorkshopWindowStorageKey(sessionId: string): string {
  return `${WORKSHOP_WINDOW_STATE_PREFIX}${sessionId}`;
}

function normalizeWorkshopWindows(windows: FloatingWorkshopWindowState[]): FloatingWorkshopWindowState[] {
  if (windows.length <= MAX_ACTIVE_WORKSHOP_WINDOWS) return windows;

  const active = windows.filter((windowState) => !windowState.minimized);
  if (active.length <= MAX_ACTIVE_WORKSHOP_WINDOWS) return windows;

  const activeToMinimize = active
    .sort((a, b) => a.zIndex - b.zIndex)
    .slice(0, active.length - MAX_ACTIVE_WORKSHOP_WINDOWS)
    .map((windowState) => windowState.appKey);

  if (activeToMinimize.length === 0) return windows;

  const minimizeSet = new Set(activeToMinimize);
  return windows.map((windowState) =>
    minimizeSet.has(windowState.appKey) ? { ...windowState, minimized: true } : windowState
  );
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

type SourceIngestType = 'audio' | 'video' | 'document' | 'text';
type SourceIngestRole = 'primary' | 'support';

interface SourceIngestItem {
  id: string;
  type: SourceIngestType;
  role: SourceIngestRole;
  title: string;
  segmentCount: number;
  addedAt: string;
}

const VIDEO_INSIGHT_COLORS = ['#B48EFA', '#7FD4B2', '#7FADEB', '#F2AE8F', '#F0CD70', '#90D4DD'];

const AUDIO_FILE_PATTERN = /\.(mp3|wav|webm|ogg|m4a|aac|flac)$/i;
const DOCUMENT_FILE_PATTERN = /\.(txt|md|markdown|csv|json|html?|pdf|docx)$/i;

function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_FILE_PATTERN.test(file.name);
}

function isDocumentFile(file: File): boolean {
  return DOCUMENT_FILE_PATTERN.test(file.name);
}

function mapSegmentsForAppend(
  incoming: TranscriptSegment[],
  sourceItemId: string,
  offsetMs: number
): TranscriptSegment[] {
  return incoming.map((segment, index) => {
    const rawStart = Number.isFinite(segment.startMs) ? segment.startMs : 0;
    const rawEnd = Number.isFinite(segment.endMs) ? segment.endMs : rawStart + 1000;
    const startMs = Math.max(0, Math.floor(rawStart + offsetMs));
    const endMs = Math.max(startMs + 300, Math.floor(rawEnd + offsetMs));

    return {
      ...segment,
      id: segment.id || `${sourceItemId}-seg-${index + 1}`,
      sourceItemId,
      startMs,
      endMs,
      confidence: Number.isFinite(segment.confidence) ? segment.confidence : 0.9,
      isFinal: true,
    };
  });
}

function compactText(value: string, maxLength: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function mergeSupportReferences(
  previous: string[],
  incoming: string[],
  limit: number = 10
): string[] {
  const normalized = [...incoming, ...previous]
    .map((item) => compactText(item, 1200))
    .filter(Boolean);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

async function readJsonApiResponse<T>(response: Response, errorPrefix: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const snippet = compactText(raw.replace(/\s+/g, ' ').trim(), 200);
    const detail = snippet ? `：${snippet}` : '';
    throw new Error(`${errorPrefix}（接口返回非 JSON，HTTP ${response.status}）${detail}`);
  }
}

function buildASRContextHint(params: {
  manualHint: string;
  recentSegments: TranscriptSegment[];
  importedReferences?: string[];
  maxChars?: number;
}): string {
  const manualHint = compactText(params.manualHint || '', 800);
  const importedReferences = (params.importedReferences || [])
    .map((item) => compactText(item, 1000))
    .filter(Boolean)
    .slice(0, 3);
  const recentContext = compactText(
    params.recentSegments
      .slice(-30)
      .map((segment) => segment.text)
      .join(' '),
    1400
  );

  const parts = [
    manualHint ? `课程主题/术语：${manualHint}` : '',
    importedReferences.length > 0 ? `参考资料：${importedReferences.join('\n')}` : '',
    recentContext ? `已识别课堂上下文：${recentContext}` : '',
  ].filter(Boolean);

  if (parts.length === 0) return '';
  return compactText(parts.join('\n\n'), params.maxChars ?? 3000);
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
      prompt: '导入完成，已生成时间轴预览',
      summary: compactText(valid.slice(0, 3).map((seg) => seg.text).join(' '), 120),
      timestamps: Array.from(new Set(timestamps)).sort((a, b) => a - b),
      color: VIDEO_INSIGHT_COLORS[0],
    },
  ];
}

// NOTE: cleaned corrupted legacy comment.
function StudentAppContent({
  isGuestFastEntry,
  forcedWorkspaceTab,
}: {
  isGuestFastEntry: boolean;
  forcedWorkspaceTab: SharedWorkspaceTab | null;
}) {
  // NOTE: cleaned corrupted legacy comment.
  const [showSplash, setShowSplash] = useState(!isGuestFastEntry);
  const [appReady, setAppReady] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(isGuestFastEntry ? 50 : 0); // NOTE: cleaned corrupted legacy comment.
  
  // 鑾峰彇褰撳墠鐧诲綍鐢ㄦ埛
  const { user, isAuthenticated } = useAuth();
  
  // NOTE: cleaned corrupted legacy comment.
  const { isMobile, mounted } = useResponsive();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedConfusion, setSelectedConfusion] = useState<ConfusionMarker | null>(null);
  const [mobileSubPage, setMobileSubPage] = useState<'highlights' | 'summary' | 'notes' | 'tasks' | 'apps' | 'ai-chat' | 'transcript' | null>(null);
  const [mobileAIQuestion, setMobileAIQuestion] = useState<string>(''); // NOTE: cleaned corrupted legacy comment.
  
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
  
  // NOTE: cleaned corrupted legacy comment.
  const [reviewTab, setReviewTab] = useState<ReviewTab>(forcedWorkspaceTab === 'apps' ? 'apps' : 'timeline');
  const [videoWorkspaceTab, setVideoWorkspaceTab] = useState<VideoWorkspaceTab>(forcedWorkspaceTab === 'apps' ? 'apps' : 'chat');
  const forcedWorkspaceAppliedRef = useRef(false);
  useEffect(() => {
    if (forcedWorkspaceAppliedRef.current) return;
    if (forcedWorkspaceTab !== 'apps') return;
    setReviewTab('apps');
    setVideoWorkspaceTab('apps');
    forcedWorkspaceAppliedRef.current = true;
  }, [forcedWorkspaceTab]);
  const [showTranscriptBar, setShowTranscriptBar] = useState(false);
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
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [playAllIndex, setPlayAllIndex] = useState(0);
  
  // NOTE: cleaned corrupted legacy comment.
  const [showConversationHistory, setShowConversationHistory] = useState(false);
  const [selectedHistoryConversation, setSelectedHistoryConversation] = useState<ConversationHistory | null>(null);
  
  // NOTE: cleaned corrupted legacy comment.
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [sourcePanelMode, setSourcePanelMode] = useState<'audio' | 'support'>('audio');
  const [sourceImportMode, setSourceImportMode] = useState<'files' | 'text'>('files');
  const [sourceFilePickerMode, setSourceFilePickerMode] = useState<'audio' | 'support' | 'all'>('all');
  const [sourceImporting, setSourceImporting] = useState(false);
  const [sourceImportError, setSourceImportError] = useState('');
  const [sourceTextInput, setSourceTextInput] = useState('');
  const [asrContextHint, setAsrContextHint] = useState('');
  const [sourceItems, setSourceItems] = useState<SourceIngestItem[]>([]);
  const [supportReferences, setSupportReferences] = useState<string[]>([]);
  
  // NOTE: cleaned corrupted legacy comment.
  const [isActionDrawerOpen, setIsActionDrawerOpen] = useState(false);
  const [workshopWindows, setWorkshopWindows] = useState<FloatingWorkshopWindowState[]>([]);
  const workshopWindowZRef = useRef(20);
  
  // NOTE: cleaned corrupted legacy comment.
  const [showWelcome, setShowWelcome] = useState(false);
  const onboarding = useOnboarding({ isMobile });
  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const anchorsRef = useRef<Anchor[]>([]);
  const sessionIdRef = useRef<string>(sessionId);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<WaveformPlayerRef>(null);
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

  useEffect(() => {
    if (!mounted || !sessionId || typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(getWorkshopWindowStorageKey(sessionId));
    if (!raw) {
      setWorkshopWindows([]);
      workshopWindowZRef.current = 20;
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Array<{ appKey?: string; minimized?: boolean; zIndex?: number; displayMode?: string }>;
      if (!Array.isArray(parsed)) {
        setWorkshopWindows([]);
        workshopWindowZRef.current = 20;
        return;
      }
      const next = parsed
        .filter((item) => typeof item.appKey === 'string' && isWorkshopAppKey(item.appKey))
        .map((item, index) => ({
          appKey: item.appKey as WorkshopAppKey,
          minimized: Boolean(item.minimized),
          zIndex: typeof item.zIndex === 'number' && Number.isFinite(item.zIndex) ? item.zIndex : 20 + index,
          displayMode: (item.displayMode === 'panel' || item.displayMode === 'fullscreen') ? item.displayMode : getDefaultDisplayMode(item.appKey as WorkshopAppKey),
        }));
      setWorkshopWindows(normalizeWorkshopWindows(next));
      const maxZ = next.reduce((max, item) => Math.max(max, item.zIndex), 20);
      workshopWindowZRef.current = maxZ;
    } catch {
      setWorkshopWindows([]);
      workshopWindowZRef.current = 20;
    }
  }, [mounted, sessionId]);

  useEffect(() => {
    if (!mounted || !sessionId || typeof window === 'undefined') return;
    const payload = workshopWindows.map((windowState) => ({
      appKey: windowState.appKey,
      minimized: windowState.minimized,
      zIndex: windowState.zIndex,
      displayMode: windowState.displayMode,
    }));
    window.localStorage.setItem(getWorkshopWindowStorageKey(sessionId), JSON.stringify(payload));
  }, [mounted, sessionId, workshopWindows]);

  const focusWorkshopWindow = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => {
      const current = prev.find((item) => item.appKey === appKey);
      if (!current) return prev;
      const nextZ = workshopWindowZRef.current + 1;
      workshopWindowZRef.current = nextZ;
      return prev.map((item) => (item.appKey === appKey ? { ...item, zIndex: nextZ } : item));
    });
  }, []);

  const openWorkshopWindow = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => {
      const existing = prev.find((item) => item.appKey === appKey);
      const nextZ = workshopWindowZRef.current + 1;
      workshopWindowZRef.current = nextZ;

      if (existing) {
        return prev.map((item) =>
          item.appKey === appKey ? { ...item, minimized: false, zIndex: nextZ } : item
        );
      }

      const next = [...prev, { appKey, minimized: false, zIndex: nextZ, displayMode: getDefaultDisplayMode(appKey) }];
      return normalizeWorkshopWindows(next);
    });
  }, []);

  const closeWorkshopWindow = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => prev.filter((item) => item.appKey !== appKey));
  }, []);

  const toggleWorkshopWindowMinimize = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) => {
      const current = prev.find((item) => item.appKey === appKey);
      if (!current) return prev;
      const nextZ = workshopWindowZRef.current + 1;
      workshopWindowZRef.current = nextZ;
      const next = prev.map((item) =>
        item.appKey === appKey ? { ...item, minimized: !item.minimized, zIndex: nextZ } : item
      );
      return normalizeWorkshopWindows(next);
    });
  }, []);

  const toggleWorkshopWindowDisplayMode = useCallback((appKey: WorkshopAppKey) => {
    setWorkshopWindows((prev) =>
      prev.map((item) =>
        item.appKey === appKey
          ? { ...item, displayMode: item.displayMode === 'fullscreen' ? 'panel' : 'fullscreen' }
          : item
      )
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const migration = await runMemoryMigration();
      if (cancelled) return;
      if (!migration.ok) {
        toast.warning('历史数据迁移未完全完成，可继续使用，部分历史数据可能缺失。');
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
  
  // NOTE: cleaned corrupted legacy comment.
  useEffect(() => {
    // NOTE: cleaned corrupted legacy comment.
    if (!onboarding.isActive) {
      // NOTE: cleaned corrupted legacy comment.
      const timer = setTimeout(() => {
        setIsActionDrawerOpen(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [onboarding.isActive]);
  
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

  // NOTE: cleaned corrupted legacy comment.
  // Optimize init path via parallel loading and batched reads.
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
                  userId: ANONYMOUS_USER_ID, // Use anonymous user for demo data.
                  text: segment.text,
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                  confidence: segment.confidence || 1.0,
                  isFinal: true,
                }))
              ).catch((error) => console.error('Failed to persist demo transcript to IndexedDB:', error));
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
  
  // NOTE: cleaned corrupted legacy comment.
  const hasTriggeredWelcome = useRef(false);
  useEffect(() => {
    if (!isGuestFastEntry && !onboarding.isLoading && appReady && !showSplash && !hasTriggeredWelcome.current && onboarding.shouldShowFlow('welcome')) {
      hasTriggeredWelcome.current = true;
      setShowWelcome(true);
    }
  }, [isGuestFastEntry, onboarding, appReady, showSplash]);

  // NOTE: cleaned corrupted legacy comment.
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  const handleRecordingStart = useCallback((newSessionId: string) => {
    // NOTE: cleaned corrupted legacy comment.
    setSessionId(newSessionId);
    setIsRecording(true);
    setSegments([]);
    setAnchors([]);
    setSelectedAnchor(null); // 娓呴櫎閫変腑鐨勫洶鎯戠偣
    clearTopics(); // NOTE: cleaned corrupted legacy comment.
    clearSummary(); // NOTE: cleaned corrupted legacy comment.
    setNotes([]); // 娓呴櫎绗旇
    setActionItems([]); // 娓呴櫎琛屽姩娓呭崟
    setTimeline(null); // NOTE: cleaned corrupted legacy comment.
    setDataSource('live');
    setAudioUrl(null); // 娓呴櫎绀轰緥闊抽URL
    setAudioBlob(null); // 娓呴櫎闊抽 blob
    setVideoSource(null);
    setVideoInsightItems([]);
    setActiveVideoInsightId(null);
    setSourceItems([]);
    setSourceImportError('');
    setSourceTextInput('');
    setSourceImportMode('files');
    setSourcePanelMode('audio');
    setSourceFilePickerMode('all');
    setSupportReferences([]);
    liveSegmentsRef.current = [];
    anchorService.clear(newSessionId);
    // NOTE: cleaned corrupted legacy comment.
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    
    // 鍒涘缓璇剧▼浼氳瘽璁板綍 (渚涙暀甯堢璇诲彇)
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
    
    // NOTE: cleaned corrupted legacy comment.
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
    
    // 璁＄畻璇剧▼鏃堕暱
    const duration = finalSegments.length > 0 
      ? finalSegments[finalSegments.length - 1].endMs 
      : 0;
    
    // NOTE: cleaned corrupted legacy comment.
    classroomDataService.saveSession({
      id: sessionId,
      subject: UIConfig.defaultSubject,
      topic: UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
    });
    
    // Persist audio and transcript to IndexedDB history.
    if (blob && hasLiveData) {
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      
      // Save audio blob first.
      saveAudioSession(blob, sessionId, currentUserId, {
        subject: UIConfig.defaultSubject,
        topic: UIConfig.defaultLessonTitle,
        duration,
      }).catch(err => console.error('Failed to save audio session to history:', err));
      
      // NOTE: cleaned corrupted legacy comment.
      addTranscripts(sessionId, currentUserId, finalSegments.map((seg) => ({
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence || 1.0,
        isFinal: true,
      }))).catch(err => console.error('Failed to persist transcript to IndexedDB:', err));
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

  // NOTE: cleaned corrupted legacy comment.
  // NOTE: cleaned corrupted legacy comment.
  const handleViewModeChange = useCallback(async (newMode: 'record' | 'review') => {
    setViewMode(newMode);
    setMobileSubPage(null);
    // NOTE: cleaned corrupted legacy comment.
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
        
        // NOTE: cleaned corrupted legacy comment.
        const tl = memoryService.buildTimeline(
          sessionId,
          demoData.DEMO_SEGMENTS,
          demoData.DEMO_ANCHORS,
          { subject: UIConfig.defaultSubject, teacher: 'Demo Teacher', date: new Date().toISOString().split('T')[0] }
        );
        setTimeline(tl);
        
        // 閫変腑绗竴涓湭瑙ｅ喅鐨勫洶鎯戠偣
        const firstUnresolved = demoData.DEMO_ANCHORS.find(a => !a.resolved);
        if (firstUnresolved) {
          setSelectedAnchor(firstUnresolved);
          setCurrentTime(firstUnresolved.timestamp);
        }
        
        // NOTE: cleaned corrupted legacy comment.
        // NOTE: cleaned corrupted legacy comment.
        if (!onboarding.isActive && onboarding.shouldShowFlow('review')) {
          setTimeout(() => onboarding.startFlow('review'), 500);
        }
      } catch (err) {
        console.error('Failed to load demo data:', err);
      }
    } else if (newMode === 'review' && segments.length > 0) {
      // Enter review onboarding when data already exists.
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

  // Load a history session and switch to review mode.
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
      setSourceItems([]);
      setSourceImportError('');
      setSourceTextInput('');
      setSourceImportMode('files');
      setSourcePanelMode('audio');
      setSourceFilePickerMode('all');
      setSupportReferences([]);
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

  // 澶勭悊杞綍澧炲己瀹屾垚鍚庣殑鏇存柊
  const handleTranscriptEnhanced = useCallback((enhancedSegments: TranscriptSegment[]) => {
    console.log('[Page] Received enhanced transcript:', enhancedSegments.length, 'segments');
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
        prompt: compactText(payload.prompt || '鏈疆鎻愰棶', 48),
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
        // 鍚﹀垯鎵炬渶杩戠殑
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
        console.log('[AnchorMark] Timestamp aligned:', timestamp, '->', alignedTimestamp, '(was beyond segments range)');
      } else if (timestamp < segments[0].startMs - 5000) {
        alignedTimestamp = segments[0].startMs;
        console.log('[AnchorMark] Timestamp aligned:', timestamp, '->', alignedTimestamp, '(was before segments range)');
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
    
    // 鍐欏叆鍏变韩瀛樺偍 (渚涙暀甯堢璇诲彇)
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

  // 鍥炴斁鏃舵坊鍔犲洶鎯戠偣鏍囨敞
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
    
    // 鍐欏叆鍏变韩瀛樺偍
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
    
    // 鑷姩鍒囨崲鍒板洶鎯戠偣璇︽儏闈㈡澘
    setReviewTab('anchor-detail');
  }, [sessionId, studentId, studentName, timeline, segments]);

  const handleAnchorSelect = useCallback((anchor: Anchor) => {
    setSelectedAnchor(anchor);
    setCurrentTime(anchor.timestamp);
    // 鑷姩鍒囨崲鍒板洶鎯戠偣璇︽儏闈㈡澘
    setReviewTab('anchor-detail');
  }, []);

  const handleResolveAnchor = useCallback(() => {
    if (!selectedAnchor) return;
    
    anchorService.resolve(selectedAnchor.id, sessionId);
    
    // 鍚屾鏇存柊鍏变韩瀛樺偍
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

  // 生成精选片段（使用 SWR Hook，自动去重与重试）
  const handleGenerateTopics = useCallback(async (mode: TopicGenerationMode) => {
    try {
      console.log('[生成精选片段] 开始，模式:', mode, '片段数:', segments.length);
      await generateTopics(mode);
      console.log('[生成精选片段] 完成');
    } catch (error) {
      console.error('生成精选片段失败', error);
      alert(`生成失败: ${error instanceof Error ? error.message : '网络错误'}`);
    }
  }, [segments.length, generateTopics]);

  // NOTE: cleaned corrupted legacy comment.
  const handleRegenerateByTheme = useCallback(async (theme: string) => {
    try {
      await regenerateByTheme(theme);
    } catch (error) {
      console.error('鎸変富棰樼敓鎴愬け璐?', error);
    }
  }, [regenerateByTheme]);

  // Generate class summary via SWR hook.
  const handleGenerateSummary = useCallback(async () => {
    try {
      await generateSummary();
    } catch (error) {
      console.error('鐢熸垚鎽樿澶辫触:', error);
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

  // 鎾斁鍏ㄩ儴鐗囨
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

  // 娣诲姞绗旇
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

  // 鏇存柊绗旇
  const handleUpdateNote = useCallback((noteId: string, text: string) => {
    setNotes(prev => prev.map(n => 
      n.id === noteId ? { ...n, text, updatedAt: new Date().toISOString() } : n
    ));
  }, []);

  // 鍒犻櫎绗旇
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
  const totalDuration = segments.length > 0
    ? segments[segments.length - 1].endMs
    : 0;

  const appendSourceItem = useCallback((params: {
    type: SourceIngestType;
    role: SourceIngestRole;
    title: string;
    segmentCount: number;
    keepPrevious?: boolean;
  }) => {
    setSourceItems((prev) => {
      const item: SourceIngestItem = {
        id: `${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: params.type,
        role: params.role,
        title: params.title,
        segmentCount: params.segmentCount,
        addedAt: new Date().toISOString(),
      };
      if (params.keepPrevious === false) {
        const supportOnly = prev.filter((sourceItem) => sourceItem.role === 'support');
        return [...supportOnly, item];
      }
      return [...prev, item];
    });
  }, []);

  const appendSupportSource = useCallback((params: {
    type: Extract<SourceIngestType, 'document' | 'text'>;
    title: string;
    segments: TranscriptSegment[];
  }) => {
    const reference = compactText(
      (params.segments || [])
        .slice(0, 20)
        .map((segment) => segment.text)
        .join(' '),
      1200
    );
    appendSourceItem({
      type: params.type,
      role: 'support',
      title: params.title,
      segmentCount: params.segments.length,
    });
    if (reference) {
      setSupportReferences((prev) => mergeSupportReferences(prev, [reference]));
    }
  }, [appendSourceItem]);

  const ingestTranscriptSegments = useCallback(async (params: {
    segments: TranscriptSegment[];
    sourceType: SourceIngestType;
    sourceTitle: string;
    audioBlob?: Blob;
    videoSource?: ImportedVideoSource;
  }) => {
    const incoming = Array.isArray(params.segments) ? params.segments : [];
    if (incoming.length === 0) {
      toast.warning('未提取到可用内容，请更换资料后重试');
      return;
    }

    const existingSegments = segmentsRef.current;
    const hasExisting = existingSegments.length > 0;
    const nextSessionId = hasExisting ? sessionIdRef.current : generateSessionId();
    const sourceItemId = `${params.sourceType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const offsetMs = hasExisting
      ? Math.max(0, (existingSegments[existingSegments.length - 1]?.endMs || 0) + 1200)
      : 0;
    const normalizedSegments = mapSegmentsForAppend(incoming, sourceItemId, offsetMs);
    const mergedSegments = hasExisting ? [...existingSegments, ...normalizedSegments] : normalizedSegments;
    const currentUserId = user?.id || ANONYMOUS_USER_ID;
    const duration = mergedSegments[mergedSegments.length - 1]?.endMs || 0;

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
    setViewMode('review');
    setShowSessionHistory(false);
    setSourceImportError('');

    appendSourceItem({
      type: params.sourceType,
      role: 'primary',
      title: params.sourceTitle,
      segmentCount: normalizedSegments.length,
      keepPrevious: hasExisting,
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
            duration,
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
          duration,
          sourceType: 'upload',
        }).catch((error) => {
          console.error('Failed to persist imported audio session:', error);
        });
      }
    }

    classroomDataService.saveSession({
      id: nextSessionId,
      subject: UIConfig.defaultSubject,
      topic: params.sourceTitle || UIConfig.defaultLessonTitle,
      teacherName: UIConfig.defaultTeacher || 'Teacher',
      status: 'completed',
      duration,
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
  }, [appendSourceItem, clearSummary, clearTopics, studentId, user?.id]);

  const handleVideoImportReady = useCallback(async (result: ImportedVideoResult) => {
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
    });
  }, [ingestTranscriptSegments]);

  const transcribeAudioFile = useCallback(async (file: File, contextHint: string): Promise<TranscriptSegment[]> => {
    const formData = new FormData();
    formData.append('audio', file);
    if (contextHint.trim()) {
      formData.append('context', contextHint.trim());
    }
    const response = await fetch('/api/transcribe-turbo', {
      method: 'POST',
      body: formData,
    });
    const payload = await readJsonApiResponse<{
      success?: boolean;
      error?: string;
      segments?: TranscriptSegment[];
      sentences?: Array<{
        id?: string;
        text: string;
        beginTime?: number;
        endTime?: number;
      }>;
    }>(response, '音频转写失败');
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || '音频转写失败');
    }

    const segments = Array.isArray(payload.segments)
      ? payload.segments
      : (payload.sentences || []).map((item, index) => ({
          id: item.id || `seg-${index}`,
          text: item.text,
          startMs: item.beginTime || 0,
          endMs: item.endTime || 0,
          confidence: 0.95,
          isFinal: true,
        }));

    return segments;
  }, []);

  const parseDocumentFile = useCallback(async (file: File): Promise<{
    title: string;
    fileType: string;
    segments: TranscriptSegment[];
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/sources/ingest', {
      method: 'POST',
      body: formData,
    });
    const payload = await readJsonApiResponse<{
      success?: boolean;
      error?: string;
      title?: string;
      fileType?: string;
      segments?: TranscriptSegment[];
    }>(response, '文档导入失败');
    if (!response.ok || !payload.success || !Array.isArray(payload.segments)) {
      throw new Error(payload.error || '文档导入失败');
    }
    return {
      title: payload.title || file.name,
      fileType: payload.fileType || 'document',
      segments: payload.segments,
    };
  }, []);

  const handleImportFiles = useCallback(async (
    files: FileList | File[],
    pickerMode: 'audio' | 'support' | 'all' = 'all'
  ) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    setSourceImporting(true);
    setSourceImportError('');

    try {
      const orderedFiles = [...fileList].sort((a, b) => {
        const aAudio = isAudioFile(a);
        const bAudio = isAudioFile(b);
        if (aAudio === bAudio) return 0;
        return aAudio ? 1 : -1;
      });
      const importedReferenceTexts: string[] = [];
      let handledFileCount = 0;

      for (const file of orderedFiles) {
        if (isDocumentFile(file)) {
          if (pickerMode === 'audio') {
            continue;
          }
          const parsed = await parseDocumentFile(file);
          const supportType = parsed.fileType === 'txt' || parsed.fileType === 'md' ? 'text' : 'document';
          appendSupportSource({
            type: supportType,
            title: parsed.title,
            segments: parsed.segments,
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

        if (isAudioFile(file)) {
          if (pickerMode === 'support') {
            continue;
          }
          const contextHint = buildASRContextHint({
            manualHint: asrContextHint,
            recentSegments: segmentsRef.current,
            importedReferences: [...supportReferences, ...importedReferenceTexts],
            maxChars: 3000,
          });
          const segments = await transcribeAudioFile(file, contextHint);
          const audioBlob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
          await ingestTranscriptSegments({
            segments,
            sourceType: 'audio',
            sourceTitle: file.name,
            audioBlob,
          });
          handledFileCount += 1;
          continue;
        }

        throw new Error(`暂不支持文件类型: ${file.name}`);
      }

      if (handledFileCount === 0) {
        throw new Error(pickerMode === 'audio' ? '未选择可用音频文件' : '未选择可用增强资料');
      }

      if (pickerMode !== 'audio') {
        toast.success('增强资料已加入本会话，将用于后续转写与答疑上下文。');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSourceImportError(message);
      toast.error(message);
    } finally {
      setSourceImporting(false);
      setSourceFilePickerMode('all');
    }
  }, [
    appendSupportSource,
    asrContextHint,
    ingestTranscriptSegments,
    parseDocumentFile,
    supportReferences,
    transcribeAudioFile,
  ]);

  const handleSourceFileButtonClick = useCallback((mode: 'audio' | 'support') => {
    if (sourceImporting) return;
    setDataSource('demo');
    setSourcePanelMode(mode === 'audio' ? 'audio' : 'support');
    setSourceImportMode('files');
    setSourceFilePickerMode(mode);
    setShowSessionHistory(false);
    sourceFileInputRef.current?.click();
  }, [sourceImporting]);

  const handleSourceFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      void handleImportFiles(files, sourceFilePickerMode);
    }
    if (sourceFileInputRef.current) {
      sourceFileInputRef.current.value = '';
    }
  }, [handleImportFiles, sourceFilePickerMode]);

  const handleSourceFileDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (sourceImporting) return;
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      setDataSource('demo');
      setSourcePanelMode('support');
      setSourceImportMode('files');
      setSourceFilePickerMode('all');
      setShowSessionHistory(false);
      void handleImportFiles(files, 'all');
    }
  }, [handleImportFiles, sourceImporting]);

  const handleImportTextSource = useCallback(async () => {
    const text = sourceTextInput.trim();
    if (!text) {
      toast.warning('请先粘贴文本内容');
      return;
    }

    setSourceImporting(true);
    setSourceImportError('');

    try {
      const response = await fetch('/api/sources/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `粘贴文本-${new Date().toLocaleTimeString()}`,
          text,
        }),
      });
      const payload = await readJsonApiResponse<{
        success?: boolean;
        error?: string;
        title?: string;
        segments?: TranscriptSegment[];
      }>(response, '文本导入失败');
      if (!response.ok || !payload.success || !Array.isArray(payload.segments)) {
        throw new Error(payload.error || '文本导入失败');
      }

      appendSupportSource({
        type: 'text',
        title: payload.title || '粘贴文本',
        segments: payload.segments,
      });
      toast.success('增强文本已加入本会话，将用于后续转写与答疑上下文。');
      setSourceTextInput('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSourceImportError(message);
      toast.error(message);
    } finally {
      setSourceImporting(false);
    }
  }, [appendSupportSource, sourceTextInput]);

  const renderInputSourceTabs = useCallback((layout: 'mobile' | 'desktop') => {
    const isMobileLayout = layout === 'mobile';
    const actionButtonClass = isMobileLayout
      ? 'shrink-0 min-w-[92px] rounded-2xl border px-3 py-2 text-[12px] font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300'
      : 'rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300';
    const activeButtonClass =
      'border-amber-300 bg-gradient-to-r from-amber-50 via-amber-50 to-orange-50 text-amber-700 shadow-[0_4px_14px_rgba(245,158,11,0.18)]';
    const inactiveButtonClass =
      'border-slate-200 bg-white/85 text-slate-600 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm';

    const audioUploadActive = dataSource === 'demo' && sourcePanelMode === 'audio' && !showSessionHistory;
    const supportActive = dataSource === 'demo' && sourcePanelMode === 'support' && !showSessionHistory;

    const primaryActions = [
      {
        key: 'live',
        label: '实时录音',
        tone: 'bg-emerald-400',
        testId: 'source-live-button',
        active: dataSource === 'live' && !showSessionHistory,
        onClick: () => {
          setDataSource('live');
          setShowSessionHistory(false);
        },
      },
      {
        key: 'audio-upload',
        label: '上传音频',
        tone: 'bg-blue-400',
        testId: 'source-upload-button',
        active: audioUploadActive,
        onClick: () => handleSourceFileButtonClick('audio'),
      },
      {
        key: 'video',
        label: '视频链接',
        tone: 'bg-fuchsia-400',
        testId: 'source-video-button',
        active: dataSource === 'video' && !showSessionHistory,
        onClick: () => {
          setDataSource('video');
          setShowSessionHistory(false);
        },
      },
    ] as const;

    const secondaryActions = [
      {
        key: 'support',
        label: '增强资料',
        tone: 'bg-cyan-400',
        testId: 'source-support-button',
        active: supportActive,
        onClick: () => {
          setDataSource('demo');
          setSourcePanelMode('support');
          setSourceImportMode('files');
          setShowSessionHistory(false);
        },
      },
      {
        key: 'history',
        label: isMobileLayout ? '历史记录' : '录音历史',
        tone: 'bg-violet-400',
        testId: 'source-history-button',
        active: showSessionHistory,
        onClick: () => setShowSessionHistory(true),
      },
    ] as const;

    const sourceFileAccept =
      sourceFilePickerMode === 'audio'
        ? 'audio/*,.mp3,.wav,.webm,.ogg,.m4a,.aac,.flac'
        : sourceFilePickerMode === 'support'
          ? '.txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx'
          : 'audio/*,.mp3,.wav,.webm,.ogg,.m4a,.aac,.flac,.txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx';

    const recentPrimaryItems = sourceItems.filter((item) => item.role === 'primary').slice(-4);
    const recentSupportItems = sourceItems.filter((item) => item.role === 'support').slice(-6);

    return (
      <div className="space-y-4" data-onboarding="input-methods">
        <input
          ref={sourceFileInputRef}
          type="file"
          accept={sourceFileAccept}
          multiple
          onChange={handleSourceFileInputChange}
          className="hidden"
        />

        <div
          className="relative overflow-hidden rounded-3xl border border-slate-200/90 bg-[linear-gradient(130deg,#f8fafc_0%,#fff7ed_56%,#eef2ff_100%)] p-4 md:p-5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]"
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={handleSourceFileDrop}
        >
          <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-blue-200/30 blur-3xl" />
          <div className="pointer-events-none absolute -left-14 -bottom-14 h-36 w-36 rounded-full bg-amber-200/30 blur-3xl" />
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/80 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                  数据采集入口
                </span>
                <p className={`${isMobileLayout ? 'mt-2 text-base' : 'mt-2.5 text-xl'} font-bold text-slate-900`}>拖拽或选择资料</p>
                <p className={`${isMobileLayout ? 'text-xs' : 'text-sm'} mt-1 max-w-2xl leading-6 text-slate-600`}>
                  主来源用于生成课堂主转写；增强资料会作为上下文，提升后续音频转写与 AI 理解质量。
                </p>
              </div>
              {!isMobileLayout ? (
                <div className="rounded-2xl border border-white/80 bg-white/70 px-3 py-2 text-xs text-slate-500 shadow-sm">
                  支持拖拽上传
                </div>
              ) : null}
            </div>

            <div className={`mt-4 ${isMobileLayout ? 'space-y-3' : 'grid grid-cols-2 gap-3'}`}>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
                <p className="text-xs font-semibold tracking-[0.08em] text-slate-500">主学习来源</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {primaryActions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      data-testid={action.testId}
                      onClick={action.onClick}
                      className={`${actionButtonClass} ${action.active ? activeButtonClass : inactiveButtonClass}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${action.tone}`} />
                        {action.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/80 bg-white/80 p-3 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
                <p className="text-xs font-semibold tracking-[0.08em] text-slate-500">辅助与管理</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {secondaryActions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      data-testid={action.testId}
                      onClick={action.onClick}
                      className={`${actionButtonClass} ${action.active ? activeButtonClass : inactiveButtonClass}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${action.tone}`} />
                        {action.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {sourceImporting ? (
              <p className={`${isMobileLayout ? 'text-xs' : 'text-sm'} mt-3 font-medium text-amber-700`}>正在处理导入资料...</p>
            ) : null}
            {!sourceImporting && sourceImportError ? (
              <p className={`${isMobileLayout ? 'text-xs' : 'text-sm'} mt-3 font-medium text-rose-600`}>{sourceImportError}</p>
            ) : null}
          </div>
        </div>

        {sourceItems.length > 0 ? (
          <div className={`grid gap-3 ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold tracking-[0.08em] text-slate-500">主来源</p>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">{recentPrimaryItems.length}</span>
              </div>
              {recentPrimaryItems.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {recentPrimaryItems.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                    >
                      <span>{item.type === 'video' ? '视频' : '音频'}</span>
                      <span className="max-w-[160px] truncate">{item.title}</span>
                      <span className="text-slate-400">{item.segmentCount} 段</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">还没有主来源，请先录音、上传音频或导入视频链接。</p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold tracking-[0.08em] text-slate-500">增强资料</p>
                <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700">{recentSupportItems.length}</span>
              </div>
              {recentSupportItems.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {recentSupportItems.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-1 rounded-full border border-cyan-100 bg-cyan-50/60 px-2.5 py-1 text-xs font-medium text-cyan-800"
                    >
                      <span>{item.type === 'document' ? '文档' : '文本'}</span>
                      <span className="max-w-[160px] truncate">{item.title}</span>
                      <span className="text-cyan-500">{item.segmentCount} 段</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-400">可选上传 PDF/讲义/文本，为后续识别和应用生成提供支撑。</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }, [
    dataSource,
    handleSourceFileButtonClick,
    handleSourceFileDrop,
    handleSourceFileInputChange,
    showSessionHistory,
    sourceFilePickerMode,
    sourceImportError,
    sourceImporting,
    sourceItems,
    sourcePanelMode,
  ]);

  const renderInputSecondaryPanels = useCallback((layout: 'mobile' | 'desktop') => {
    const isMobileLayout = layout === 'mobile';
    const historyMaxHeight = isMobileLayout ? '400px' : '500px';
    const cardPaddingClass = isMobileLayout ? 'p-4' : 'p-6';
    const titleClass = isMobileLayout ? 'mb-2 text-base font-bold text-slate-900' : 'mb-2 text-2xl font-bold text-slate-900';
    const surfaceClass = `relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_14px_34px_rgba(15,23,42,0.06)] ${cardPaddingClass}`;
    const inputClass =
      'w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-100';

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

        <div className={surfaceClass} style={{ display: dataSource === 'video' && !showSessionHistory ? undefined : 'none' }}>
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-fuchsia-100/45 blur-3xl" />
          <h3 className={titleClass}>视频链接导入</h3>
          <p className="mb-4 text-sm leading-6 text-slate-600">导入 B 站视频后自动转写，直接进入课堂复习流。</p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <VideoLinkImporter
            onImportReady={handleVideoImportReady}
            onError={(error) => {
              console.error('视频导入失败:', error);
              toast.error(String(error));
            }}
            disabled={isRecording || sourceImporting}
          />
          </div>
        </div>

        <div
          className={surfaceClass}
          style={{ display: dataSource === 'demo' && sourcePanelMode === 'audio' && !showSessionHistory ? undefined : 'none' }}
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-blue-100/45 blur-3xl" />
          <h3 className={titleClass}>上传音频（主来源）</h3>
          <p className="text-sm leading-6 text-slate-600">
            支持批量导入课堂录音。可以先补充识别提示，再上传音频。
          </p>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <label className="mb-2 block text-xs font-semibold tracking-[0.08em] text-slate-500">识别增强提示（可选）</label>
            <textarea
              value={asrContextHint}
              onChange={(event) => setAsrContextHint(event.target.value)}
              placeholder="例如：本节课讲解圆锥曲线离心率，重点是定义、几何意义和高考题型。"
              rows={isMobileLayout ? 3 : 4}
              disabled={sourceImporting || isRecording}
              className={inputClass}
            />
            <p className="mt-2 text-xs leading-5 text-slate-500">系统会自动融合增强资料中的 PDF/文本，提高 ASR 与后续应用生成质量。</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleSourceFileButtonClick('audio')}
              disabled={sourceImporting || isRecording}
              className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(245,158,11,0.32)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sourceImporting ? '处理中...' : '上传音频'}
            </button>
            <span className="text-xs text-slate-500">支持 mp3 / wav / webm / m4a / aac / flac</span>
          </div>
        </div>

        <div
          className={surfaceClass}
          style={{ display: dataSource === 'demo' && sourcePanelMode === 'support' && !showSessionHistory ? undefined : 'none' }}
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan-100/45 blur-3xl" />
          <h3 className={titleClass}>增强资料（可选）</h3>
          <p className="text-sm leading-6 text-slate-600">
            导入讲义、课件、题解或粘贴文本。它们不会覆盖主转写，只作为上下文增强。
          </p>

          <div className="mt-4 inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setSourceImportMode('files')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                sourceImportMode === 'files'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              上传文档
            </button>
            <button
              type="button"
              onClick={() => setSourceImportMode('text')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                sourceImportMode === 'text'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              粘贴文本
            </button>
          </div>

          {sourceImportMode === 'files' ? (
            <div className="mt-4">
              <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 px-3 py-2 text-xs text-cyan-700">
                当前增强资料数量：{sourceItems.filter((item) => item.role === 'support').length}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSourceFileButtonClick('support')}
                  disabled={sourceImporting || isRecording}
                  className="rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,116,144,0.28)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sourceImporting ? '处理中...' : '上传资料'}
                </button>
                <span className="text-xs text-slate-500">支持 pdf / docx / txt / md / csv / json / html</span>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <textarea
                value={sourceTextInput}
                onChange={(event) => setSourceTextInput(event.target.value)}
                placeholder="粘贴课堂笔记、重点定义、题目解析等文本..."
                rows={isMobileLayout ? 5 : 7}
                disabled={sourceImporting || isRecording}
                className={inputClass}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-500">建议 200-5000 字，可多次追加</span>
                <button
                  type="button"
                  onClick={() => {
                    void handleImportTextSource();
                  }}
                  disabled={sourceImporting || isRecording || !sourceTextInput.trim()}
                  className="rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,116,144,0.28)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sourceImporting ? '处理中...' : '导入文本'}
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }, [
    asrContextHint,
    dataSource,
    handleImportTextSource,
    handleLoadHistorySession,
    handleSourceFileButtonClick,
    handleVideoImportReady,
    isRecording,
    sessionId,
    showSessionHistory,
    sourceImportMode,
    sourceImporting,
    sourceItems,
    sourcePanelMode,
    sourceTextInput,
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

  const shouldAllowPageScroll = !isMobile && (viewMode === 'record' || (viewMode === 'review' && !!videoSource));
  const useFixedViewportLayout = !(!isMobile && viewMode === 'record');

  return (
    <div
      className={`${useFixedViewportLayout ? 'h-dvh' : 'min-h-dvh'} flex flex-col main-content-enter browser-safe-top ${
        shouldAllowPageScroll ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
      }`}
      style={useFixedViewportLayout ? { height: '100dvh', minHeight: '-webkit-fill-available' } : { minHeight: '100dvh' }}
    >
      {/* NOTE: cleaned corrupted legacy comment. */}
      {!isMobile && <DegradedModeBanner status={serviceStatus} />}
      
      {/* NOTE: cleaned corrupted legacy comment. */}
      {!isMobile && (
        <Header 
          lessonTitle={viewMode === 'record' ? '课堂录音' : '课堂复习'}
          courseName=""
        />
      )}

      {/* NOTE: cleaned corrupted legacy comment. */}
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
                录音
              </button>
              <button
                onClick={() => handleViewModeChange('review')}
                data-testid="mode-review-button"
                className={`mode-tab ${viewMode === 'review' ? 'active' : ''}`}
              >
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

      {/* 涓诲唴瀹瑰尯 */}
      {viewMode === 'record' ? (
        <>
          {/* NOTE: cleaned corrupted legacy comment. */}
          {isMobile ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 鏋佺畝椤堕儴鏍忥細Logo + Tab + 鐢ㄦ埛 + 鑿滃崟 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-2 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                
                {/* Tab 鍒囨崲 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    data-onboarding="mode-switch"
                  />
                </div>
                
                {/* 鐢ㄦ埛澶村儚/鐧诲綍鎸夐挳 */}
                {isAuthenticated && user ? (
                  <button
                    onClick={() => setIsMenuOpen(true)}
                    className="w-8 h-8 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                  >
                    <Avatar className="w-full h-full">
                      {user.avatar ? (
                        <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="bg-transparent text-sm">用户</AvatarFallback>
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
                
                {/* 鑿滃崟鎸夐挳 */}
                <DedaoMenuButton onClick={() => setIsMenuOpen(true)} />
              </div>

              {/* NOTE: cleaned corrupted legacy comment. */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="w-full max-w-md mx-auto flex flex-col gap-3 pb-6">
                  {/* NOTE: cleaned corrupted legacy comment. */}
                  <div className="flex-shrink-0 mb-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-medium tracking-[0.02em] text-slate-500">选择输入方式</span>
                      <span className="text-[10px] text-slate-400">课堂采集入口</span>
                    </div>
                    {renderInputSourceTabs('mobile')}
                  </div>

                  <div className="min-h-[360px]" style={{ display: dataSource === 'live' && !showSessionHistory ? undefined : 'none' }}>
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
                  
                  {/* NOTE: cleaned corrupted legacy comment. */}
                  {anchors.length > 0 && (
                    <div className="card-edu p-4 animate-slide-up">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span>📍</span>
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

              {/* Right-side drawer menu. */}
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
            /* NOTE: cleaned corrupted legacy comment. */
            <div className="flex-1 flex items-start justify-center overflow-visible px-4 py-6 md:px-8 page-enter relative" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 鑳屾櫙瑁呴グ */}
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
              
              <div className="w-full max-w-4xl mx-auto relative z-10 min-h-full flex flex-col gap-6 pb-6">
                <div className="flex-shrink-0">{renderInputSourceTabs('desktop')}</div>

            {/* NOTE: cleaned corrupted legacy comment. */}
            <div className="relative min-h-[460px]" style={{ display: dataSource === 'live' && !showSessionHistory ? undefined : 'none' }}>
              {/* 瑁呴グ鎻掔敾 */}
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
            
                {/* NOTE: cleaned corrupted legacy comment. */}
                {anchors.length > 0 && (
                  <div className="card-edu p-5 animate-slide-up">
                    <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <span>📍</span>
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
          {/* 妗岄潰绔竷灞€ */}
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
                        onClick={() => setShowTranscriptBar(prev => !prev)}
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
                            <p className="text-xs text-gray-300">在右侧对话后，高亮内容会出现在这里</p>
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
                              ? 'bg-white text-amber-600 font-medium shadow-sm'
                              : 'text-gray-500 hover:text-gray-800 hover:bg-white/60'
                          }`}
                        >
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
                                  onSeek={(timeMs) => handleUnifiedSeek(timeMs, true)}
                                />
                              </div>
                            </>
                          ) : (
                            <div className="h-full overflow-y-auto p-4">
                              {/* 鏍囪鍥版儜鎸夐挳 */}
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
                                          : 'border-amber-100 bg-amber-50/50 hover:border-amber-200'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${anchor.resolved ? 'bg-green-400' : 'bg-amber-400'}`} />
                                        <span className="text-xs font-mono text-gray-400">{formatTime(anchor.timestamp)}</span>
                                        <span className="text-xs text-gray-500">困惑点 #{index + 1}</span>
                                        {anchor.resolved ? (
                                          <span className="text-xs text-green-500 ml-auto">已解决</span>
                                        ) : (
                                          <span className="text-xs text-amber-500 ml-auto">点击对话</span>
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
                          data-onboarding={tab.key === 'timeline' ? 'timeline' : undefined}
                          data-testid={tab.testId}
                          onClick={() => setReviewTab(tab.key)}
                          className={`px-3 py-2 text-sm rounded-lg transition-all whitespace-nowrap tab-button ${
                            reviewTab === tab.key
                              ? 'bg-white text-amber-600 font-medium shadow-sm'
                              : 'text-gray-500 hover:text-navy hover:bg-white/50'
                          }`}
                        >
                          {tab.label}
                          {tab.key === 'anchor-detail' && selectedAnchor && !selectedAnchor.resolved && (
                            <span className="ml-1 w-2 h-2 bg-coral rounded-full inline-block animate-pulse" />
                          )}
                          {tab.key === 'highlights' && highlightTopics.length > 0 && (
                            <span className="ml-1 text-xs text-skyblue-600">({highlightTopics.length})</span>
                          )}
                          {tab.key === 'summary' && classSummary && <span className="ml-1 text-xs text-mint-600">OK</span>}
                          {tab.key === 'notes' && notes.length > 0 && (
                            <span className="ml-1 text-xs text-amber-600">({notes.length})</span>
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
                    <div className="flex-1 min-h-0 flex flex-col" data-onboarding="ai-tutor" style={{ minHeight: 'var(--ai-chat-min-height, 300px)' }}>
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
                                {/* NOTE: cleaned corrupted legacy comment. */}
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

              {/* 琛屽姩娓呭崟鎶藉眽 */}
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
            /* 绉诲姩绔暀鑲查鏍煎竷灞€ */
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 鏋佺畝椤堕儴鏍忥細Logo + Tab + 鐢ㄦ埛 + 鑿滃崟 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-2 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">M</span>
                </div>
                
                {/* Tab 鍒囨崲 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    data-onboarding="mode-switch"
                  />
                </div>
                
                {/* 鐢ㄦ埛澶村儚/鐧诲綍鎸夐挳 */}
                {isAuthenticated && user ? (
                  <button
                    onClick={() => setIsMenuOpen(true)}
                    className="w-8 h-8 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                  >
                    <Avatar className="w-full h-full">
                      {user.avatar ? (
                        <AvatarImage src={user.avatar} alt={user.nickname} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="bg-transparent text-sm">用户</AvatarFallback>
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
                
                {/* 鑿滃崟鎸夐挳 */}
                <DedaoMenuButton onClick={() => setIsMenuOpen(true)} data-onboarding="menu-button" />
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

                  {/* 鎮诞 AI 瀵硅瘽鎸夐挳 - 杩涘叆鍏ㄥ眬 AI 瀵硅瘽 */}
                  <MobileAIFab
                    onClick={() => {
                      setSelectedAnchor(null);  // Clear selected anchor before entering global AI chat.
                      setMobileAIQuestion('');
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
                <div className="flex-1 min-h-0 flex flex-col bg-white">
                  {/* NOTE: cleaned corrupted legacy comment. */}
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
                    
                    {/* 鍘嗗彶璁板綍鍒囨崲 - ChatGPT 椋庢牸鍥炬爣鎸夐挳 */}
                    <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                      {/* 褰撳墠瀵硅瘽 */}
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
                      {/* 鍘嗗彶璁板綍 */}
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
                  
                  {/* NOTE: cleaned corrupted legacy comment. */}
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
                  
                  {/* NOTE: cleaned corrupted legacy comment. */}
                  <div className="flex-1 min-h-0">
                    {showConversationHistory ? (
                      selectedHistoryConversation ? (
                        // 缁х画鍘嗗彶瀵硅瘽
                        <div className="h-full flex flex-col">
                          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-xs text-gray-600 truncate flex-1 mr-2">{selectedHistoryConversation.title}</span>
                            <div className="flex items-center gap-1">
                              {/* 杩斿洖鍒楄〃 */}
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
                        // 鍘嗗彶瀵硅瘽鍒楄〃
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

      <WorkshopWindowManager
        windows={workshopWindows}
        sessionId={sessionId}
        dataSource={dataSource}
        transcript={segments}
        anchors={anchors}
        summaryOverview={classSummary?.overview}
        keyDifficulties={classSummary?.keyDifficulties}
        onSeek={(timeMs) => {
          handleUnifiedSeek(timeMs, true);
        }}
        onClose={closeWorkshopWindow}
        onToggleMinimize={toggleWorkshopWindowMinimize}
        onFocus={focusWorkshopWindow}
        onToggleDisplayMode={toggleWorkshopWindowDisplayMode}
      />
      
      {/* 鐢ㄦ埛寮曞缁勪欢 */}
      <WelcomeModal
        isOpen={showWelcome}
        onStart={() => {
          setShowWelcome(false);
          // NOTE: cleaned corrupted legacy comment.
          onboarding.markFlowComplete('welcome');
          setTimeout(() => {
            onboarding.startFlow('recording');
          }, 100);
        }}
        onSkip={() => {
          setShowWelcome(false);
          // NOTE: cleaned corrupted legacy comment.
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

// NOTE: cleaned corrupted legacy comment.
function SearchParamsReader() {
  const searchParams = useSearchParams();
  const isGuestFastEntry = searchParams.get('guest') === '1';
  const forcedWorkspaceTab = searchParams.get('workspace') === 'apps' ? 'apps' : null;
  return <StudentAppContent isGuestFastEntry={isGuestFastEntry} forcedWorkspaceTab={forcedWorkspaceTab} />;
}

// NOTE: cleaned corrupted legacy comment.
export default function StudentApp() {
  return (
    <Suspense fallback={<AppLoading message="加载中..." />}>
      <SearchParamsReader />
    </Suspense>
  );
}



