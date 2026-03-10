'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
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
import { parseVideoLink } from '@/lib/utils/video-link';
import { useVoiceInput } from '@/hooks/useVoiceInput';
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
  Plus,
  Link2,
  History,
  Menu,
  X,
  Image as ImageIcon,
  AudioLines,
  Play,
  Pause,
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
const VideoLinkImporter = dynamic(() => import('@/components/VideoLinkImporter').then(m => ({ default: m.VideoLinkImporter })), { ssr: false });
const VideoReviewPlayer = dynamic(() => import('@/components/VideoReviewPlayer').then(m => ({ default: m.VideoReviewPlayer })), { ssr: false });
const AITutor = dynamic(() => import('@/components/AITutor').then(m => ({ default: m.AITutor })), { ssr: false });
const TranscriptFlowView = dynamic(() => import('@/components/TranscriptFlowView').then(m => ({ default: m.TranscriptFlowView })), { ssr: false });
const VideoInsightTimeline = dynamic(() => import('@/components/VideoInsightTimeline').then(m => ({ default: m.VideoInsightTimeline })), { ssr: false });

import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
import type { ConfusionMarker } from '@/components/mobile/PodcastPlayer';
import type { ConversationHistory } from '@/types/conversation';
import type { AudioSession } from '@/lib/db';

// Onboarding & workspace components - dynamic loaded
import { useOnboarding } from '@/hooks/useOnboarding';
const OnboardingGuide = dynamic(() => import('@/components/OnboardingGuide').then(m => ({ default: m.OnboardingGuide })), { ssr: false });
const WelcomeModal = dynamic(() => import('@/components/OnboardingGuide').then(m => ({ default: m.WelcomeModal })), { ssr: false });
const HighlightsPanel = dynamic(() => import('@/components/HighlightsPanel').then(m => ({ default: m.HighlightsPanel })), { ssr: false });
const SummaryPanel = dynamic(() => import('@/components/SummaryPanel').then(m => ({ default: m.SummaryPanel })), { ssr: false });
const NotesPanel = dynamic(() => import('@/components/NotesPanel').then(m => ({ default: m.NotesPanel })), { ssr: false });
const AnchorDetailPanel = dynamic(() => import('@/components/AnchorDetailPanel').then(m => ({ default: m.AnchorDetailPanel })), { ssr: false });
const WorkshopYellowPage = dynamic(() => import('@/components/apps/WorkshopYellowPage').then(m => ({ default: m.WorkshopYellowPage })), { ssr: false });
import { type FloatingWorkshopWindowState, getDefaultDisplayMode } from '@/components/apps/windows/WorkshopWindowManager';
const WorkshopWindowManager = dynamic(() => import('@/components/apps/windows/WorkshopWindowManager').then(m => ({ default: m.WorkshopWindowManager })), { ssr: false });
const ConversationList = dynamic(() => import('@/components/ConversationHistory/ConversationList').then(m => ({ default: m.ConversationList })), { ssr: false });
const AIChat = dynamic(() => import('@/components/AIChat').then(m => ({ default: m.AIChat })), { ssr: false });
const SessionHistoryList = dynamic(() => import('@/components/SessionHistoryList').then(m => ({ default: m.SessionHistoryList })), { ssr: false });
const WorkspaceCaptureList = dynamic(() => import('@/components/WorkspaceCaptureList').then(m => ({ default: m.WorkspaceCaptureList })), { ssr: false });
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
  LucideIcon?: LucideIconType;
  testId?: string;
}

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

type SourceIngestType = 'audio' | 'video' | 'image' | 'document' | 'text';
type SourceIngestRole = 'primary' | 'support';
type MobileCollectionSheet = null | 'attachments' | 'video' | 'history' | 'echo' | 'more';

interface SourceIngestItem {
  id: string;
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
  addedAt: string;
  origin?: 'user' | 'system';
  status?: 'sending' | 'transcribing' | 'parsing' | 'ready' | 'failed';
  statusText?: string;
  sessionId?: string;
  durationMs?: number;
  reviewable?: boolean;
}

interface SupportReferenceItem {
  id: string;
  title: string;
  snippet: string;
}

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

interface CollectionPulseState {
  title: string;
  body: string;
  chips: string[];
  actions: Array<{ key: string; label: string }>;
}

interface WechatCaptureMessage {
  linkToken: string;
  msgType: string;
  eventType?: string | null;
  normalizedText?: string | null;
  previewText?: string | null;
  sourceUrl?: string | null;
  mediaId?: string | null;
  mediaUrl?: string | null;
  title?: string | null;
  reachKind?: string | null;
  reachChannel?: string | null;
  messageAt?: string | null;
  replyText?: string | null;
  userId?: string | null;
  workspaceId?: string | null;
  workspace?: {
    id: string;
    name: string;
    kind: string;
    status: string;
  } | null;
  bindingStatus?: string | null;
  collectionRole?: string | null;
  echoTitle?: string | null;
  echoBody?: string | null;
  echoChips?: string[] | null;
  tutorContext?: string | null;
}

interface WorkspaceCaptureMessage {
  id: string;
  sourceKey: string;
  sourceType: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  tutorContext?: string | null;
  occurredAt?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

interface WorkspaceEchoMessage {
  id: string;
  sourceKey: string;
  title: string;
  body: string;
  chips: string[];
  createdAt: string;
}

const VIDEO_INSIGHT_COLORS = ['#B48EFA', '#7FD4B2', '#7FADEB', '#F2AE8F', '#F0CD70', '#90D4DD'];

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

function compactMultilineText(value: string, maxLength: number): string {
  const normalized = (value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function buildSupportReferenceSnippet(
  segments: TranscriptSegment[],
  maxLength: number = 2800
): string {
  const chunks = (segments || [])
    .map((segment) => compactText(segment.text || '', 240))
    .filter((item) => item.length > 0);

  if (chunks.length === 0) return '';

  const full = compactText(chunks.join(' '), maxLength);
  if (full.length < maxLength * 0.95 || chunks.length <= 24) {
    return full;
  }

  // 覆盖文档头部、主体和尾部，避免只截取前几段导致问答命中率偏低。
  const head = chunks.slice(0, 10);
  const tail = chunks.slice(Math.max(chunks.length - 6, 10));
  const middleStart = Math.max(10, Math.floor(chunks.length * 0.45));
  const middle = chunks.slice(middleStart, Math.min(middleStart + 8, chunks.length - 6));

  return compactText([...head, ...middle, ...tail].join(' '), maxLength);
}

function mergeSupportReferences(
  previous: SupportReferenceItem[],
  incoming: SupportReferenceItem[],
  limit: number = 10
): SupportReferenceItem[] {
  const normalized = [...incoming, ...previous]
    .map((item) => ({
      id: item.id,
      title: compactText(item.title || '补充材料', 80),
      snippet: compactText(item.snippet || '', 2800),
    }))
    .filter((item) => item.snippet.length > 0);
  const unique: SupportReferenceItem[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    const key = `${item.title.toLowerCase()}::${item.snippet.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

function mergeWorkspaceEchoes(
  previous: WorkspaceEchoMessage[],
  incoming: WorkspaceEchoMessage[],
  limit: number = 16
): WorkspaceEchoMessage[] {
  const normalized = [...incoming, ...previous]
    .filter((item) => item && item.id && item.title && item.body)
    .map((item) => ({
      ...item,
      title: compactText(item.title, 80),
      body: compactText(item.body, 220),
      chips: Array.isArray(item.chips) ? item.chips.filter(Boolean).slice(0, 4) : [],
    }));

  const unique: WorkspaceEchoMessage[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}

function mergeWorkspaceCaptures(
  previous: WorkspaceCaptureMessage[],
  incoming: WorkspaceCaptureMessage[],
  limit: number = 80
): WorkspaceCaptureMessage[] {
  const normalized = [...incoming, ...previous]
    .filter((item) => item && item.id && item.title)
    .map((item) => ({
      ...item,
      title: compactText(item.title, 80),
      previewText: compactText(item.previewText || item.title, 220),
    }));

  const unique: WorkspaceCaptureMessage[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique.sort(
    (a, b) =>
      new Date(b.occurredAt || b.createdAt).getTime() - new Date(a.occurredAt || a.createdAt).getTime()
  );
}

function resolvePendingAudioFailureStatus(message: string): string {
  const text = (message || '').trim();
  if (!text) return '原声已保留';
  if (/公网地址|PUBLIC_DOMAIN|PUBLIC_HOST|可访问的公网地址/i.test(text)) {
    return '本地暂不转写';
  }
  if (/没有转出可用文字|没有获取到文本/i.test(text)) {
    return '还没转出文字';
  }
  return '原声已保留';
}

function resolveSourceFailureStatus(params: {
  isAudio?: boolean;
  isVideo?: boolean;
  isImage?: boolean;
}): string {
  if (params.isAudio) return '原声已保留';
  if (params.isVideo) return '视频已保留';
  if (params.isImage) return '图片已保留';
  return '文件已保留';
}

function inferWechatCaptureSourceType(message: WechatCaptureMessage): SourceIngestType {
  if (message.msgType === 'voice') return 'audio';
  if (message.msgType === 'image') return 'image';
  if (message.reachChannel === 'video-link') return 'video';
  if (message.msgType === 'link') return 'document';
  return 'text';
}

function inferWechatCaptureRole(message: WechatCaptureMessage): SourceIngestRole {
  if (message.msgType === 'event') return 'support';
  return 'primary';
}

function inferWechatCaptureTitle(message: WechatCaptureMessage): string {
  if (message.title?.trim()) return compactText(message.title.trim(), 60);
  if (message.msgType === 'voice') return '微信语音';
  if (message.msgType === 'image') return '微信图片';
  if (message.msgType === 'link') return '微信链接';
  if (message.msgType === 'event') return '微信服务号';
  return '微信随手记';
}

function inferWorkspaceCaptureSourceType(item: WorkspaceCaptureMessage): SourceIngestType {
  if (item.contentType === 'audio') return 'audio';
  if (item.contentType === 'video') return 'video';
  if (item.contentType === 'image') return 'image';
  if (item.contentType === 'link' || item.contentType === 'document') return 'document';
  return 'text';
}

function inferWorkspaceCaptureRole(item: WorkspaceCaptureMessage): SourceIngestRole {
  if (item.sourceType === 'wechat') return 'primary';
  if (item.role === 'primary' || item.role === 'support') return item.role;
  return item.contentType === 'audio' ? 'primary' : 'support';
}

function resolveSourceItemSourceKey(item: SourceIngestItem): string | null {
  if (item.sourceKey?.trim()) return item.sourceKey.trim();
  if (item.id.startsWith('wechat-')) return `wechat:${item.id.replace('wechat-', '')}`;
  return null;
}

function buildWorkspaceCaptureSourceItem(item: WorkspaceCaptureMessage): SourceIngestItem {
  const type = inferWorkspaceCaptureSourceType(item);

  return {
    id: `workspace-${item.id}`,
    sourceKey: item.sourceKey,
    type,
    role: inferWorkspaceCaptureRole(item),
    title: item.title,
    preview: compactText(item.previewText || item.title, 180),
    previewUrl: type === 'image' ? item.mediaUrl || undefined : undefined,
    mediaUrl: type === 'audio' || type === 'video' ? item.mediaUrl || undefined : undefined,
    attachmentUrl: item.sourceUrl || undefined,
    segmentCount: 1,
    addedAt: item.occurredAt || item.createdAt,
    origin: 'user',
  };
}

function mergeWechatWorkspaceCapturesIntoSourceItems(
  previous: SourceIngestItem[],
  incoming: WorkspaceCaptureMessage[]
): SourceIngestItem[] {
  const wechatCaptures = incoming
    .filter((item) => item?.sourceType === 'wechat' && item.sourceKey)
    .sort(
      (a, b) =>
        new Date(a.occurredAt || a.createdAt).getTime() - new Date(b.occurredAt || b.createdAt).getTime()
    );

  if (wechatCaptures.length === 0) return previous;

  const existingIds = new Set(previous.map((item) => item.id));
  const existingSourceKeys = new Set(
    previous
      .map((item) => resolveSourceItemSourceKey(item))
      .filter((item): item is string => Boolean(item))
  );

  let changed = false;
  const next = [...previous];

  for (const item of wechatCaptures) {
    const id = `workspace-${item.id}`;
    if (existingIds.has(id) || existingSourceKeys.has(item.sourceKey)) continue;
    next.push(buildWorkspaceCaptureSourceItem(item));
    existingIds.add(id);
    existingSourceKeys.add(item.sourceKey);
    changed = true;
  }

  return changed ? next : previous;
}

async function readJsonApiResponse<T>(response: Response, errorPrefix: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const snippet = compactText(raw.replace(/\s+/g, ' ').trim(), 200);
    const _detail = snippet ? `：${snippet}` : '';
    throw new Error(`${errorPrefix}（接口返回非 JSON，HTTP ${response.status}）${_detail}`);
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

function buildTutorSupportContextText(
  supportReferences: SupportReferenceItem[],
  workspaceEchoes: WorkspaceEchoMessage[] = [],
  maxChars: number = 6500
): string {
  const references = (supportReferences || [])
    .map((item) => ({
      title: compactText(item.title, 80),
      snippet: compactText(item.snippet, 1400),
    }))
    .filter((item) => item.snippet.length > 0)
    .slice(0, 6);

  const echoes = (workspaceEchoes || [])
    .map((item) => ({
      title: compactText(item.title, 80),
      body: compactText(item.body, 220),
      chips: Array.isArray(item.chips) ? item.chips.filter(Boolean).slice(0, 3) : [],
    }))
    .filter((item) => item.body.length > 0)
    .slice(0, 4);

  if (references.length === 0 && echoes.length === 0) return '';

  const sections: string[] = [];

  if (references.length > 0) {
    const labeledReferences = references
      .map((item, index) => `[资料${index + 1}] 标题：${item.title}\n摘录：${item.snippet}`)
      .join('\n\n');

    sections.push(
      [
        '以下是用户主动加入的补充材料，请在回答时优先参考。',
        '如果引用了这些材料，请在对应句子后标注 [资料N]。',
        '如果材料与课堂转录冲突，请明确指出冲突。',
        '',
        labeledReferences,
      ].join('\n')
    );
  }

  if (echoes.length > 0) {
    const labeledEchoes = echoes
      .map((item, index) => {
        const chips = item.chips.length > 0 ? `\n标签：${item.chips.join(' / ')}` : '';
        return `[回声${index + 1}] 标题：${item.title}\n内容：${item.body}${chips}`;
      })
      .join('\n\n');

    sections.push(
      [
        '以下是系统基于近期学习上下文生成的回声，可用于理解用户最近更在意什么、卡在什么层次、适合怎样的解释方式。',
        '这些回声是理解线索，不是硬事实；不要生硬复述，要把它们用在更贴近用户状态的表达里。',
        '',
        labeledEchoes,
      ].join('\n')
    );
  }

  return compactMultilineText(sections.join('\n\n'), maxChars);
}

function buildTutorQuestionFromEcho(
  params: {
  title: string;
  body: string;
  chips?: string[];
},
  mode: 'explore' | 'review' = 'explore'
): string {
  const chipsLine = params.chips && params.chips.length > 0
    ? `\n我现在更想顺着这些线索展开：${params.chips.join('、')}`
    : '';

  if (mode === 'review') {
    return compactMultilineText(
      `基于这条回声，帮我把它整理成一份可执行的复习清单：\n${params.title}\n${params.body}${chipsLine}\n请按“先理解什么 / 先复习什么 / 接下来怎么练”来组织。`,
      320
    );
  }

  return compactMultilineText(
    `顺着这条回声继续带我学：\n${params.title}\n${params.body}${chipsLine}`,
    280
  );
}

function resolveEchoTimeBucket(createdAt: string): 'today' | 'week' | 'earlier' {
  const created = new Date(createdAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = now.getTime() - created.getTime();

  if (created.getTime() >= startOfToday) return 'today';
  if (diff <= 7 * 24 * 60 * 60 * 1000) return 'week';
  return 'earlier';
}

function getEchoBucketLabel(bucket: 'today' | 'week' | 'earlier'): string {
  if (bucket === 'today') return '今天';
  if (bucket === 'week') return '最近 7 天';
  return '更早';
}

function getSegmentBatchDurationMs(segments: TranscriptSegment[]): number {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  const startMs = segments[0]?.startMs || 0;
  const endMs = segments[segments.length - 1]?.endMs || 0;
  return Math.max(0, endMs - startMs);
}

async function getLocalMediaDurationMs(file: Blob): Promise<number> {
  if (typeof window === 'undefined') return 0;

  const objectUrl = URL.createObjectURL(file);
  const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
  element.preload = 'metadata';
  element.src = objectUrl;

  return await new Promise<number>((resolve) => {
    const cleanup = () => {
      element.removeAttribute('src');
      element.load();
      URL.revokeObjectURL(objectUrl);
    };

    const finalize = (durationSec: number) => {
      cleanup();
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        resolve(0);
        return;
      }
      resolve(Math.round(durationSec * 1000));
    };

    element.onloadedmetadata = () => finalize(element.duration);
    element.onerror = () => finalize(0);
    element.load();
  });
}

function formatVoiceDurationCompact(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}"`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`;
}

function getFileExtensionBadge(title: string): string | null {
  const index = title.lastIndexOf('.');
  if (index <= 0 || index >= title.length - 1) return null;
  return compactText(title.slice(index + 1).trim().toUpperCase(), 8) || null;
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
  forceMobilePreview = false,
  wechatCaptureToken = null,
}: {
  isGuestFastEntry: boolean;
  forcedWorkspaceTab: SharedWorkspaceTab | null;
  forceMobilePreview?: boolean;
  wechatCaptureToken?: string | null;
}) {
  // Performance: Guest mode skips splash entirely for instant entry.
  const [showSplash, setShowSplash] = useState(!isGuestFastEntry);
  const [appReady, setAppReady] = useState(isGuestFastEntry);
  const [loadingProgress, setLoadingProgress] = useState(isGuestFastEntry ? 100 : 0);
  
  const { user, isAuthenticated, accessToken } = useAuth();
  
  // NOTE: cleaned corrupted legacy comment.
  const { isMobile: detectedIsMobile, mounted } = useResponsive();
  const isMobile = detectedIsMobile || forceMobilePreview;
  const isDesktopMobilePreview = forceMobilePreview && !detectedIsMobile;
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
  const [sessionMediaDurationMs, setSessionMediaDurationMs] = useState(0);
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
  const [mobileCollectionSheet, setMobileCollectionSheet] = useState<MobileCollectionSheet>(null);
  const [showMobileRecorder, setShowMobileRecorder] = useState(false);
  const [collectionComposerText, setCollectionComposerText] = useState('');
  const [showCollectionPulsePreview, setShowCollectionPulsePreview] = useState(false);
  const [captureDrivenPulse, setCaptureDrivenPulse] = useState<CollectionPulseState | null>(null);
  const [workspaceCaptures, setWorkspaceCaptures] = useState<WorkspaceCaptureMessage[]>([]);
  const [workspaceEchoes, setWorkspaceEchoes] = useState<WorkspaceEchoMessage[]>([]);
  const [selectedEchoChip, setSelectedEchoChip] = useState<string>('全部');
  const collectionComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const [sourcePanelMode, setSourcePanelMode] = useState<'audio' | 'support'>('audio');
  const [sourceImportMode, setSourceImportMode] = useState<'files' | 'text'>('files');
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
  const [sourceTextInput, setSourceTextInput] = useState('');
  const [asrContextHint, setAsrContextHint] = useState('');
  const [sourceItems, setSourceItems] = useState<SourceIngestItem[]>([]);
  const [supportReferences, setSupportReferences] = useState<SupportReferenceItem[]>([]);
  const sourceImporting = activeSourceImportCount > 0;
  const tutorSupportContextText = useMemo(
    () => buildTutorSupportContextText(supportReferences, workspaceEchoes),
    [supportReferences, workspaceEchoes]
  );
  const hasCollectionContext = useMemo(
    () => segments.length > 0 || sourceItems.length > 0 || supportReferences.length > 0 || workspaceEchoes.length > 0,
    [segments.length, sourceItems.length, supportReferences.length, workspaceEchoes.length]
  );
  
  // NOTE: cleaned corrupted legacy comment.
  const [isActionDrawerOpen, setIsActionDrawerOpen] = useState(false);
  const [workshopWindows, setWorkshopWindows] = useState<FloatingWorkshopWindowState[]>([]);
  const workshopWindowZRef = useRef(20);
  
  // NOTE: cleaned corrupted legacy comment.
  const [showWelcome, setShowWelcome] = useState(false);
  const onboarding = useOnboarding({ isMobile });
  
  const liveSegmentsRef = useRef<TranscriptSegment[]>([]);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const lastCollectionPulseSignatureRef = useRef('');
  const importedWechatCaptureTokensRef = useRef(new Set<string>());
  const workspaceContextRequestKeyRef = useRef<string | null>(null);

  // Auto-extract terms from user-provided context (course topic + reference materials)
  const [extractedTermsHint, setExtractedTermsHint] = useState('');
  const extractTermsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce: wait 2s after last change before calling the API
    if (extractTermsTimerRef.current) {
      clearTimeout(extractTermsTimerRef.current);
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
            console.log('[App] Auto-extracted terms hint, length:', data.contextHint.length, 'terms:', data.terms?.length);
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
  }, [asrContextHint, supportReferences]);

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
  const previewObjectUrlsRef = useRef<string[]>([]);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<WaveformPlayerRef>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const pendingRecordedAudioRef = useRef<{
    itemId: string;
    sessionId: string;
    title: string;
    mediaUrl: string;
    durationMs: number;
    blob: Blob;
  } | null>(null);
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

  useEffect(() => {
    sourceItemsRef.current = sourceItems;
  }, [sourceItems]);

  useEffect(() => {
    supportReferencesRef.current = supportReferences;
  }, [supportReferences]);

  useEffect(() => {
    return () => {
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

  useEffect(() => {
    if (!onboarding.isActive || !onboarding.currentStep) return;

    const stepId = onboarding.currentStep.id;
    const isRecordFlowStep =
      stepId === 'record-button' ||
      stepId === 'video-import' ||
      stepId === 'support-source' ||
      stepId === 'mode-switch';
    const isDesktopWorkshopStep =
      !isMobile &&
      (stepId === 'review-apps-tab' || stepId === 'workshop-generate-all' || stepId === 'workshop-dock-toggle');

    if (isRecordFlowStep && viewMode !== 'record') {
      setViewMode('record');
      return;
    }

    if (isDesktopWorkshopStep) {
      if (viewMode !== 'review') {
        setViewMode('review');
        return;
      }
      if (videoSource) {
        if (videoWorkspaceTab !== 'apps') {
          setVideoWorkspaceTab('apps');
          return;
        }
      } else if (reviewTab !== 'apps') {
        setReviewTab('apps');
        return;
      }
    }

    if (stepId === 'timeline' && viewMode === 'review' && reviewTab !== 'timeline') {
      setReviewTab('timeline');
      return;
    }

    if (stepId === 'ai-tutor' && showConversationHistory) {
      setShowConversationHistory(false);
      setSelectedHistoryConversation(null);
      return;
    }

    if (stepId === 'action-list' && !isActionDrawerOpen) {
      setIsActionDrawerOpen(true);
      return;
    }

    if (isMobile && stepId === 'ai-fab' && mobileSubPage) {
      setMobileSubPage(null);
      return;
    }

    if (isMobile && stepId === 'menu-button-workshop' && isMenuOpen) {
      setIsMenuOpen(false);
      return;
    }

    if (isMobile && stepId === 'menu-apps-item' && !isMenuOpen) {
      setIsMenuOpen(true);
      return;
    }

    if (isMobile && stepId === 'mobile-workshop-panel') {
      if (isMenuOpen) {
        setIsMenuOpen(false);
        return;
      }
      if (mobileSubPage !== 'apps') {
        setMobileSubPage('apps');
        return;
      }
    }

    if (isMobile && stepId === 'menu-button' && isMenuOpen) {
      setIsMenuOpen(false);
    }
  }, [
    onboarding.isActive,
    onboarding.currentStep,
    viewMode,
    reviewTab,
    videoSource,
    videoWorkspaceTab,
    showConversationHistory,
    isActionDrawerOpen,
    isMobile,
    mobileSubPage,
    isMenuOpen,
  ]);
  
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
    setSessionMediaDurationMs(session.duration || 0);

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

      const [, rawSavedAppState, savedOnboardingState] = await Promise.all([
        checkServices().then(setServiceStatus),
        getPersistedAppState(),
        getPreference<{ completedFlows?: string[]; skippedFlows?: string[] } | null>('onboarding_state', null).catch(() => null),
      ]);

      setLoadingProgress(40);

      const isFirstVisit = !savedOnboardingState ||
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

      setLoadingProgress(50);

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

      if (!forceMobilePreview && isFirstVisit && !savedAppState) {
        setTimeout(() => setShowWelcome(true), 800);
      }
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
  const hasTriggeredWelcome = useRef(false);
  useEffect(() => {
    if (
      !forceMobilePreview &&
      !isGuestFastEntry &&
      !onboarding.isLoading &&
      appReady &&
      !showSplash &&
      !hasTriggeredWelcome.current &&
      onboarding.shouldShowFlow('welcome')
    ) {
      hasTriggeredWelcome.current = true;
      setShowWelcome(true);
    }
  }, [forceMobilePreview, isGuestFastEntry, onboarding, appReady, showSplash]);

  // NOTE: cleaned corrupted legacy comment.
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

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
        echo?: WorkspaceEchoMessage;
        error?: string;
      }>(response, '写入工作区收集失败');

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '写入工作区收集失败');
      }

      if (payload.capture) {
        setWorkspaceCaptures((prev) => mergeWorkspaceCaptures(prev, [payload.capture!]));
      }

      const echo = payload.echo;
      if (echo) {
        setWorkspaceEchoes((prev) => mergeWorkspaceEchoes(prev, [echo]));
        setCaptureDrivenPulse({
          title: echo.title,
          body: echo.body,
          chips: (echo.chips || []).slice(0, 3),
          actions: params.role === 'primary'
            ? [
                { key: 'capture-confusion', label: '补一句困惑' },
                { key: 'add-material', label: '贴一份材料' },
              ]
            : [
                { key: 'continue-voice', label: '再录一段' },
                { key: 'capture-confusion', label: '写一句想法' },
              ],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[workspace.capture]', message);
    }
  }, [accessToken, isAuthenticated, user?.id]);

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
    setSourceTextInput('');
    setSourceImportMode('files');
    setSourcePanelMode('audio');
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

  const handleRecordingStop = useCallback((blob?: Blob, meta?: { sessionId?: string; isContinuation?: boolean; durationMs?: number }) => {
    setIsRecording(false);
    setShowMobileRecorder(false);
    if (blob) setAudioBlob(blob);
    
    // NOTE: cleaned corrupted legacy comment.
    const currentSegments = liveSegmentsRef.current.length > 0 
      ? liveSegmentsRef.current 
      : segments;
    
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
      setSourceItems((prev) => [
        ...prev,
        {
          id: audioCaptureId,
          type: 'audio',
          role: 'primary',
          title: `录音 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
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
          title: `录音 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
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
        pendingRecordedAudioRef.current = {
          itemId: audioCaptureId,
          sessionId: effectiveSessionId,
          title: `录音 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
          mediaUrl: liveMediaUrl,
          durationMs: duration,
          blob,
        };
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
  }, [anchors, persistCaptureToWorkspace, segments, sessionId, user]);

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
    setShowSessionHistory(false);
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
        
        // NOTE: cleaned corrupted legacy comment.
        // NOTE: cleaned corrupted legacy comment.
        if (!isGuestFastEntry && !onboarding.isActive && onboarding.shouldShowFlow('review')) {
          setTimeout(() => onboarding.startFlow('review'), 500);
        }
      } catch (err) {
        console.error('Failed to load demo data:', err);
      }
    } else if (newMode === 'review' && (segments.length > 0 || hasCollectionContext)) {
      // Enter review onboarding when data already exists.
      if (!isGuestFastEntry && !onboarding.isActive && onboarding.shouldShowFlow('review')) {
        setTimeout(() => onboarding.startFlow('review'), 300);
      }
    }
  }, [hasCollectionContext, segments.length, sessionId, onboarding, isGuestFastEntry]);

  const openReviewFromCollection = useCallback(async (item?: SourceIngestItem | null) => {
    if (!item) return;
    setMobileCollectionSheet(null);
    setShowMobileRecorder(false);
    setShowCollectionPulsePreview(false);

    if (item.sessionId && item.sessionId !== sessionId && item.reviewable) {
      try {
        const restored = await restoreReviewSession(item.sessionId, {
          reviewTab: 'timeline',
          videoWorkspaceTab: item.type === 'video' ? 'chat' : 'chat',
          currentTime: 0,
          showTranscriptBar: false,
        });
        if (restored) {
          return;
        }
      } catch (error) {
        console.error('从收集流进入复习失败:', error);
      }
    }

    if (item.type === 'audio') {
      if (!audioBlob && item.mediaUrl) {
        setAudioUrl(item.mediaUrl);
      }
      if (item.durationMs) {
        setSessionMediaDurationMs(item.durationMs);
      }
    }

    await handleViewModeChange('review');
    setReviewTab('timeline');
    setVideoWorkspaceTab(item.type === 'video' ? 'chat' : 'chat');
  }, [audioBlob, handleViewModeChange, restoreReviewSession, sessionId]);

  useEffect(() => {
    if (isGuestFastEntry) return;
    if (viewMode !== 'review' || !videoSource) return;
    if (onboarding.isActive || !onboarding.shouldShowFlow('video-review')) return;
    const timer = setTimeout(() => onboarding.startFlow('video-review'), 300);
    return () => clearTimeout(timer);
  }, [viewMode, videoSource, onboarding, isGuestFastEntry]);

  useEffect(() => {
    if (isGuestFastEntry) return;
    if (onboarding.isActive || !onboarding.shouldShowFlow('workshop')) return;

    const inDesktopWorkshop = !isMobile &&
      viewMode === 'review' &&
      ((videoSource && videoWorkspaceTab === 'apps') || (!videoSource && reviewTab === 'apps'));
    const inMobileWorkshop = isMobile && mobileSubPage === 'apps';

    if (!inDesktopWorkshop && !inMobileWorkshop) return;

    const timer = setTimeout(() => onboarding.startFlow('workshop'), 300);
    return () => clearTimeout(timer);
  }, [isMobile, mobileSubPage, onboarding, reviewTab, videoSource, videoWorkspaceTab, viewMode, isGuestFastEntry]);

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
      setSourceImportError('这条历史暂时还没打开，请稍后再试。');
    }
  }, [restoreReviewSession]);

  const handleOpenWorkspaceCaptureReview = useCallback(async (capture: WorkspaceCaptureMessage) => {
    const sessionIdFromCapture =
      capture.metadata && typeof capture.metadata.sessionId === 'string'
        ? capture.metadata.sessionId
        : null;

    if (!sessionIdFromCapture) return;

    setMobileCollectionSheet(null);
    setShowSessionHistory(false);
    setShowMobileRecorder(false);
    setShowCollectionPulsePreview(false);

    try {
      const restored = await restoreReviewSession(sessionIdFromCapture, {
        reviewTab: 'timeline',
        videoWorkspaceTab: capture.contentType === 'video' ? 'chat' : 'chat',
        currentTime: 0,
        showTranscriptBar: false,
      });
      if (restored) return;
    } catch (error) {
      console.error('从工作区收集进入复习失败:', error);
    }
  }, [restoreReviewSession]);

  const handleTranscriptUpdate = useCallback((newSegments: TranscriptSegment[]) => {
    liveSegmentsRef.current = newSegments;
    setSegments(newSegments);
    setDataSource('live');
    setVideoSource(null);
    const pendingAudio = pendingRecordedAudioRef.current;
    if (pendingAudio) {
      const previewText = buildSourcePreviewText(newSegments, 180);
      const currentUserId = user?.id || ANONYMOUS_USER_ID;
      void addTranscripts(pendingAudio.sessionId, currentUserId, newSegments.map((seg) => ({
        text: seg.text,
        startMs: seg.startMs,
        endMs: seg.endMs,
        confidence: seg.confidence || 1.0,
        isFinal: true,
      }))).catch((err) => console.error('Failed to persist batch transcript to IndexedDB:', err));
      setSessionMediaDurationMs((prev) => Math.max(prev, pendingAudio.durationMs));
      setSourceItems((prev) =>
        prev.map((item) =>
          item.id === pendingAudio.itemId
            ? {
                ...item,
                preview: previewText,
                fullText: buildSupportReferenceSnippet(newSegments, 2800),
                segmentCount: newSegments.length,
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
        normalizedText: buildSupportReferenceSnippet(newSegments, 2800),
        tutorContext: buildSupportReferenceSnippet(newSegments, 2800),
        mediaUrl: pendingAudio.mediaUrl,
        occurredAt: new Date().toISOString(),
        metadata: {
          from: 'live-recording',
          sessionId: pendingAudio.sessionId,
          duration: pendingAudio.durationMs,
          segmentCount: newSegments.length,
        },
      });
      pendingRecordedAudioRef.current = null;
    }
  }, [persistCaptureToWorkspace, user?.id]);

  const handleRecordingTranscriptionError = useCallback((message: string) => {
    const pendingAudio = pendingRecordedAudioRef.current;
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

    pendingRecordedAudioRef.current = null;
  }, []);

  // 接收转写增强结果，并更新当前课堂内容
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
      console.log('[生成精选片段] 开始，模式:', mode, '片段数:', segments.length);
      await generateTopics(mode);
      console.log('[生成精选片段] 完成');
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

  // 閹绢厽鏂侀崗銊╁劥閻楀洦顔?
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

  const removeSupportSource = useCallback((id: string) => {
    setSourceItems((prev) => prev.filter((item) => !(item.id === id && item.role === 'support')));
    setSupportReferences((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const ingestTranscriptSegments = useCallback(async (params: {
    segments: TranscriptSegment[];
    sourceType: SourceIngestType;
    sourceTitle: string;
    audioBlob?: Blob;
    mediaUrl?: string;
    mediaDurationMs?: number;
    videoSource?: ImportedVideoSource;
    sourceItemId?: string;
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
    setShowSessionHistory(false);
    setSourceImportError('');

    if (params.sourceItemId) {
      updateSourceItem(sourceItemId, {
        type: params.sourceType,
        role: 'primary',
        title: params.sourceTitle,
        preview: buildSourcePreviewText(normalizedSegments, 180),
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
        type: params.sourceType,
        role: 'primary',
        title: params.sourceTitle,
        preview: buildSourcePreviewText(normalizedSegments, 180),
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
          sourceType: 'upload',
          mediaUrl: params.mediaUrl,
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

  const parseImageFile = useCallback(async (file: File): Promise<{
    title: string;
    fileType: string;
    segments: TranscriptSegment[];
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/sources/ingest-image', {
      method: 'POST',
      body: formData,
    });
    const payload = await readJsonApiResponse<{
      success?: boolean;
      error?: string;
      title?: string;
      fileType?: string;
      segments?: TranscriptSegment[];
    }>(response, '图片解析失败');
    if (!response.ok || !payload.success || !Array.isArray(payload.segments)) {
      throw new Error(payload.error || '图片解析失败');
    }
    return {
      title: payload.title || file.name,
      fileType: payload.fileType || 'image',
      segments: payload.segments,
    };
  }, []);

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
              type: 'document',
              title: parsed.title,
              segments: parsed.segments,
              appendItem: false,
            });
            updateSourceItem(id, {
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
              type: supportType,
              title: parsed.title,
              segments: parsed.segments,
              appendItem: false,
            });
            updateSourceItem(id, {
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
    parseImageFile,
    parseDocumentFile,
    persistCaptureToWorkspace,
    supportReferences,
    transcribeAudioFile,
    updateSourceItem,
  ]);

  const handleSourceFileButtonClick = useCallback((mode: 'audio' | 'support' | 'all' = 'all') => {
    setSourceImportError('');
    setSourceFilePickerMode(mode);
    setShowSessionHistory(false);
    setShowMobileRecorder(false);
    setMobileCollectionSheet(null);

    // Unified picker is the new default for the chat-style collection flow.
    // Keep legacy panel switching only for the old desktop import surfaces.
    if (mode !== 'all') {
      setDataSource('demo');
      setSourcePanelMode(mode === 'audio' ? 'audio' : 'support');
      setSourceImportMode('files');
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

  const handleSourceFileDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      setSourceFilePickerMode('all');
      setShowSessionHistory(false);
      setShowMobileRecorder(false);
      setMobileCollectionSheet(null);
      void handleImportFiles(files, 'all');
    }
  }, [handleImportFiles]);

  const handleImportTextSource = useCallback(async () => {
    const text = sourceTextInput.trim();
    if (!text) {
      setSourceImportError('先贴一段文字再发。');
      collectionComposerRef.current?.focus();
      return;
    }

    setActiveSourceImportCount((count) => count + 1);
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

      const importId = `pasted-text-${Date.now()}`;
      const importTitle = payload.title || '粘贴文本';
      const appended = appendSupportSource({
        id: importId,
        type: 'text',
        title: importTitle,
        segments: payload.segments,
      });
      void persistCaptureToWorkspace({
        sourceType: 'manual-import',
        sourceKey: `import:${importId}`,
        role: 'support',
        contentType: 'text',
        title: importTitle,
        previewText: buildSourcePreviewText(payload.segments, 180),
        normalizedText: appended.reference || text,
        tutorContext: appended.reference || text,
        occurredAt: new Date().toISOString(),
        metadata: {
          from: 'text-import',
        },
      });
      setSourceTextInput('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSourceImportError(message);
    } finally {
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
    }
  }, [appendSupportSource, persistCaptureToWorkspace, sourceTextInput]);

  const sourceFileAccept =
    sourceFilePickerMode === 'audio'
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

  const composerCanAutoImportLink = composerReach.channel === 'video-link' && composerReach.shouldAutoIngest;

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

  const appendToCollectionComposer = useCallback((incomingText: string) => {
    const normalized = incomingText.replace(/\s+/g, ' ').trim();
    if (!normalized) return;

    setCollectionComposerText((previous) => {
      const base = previous.trimEnd();
      if (!base) return normalized;
      const joiner = /[。！？.!?；;，,：:]$/.test(base) ? '' : ' ';
      return `${base}${joiner}${normalized}`;
    });

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        const textarea = collectionComposerRef.current;
        if (!textarea) return;
        textarea.focus();
        const length = textarea.value.length;
        textarea.setSelectionRange(length, length);
      });
    }
  }, []);

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
    collectionComposerRef.current?.focus();
    await toggleComposerVoiceInput();
  }, [isRecording, showMobileRecorder, toggleComposerVoiceInput]);

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

        setSourceItems((prev) => {
          if (prev.some((item) => item.id === sourceItemId)) return prev;
          return [
            ...prev,
            {
              id: sourceItemId,
              sourceKey: `wechat:${message.linkToken}`,
              type: sourceType,
              role,
              title,
              preview,
              previewUrl: sourceType === 'image' ? message.mediaUrl || undefined : undefined,
              mediaUrl: sourceType === 'audio' || sourceType === 'video' ? message.mediaUrl || undefined : undefined,
              attachmentUrl: message.sourceUrl || undefined,
              segmentCount: 1,
              addedAt,
              origin: 'user',
            },
          ];
        });

        const tutorSnippet = (message.tutorContext || message.normalizedText || '').trim();
        if (tutorSnippet) {
          setSupportReferences((prev) => mergeSupportReferences(prev, [{
            id: sourceItemId,
            title,
            snippet: compactText(tutorSnippet, 2800),
          }]));
        }

        const messageEchoTitle = message.echoTitle;
        const messageEchoBody = message.echoBody;
      if (messageEchoTitle && messageEchoBody) {
          setWorkspaceEchoes((prev) => mergeWorkspaceEchoes(prev, [{
            id: `wechat-echo-${message.linkToken}`,
            sourceKey: `wechat:${message.linkToken}`,
            title: messageEchoTitle,
            body: messageEchoBody,
            chips: Array.isArray(message.echoChips) ? message.echoChips.filter(Boolean).slice(0, 4) : [],
            createdAt: addedAt,
          }]));
          setCaptureDrivenPulse({
            title: messageEchoTitle,
            body: messageEchoBody,
            chips: Array.isArray(message.echoChips) ? message.echoChips.filter(Boolean).slice(0, 3) : [],
            actions: role === 'primary'
              ? [
                  { key: 'capture-confusion', label: '补一句困惑' },
                  { key: 'add-material', label: '贴一份材料' },
                ]
              : [
                  { key: 'continue-voice', label: '再录一段' },
                  { key: 'capture-confusion', label: '写一句想法' },
                ],
          });
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
  }, [wechatCaptureToken]);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || !accessToken) return;

    const requestKey = `${user.id}:${wechatCaptureToken || ''}`;
    if (workspaceContextRequestKeyRef.current === requestKey) return;

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/workspace/current', {
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

            for (const item of captures) {
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

          const incomingReferences = captures
            .map((item) => {
              const snippet = (item.tutorContext || item.normalizedText || '').trim();
              if (!snippet) return null;
              return {
                id: `workspace-${item.id}`,
                title: item.title,
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
          const latestEcho = echoes[0];
          setCaptureDrivenPulse((current) => current ?? {
            title: latestEcho.title,
            body: latestEcho.body,
            chips: (latestEcho.chips || []).slice(0, 3),
            actions: [
              { key: 'continue-voice', label: '再录一段' },
              { key: 'capture-confusion', label: '写一句想法' },
            ],
          });
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

    setSourceItems((prev) => mergeWechatWorkspaceCapturesIntoSourceItems(prev, workspaceCaptures));
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

  const groupedWorkspaceEchoes = useMemo(() => {
    const groups: Record<'today' | 'week' | 'earlier', WorkspaceEchoMessage[]> = {
      today: [],
      week: [],
      earlier: [],
    };

    filteredWorkspaceEchoes.forEach((echo) => {
      groups[resolveEchoTimeBucket(echo.createdAt)].push(echo);
    });

    return groups;
  }, [filteredWorkspaceEchoes]);

  const echoHistorySections = useMemo(
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

  const latestEchoForCenter = useMemo(() => {
    if (collectionPulse) {
      return {
        title: collectionPulse.title,
        body: collectionPulse.body,
        chips: collectionPulse.chips,
      };
    }

    if (workspaceEchoes.length === 0) return null;

    const latest = workspaceEchoes[0];
    return {
      title: latest.title,
      body: latest.body,
      chips: latest.chips,
    };
  }, [collectionPulse, workspaceEchoes]);

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

  const importComposerVideoLink = useCallback(async (url: string) => {
    const detected = parseVideoLink(url);
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
        throw new Error('链接已识别，但暂时没有解析出内容。');
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
      });

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSourceImportError(message);
    } finally {
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
    }
  }, [handleVideoImportReady]);

  const openLiveRecorder = useCallback(() => {
    if (isRecording) return;

    if (isComposerVoiceRecording) {
      void stopComposerVoiceInput();
    }

    setSourceImportError('');
    setMobileCollectionSheet(null);
    setRecorderAutoStartSignal(0);
    flushSync(() => {
      setShowSessionHistory(false);
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
        },
      });
    }

    setCollectionComposerText('');
    setSourceImportError('');

    if (canAutoImportLink && inlineUrl) {
      void importComposerVideoLink(inlineUrl);
      return;
    }
  }, [
    appendSupportSource,
    collectionComposerText,
    composerCanAutoImportLink,
    composerDetectedUrl,
    importComposerVideoLink,
    persistCaptureToWorkspace,
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

  const openTutorFromCollection = useCallback((initialPrompt?: string) => {
    setMobileCollectionSheet(null);
    setShowCollectionPulsePreview(false);
    setShowConversationHistory(false);
    setSelectedHistoryConversation(null);
    setShowMobileRecorder(false);
    setShowSessionHistory(false);
    setSelectedAnchor(null);
    setMobileAIQuestion(initialPrompt || '');
    setViewMode('review');
    if (videoSource) {
      setVideoWorkspaceTab('chat');
    }
    if (isMobile) {
      setMobileSubPage('ai-chat');
    }
  }, [isMobile, videoSource]);

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

  const renderMobileTopBar = useCallback(
    (menuOnboarding?: string) => {
      const topBarStatus = isRecording
        ? '正在收一段原声'
        : activeSourceImportCount > 0
          ? `正在收进 ${activeSourceImportCount} 个文件`
          : '';

      return (
        <div
          className="flex-shrink-0 border-b border-[#e5e5e5] bg-[#ededed]/98 px-3 pb-2 pt-[max(env(safe-area-inset-top),9px)] backdrop-blur-xl"
        >
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setShowMobileRecorder(false);
                setMobileCollectionSheet('more');
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm"
              aria-label="打开收集菜单"
              data-onboarding={menuOnboarding}
            >
              <Menu size={18} />
            </button>
            <div className="min-w-0 flex-1 text-center">
              <p className="truncate text-[17px] font-semibold text-slate-900">收集</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMobileRecorder(false);
                setMobileCollectionSheet('history');
              }}
              className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm"
              aria-label="打开历史收集"
            >
              <History size={17} />
            </button>
          </div>
          {topBarStatus ? (
            <div className="mx-auto mt-2 w-full max-w-md">
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#07c160]" />
                <span>{topBarStatus}</span>
              </div>
            </div>
          ) : null}
        </div>
      );
    },
    [activeSourceImportCount, isRecording]
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
    const scrollPadding = desktopShell ? 28 : 18;
    const composerRows = desktopShell ? (collectionComposerText.trim() ? 4 : 3) : (collectionComposerText.trim() ? 3 : 2);

    return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
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
        className={desktopShell ? 'flex-1 overflow-y-auto px-6 pt-6' : 'flex-1 overflow-y-auto px-4 pt-3'}
        style={{ paddingBottom: `${scrollPadding}px` }}
      >
        <div className={`mx-auto flex w-full ${shellWidthClass} flex-col gap-3`}>
          {collectionFeedItems.length > 0 ? (
            <div className="flex items-center justify-center">
              <div className="rounded-full bg-slate-100/90 px-3 py-1 text-[11px] font-medium text-slate-400">
                今天
              </div>
            </div>
          ) : null}

          {collectionFeedItems.length === 0 ? (
            <div className="flex justify-start">
              <div className="w-full max-w-[92%] rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-[11px] text-slate-400">
                  {new Date().toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="mt-2 text-sm leading-7 text-slate-700">
                  今天先收一点：一句困惑、一张图、一份讲义或一段原声都行。先发进来，后面再接着学。
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {showMobileRecorder ? (
                <div className="flex justify-end">
                  <div className={`${messageBubbleWidthClass} rounded-[22px] rounded-br-[8px] border border-[#b8e7a6] bg-[#d9fdd3] px-4 py-3 shadow-sm`}>
                    <div className="flex justify-end">
                      <div className="inline-flex items-center gap-3 rounded-full bg-white/72 px-3 py-2 text-[#2f6f1f]">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#07c160] text-white">
                          <Mic size={14} />
                        </span>
                        <span className="flex items-end gap-[3px] text-[#62a542]">
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
                    <div className="mt-2 flex items-center justify-end text-[11px] text-[#5b7f49]">
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

                const bubbleText = item.preview?.trim() || item.title;
                const audioProgress =
                  audioPlaybackState?.id === item.id
                    ? Math.max(0, Math.min(1, audioPlaybackState.progress))
                    : 0;
                const isAudioPlaying = playingAudioMessageId === item.id;
                const isAudioTranscriptOpen = expandedAudioTranscriptId === item.id;
                const fileExtensionBadge = getFileExtensionBadge(item.title);
                const canOpenReview = Boolean(item.reviewable && item.sessionId && item.status !== 'failed');
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

                return (
                  <div key={item.id} className={`flex ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                    <div className={`${messageBubbleWidthClass} ${isPrimary ? '' : 'pl-8'}`}>
                      <div
                        className={`rounded-[24px] border px-4 py-3 shadow-sm ${
                          isPrimary
                            ? 'rounded-br-[8px] border-[#b8e7a6] bg-[#d9fdd3]'
                            : 'rounded-bl-[8px] border-slate-200 bg-white'
                        }`}
                      >
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
                                    ? 'bg-white/72 text-[#2f6f1f]'
                                    : 'bg-slate-100 text-slate-700'
                                } disabled:cursor-default disabled:opacity-80`}
                              >
                                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${
                                  isPrimary ? 'bg-[#07c160] text-white' : 'bg-white text-slate-500'
                                }`}>
                                  {isAudioPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                                </span>
                                <span className="relative flex h-5 w-[88px] items-center">
                                  <span
                                    className={`absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full ${
                                      isPrimary ? 'bg-[#c5ebb7]' : 'bg-slate-200'
                                    }`}
                                    style={{ width: '100%' }}
                                  />
                                  <span
                                    className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[#07c160] transition-all"
                                    style={{ width: `${Math.max(8, audioProgress * 100)}%` }}
                                  />
                                  <span className="relative z-10 flex w-full items-end justify-between px-1">
                                    {[8, 12, 16, 11, 15, 9, 13, 10].map((height, index) => (
                                      <span
                                        key={`${item.id}-wave-${index}`}
                                        className={`w-[3px] rounded-full ${
                                          isPrimary ? 'bg-[#5fa73d]' : 'bg-slate-400'
                                        }`}
                                        style={{ height: `${height}px`, opacity: index / 8 < audioProgress ? 0.95 : 0.45 }}
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
                              isPrimary ? 'justify-end text-[#4f7a36]' : 'justify-start text-slate-500'
                            }`}>
                              {showAudioStatusText ? (
                                <span className="font-medium">{item.statusText}</span>
                              ) : null}
                              {item.segmentCount > 0 && item.preview?.trim() ? (
                                <>
                                  {showAudioStatusText ? (
                                    <span aria-hidden="true" className="opacity-40">·</span>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedAudioTranscriptId((prev) => (prev === item.id ? null : item.id))
                                    }
                                    className={`font-medium transition ${
                                      isPrimary ? 'text-[#2f6f1f] hover:text-[#245818]' : 'text-slate-600 hover:text-slate-800'
                                    }`}
                                  >
                                    {isAudioTranscriptOpen ? '收起文字' : '看文字'}
                                  </button>
                                </>
                              ) : null}
                              {canOpenReview ? (
                                <>
                                  {showAudioStatusText || (item.segmentCount > 0 && item.preview?.trim()) ? (
                                    <span aria-hidden="true" className="opacity-40">·</span>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void openReviewFromCollection(item);
                                    }}
                                    className={`font-medium transition ${
                                      isPrimary ? 'text-[#2f6f1f] hover:text-[#245818]' : 'text-slate-600 hover:text-slate-800'
                                    }`}
                                  >
                                    去复习
                                  </button>
                                </>
                              ) : null}
                            </div>
                            {isAudioTranscriptOpen && item.segmentCount > 0 && item.preview?.trim() ? (
                              <div className={`rounded-[16px] px-3 py-2 text-sm leading-6 ${
                                isPrimary ? 'bg-white/65 text-slate-900' : 'bg-slate-50 text-slate-700'
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
                                  isPrimary ? 'bg-white/70 text-[#8b5cf6]' : 'bg-slate-100 text-slate-500'
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
                                className={`block rounded-[18px] border px-3 py-2.5 transition ${
                                  isPrimary
                                    ? 'border-white/70 bg-white/62 hover:bg-white/75'
                                    : 'border-slate-200 bg-slate-50 hover:bg-white'
                                }`}
                              >
                                <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                                    isPrimary ? 'bg-white text-[#2563eb]' : 'bg-white text-slate-500'
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
                            <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                              isPrimary ? 'justify-end text-[#4f7a36]' : 'justify-start text-slate-500'
                            }`}>
                              {canOpenReview ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void openReviewFromCollection(item);
                                  }}
                                  className={`font-medium transition ${
                                    isPrimary ? 'text-[#2f6f1f] hover:text-[#245818]' : 'text-slate-600 hover:text-slate-800'
                                  }`}
                                >
                                  去复习
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : item.type === 'video' ? (
                          <div className="space-y-2">
                            {item.mediaUrl ? (
                              <a
                                href={item.mediaUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={`block overflow-hidden rounded-[18px] transition ${
                                  isPrimary ? 'bg-[#1f2937] hover:bg-[#111827]' : 'bg-slate-900 hover:bg-slate-800'
                                }`}
                              >
                                <div className="flex min-h-[140px] items-center justify-center px-4 py-6">
                                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-900 shadow-sm">
                                    <Play size={18} className="ml-0.5" />
                                  </span>
                                </div>
                                <div className="border-t border-white/10 bg-black/18 px-3 py-2.5 text-white">
                                  <p className="truncate text-sm font-medium">
                                    {item.title}
                                  </p>
                                  {item.durationMs ? (
                                    <p className="mt-0.5 text-[11px] text-white/70">
                                      {formatVoiceDurationCompact(item.durationMs)}
                                    </p>
                                  ) : null}
                                </div>
                              </a>
                            ) : (
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
                            )}
                            <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                              isPrimary ? 'justify-end text-white/75' : 'justify-start text-slate-500'
                            }`}>
                              {showVideoStatusText ? (
                                <span className="font-medium">{item.statusText}</span>
                              ) : null}
                              {showVideoStatusText && canOpenReview ? (
                                <span aria-hidden="true" className="opacity-40">·</span>
                              ) : null}
                              {canOpenReview ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    void openReviewFromCollection(item);
                                  }}
                                  className={`font-medium transition ${
                                    isPrimary ? 'text-white hover:text-white/80' : 'text-slate-600 hover:text-slate-800'
                                  }`}
                                >
                                  去复习
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm leading-6 text-slate-900">{bubbleText}</p>
                        )}
                        <div className={`mt-2 flex items-center ${isPrimary ? 'justify-end' : 'justify-start'} gap-2 text-[11px] text-slate-400`}>
                          <span>{formatRelativeCollectionTime(item.addedAt)}</span>
                          {showInlineStatus ? (
                            <span className={`rounded-full px-2 py-0.5 ${statusTone}`}>
                              {item.statusText || typeLabel}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {mobileCollectionSheet === 'more' ? (
        <>
          <button
            type="button"
            aria-label="关闭收集菜单"
            onClick={() => {
              setMobileCollectionSheet(null);
              setShowSessionHistory(false);
            }}
            className={`${backdropPositionClass} z-20 bg-slate-900/18 backdrop-blur-[1px]`}
          />
        <div
          className={`${collectionChromeContained ? 'absolute inset-y-0 left-0' : 'fixed inset-y-0 left-0'} z-30 w-[86vw] max-w-[360px]`}
        >
          <div className="flex h-full flex-col overflow-hidden rounded-r-[28px] border-r border-slate-200 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.16)]">
            <div className="border-b border-slate-100 px-5 pb-4 pt-[max(env(safe-area-inset-top),20px)]">
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
                      setShowSessionHistory(false);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"
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
                  <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm">
                    <Sparkles size={16} />
                    {showCollectionPulsePreview && collectionPulse ? (
                      <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full bg-[#07c160]" />
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">回声</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">
                      {latestEchoForCenter ? '晚点再看系统听到了什么。' : '先继续收，线索会慢慢沉下来。'}
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
              setShowSessionHistory(false);
            }}
            className={`${backdropPositionClass} z-20 bg-slate-900/18 backdrop-blur-[1px]`}
          />
          <div
            className={`${collectionChromeContained ? 'absolute inset-x-0' : 'fixed inset-x-0'} z-30 ${dockPaddingClass}`}
            style={{ bottom: `${sheetBottomOffset}px` }}
          >
            <div className={`mx-auto w-full ${sheetWidthClass} overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_48px_rgba(15,23,42,0.16)]`}>
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {mobileCollectionSheet === 'echo'
                      ? '回声中心'
                      : mobileCollectionSheet === 'history'
                        ? '历史收集'
                        : '收集菜单'}
                  </p>
                  {mobileCollectionSheet === 'echo' ? (
                    <p className="text-xs text-slate-500">回头再看，不打断你现在发消息。</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileCollectionSheet(null);
                    setShowSessionHistory(false);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500"
                >
                  <X size={16} />
                </button>
              </div>

              {mobileCollectionSheet === 'echo' ? (
                <div className="space-y-3 p-4">
                  {latestEchoForCenter ? (
                    <div className="rounded-[24px] border border-emerald-100 bg-[linear-gradient(145deg,#ffffff_0%,#effcf6_100%)] px-4 py-4 shadow-sm">
                      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-emerald-700">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                          <Sparkles size={13} />
                        </span>
                        <span>最新回声</span>
                      </div>
                      <p className="mb-1 text-sm font-semibold leading-6 text-slate-900">{latestEchoForCenter.title}</p>
                      <p className="text-sm leading-7 text-slate-900">{latestEchoForCenter.body}</p>
                      {latestEchoForCenter.chips.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {latestEchoForCenter.chips.map((chip) => (
                            <span
                              key={chip}
                              className="rounded-full border border-emerald-100 bg-white px-3 py-1 text-[11px] font-medium text-emerald-700"
                            >
                              {chip}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openTutorFromCollection(buildTutorQuestionFromEcho(latestEchoForCenter, 'explore'))}
                          className="rounded-full border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50"
                        >
                          问问 Tutor
                        </button>
                        <button
                          type="button"
                          onClick={() => openTutorFromCollection(buildTutorQuestionFromEcho(latestEchoForCenter, 'review'))}
                          className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                        >
                          做成复习清单
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/80 px-4 py-5 text-sm leading-7 text-slate-500 shadow-sm">
                      先继续收集，系统听到的线索会慢慢沉到这里。
                    </div>
                  )}

                  {workspaceEchoes.length > 0 ? (
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold tracking-[0.06em] text-slate-500">回声历史</p>
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-500">
                          {workspaceEchoes.length} 条
                        </span>
                      </div>

                      {echoFilterOptions.length > 1 ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {echoFilterOptions.map((chip) => (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => setSelectedEchoChip(chip)}
                              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                                selectedEchoChip === chip
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-slate-200 bg-white text-slate-500'
                              }`}
                            >
                              {chip}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {echoHistorySections.length > 0 ? (
                        <div className="space-y-4">
                          {echoHistorySections.map((section) => (
                            <div key={section.key} className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-500">
                                  {section.label}
                                </span>
                                <span className="text-[11px] text-slate-400">{section.items.length} 条</span>
                              </div>
                              {section.items.map((echo) => (
                                <div
                                  key={echo.id}
                                  className="rounded-[18px] border border-slate-200 bg-white px-3 py-3"
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-semibold text-slate-900">{echo.title}</p>
                                    <span className="text-[11px] text-slate-400">
                                      {formatRelativeCollectionTime(echo.createdAt)}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm leading-6 text-slate-600">{echo.body}</p>
                                  {echo.chips.length > 0 ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {echo.chips.map((chip) => (
                                        <span
                                          key={`${echo.id}-${chip}`}
                                          className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500"
                                        >
                                          {chip}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => openTutorFromCollection(buildTutorQuestionFromEcho(echo, 'review'))}
                                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                                    >
                                      做成复习清单
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openTutorFromCollection(buildTutorQuestionFromEcho(echo, 'explore'))}
                                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                                    >
                                      顺着这条问 Tutor
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-[18px] border border-dashed border-slate-200 bg-white px-3 py-4 text-sm leading-6 text-slate-500">
                          当前筛选下还没有回声，换一个标签看看，或者继续收集更多上下文。
                        </div>
                      )}
                    </div>
                  ) : null}

                  {collectionPulse?.actions?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {collectionPulse.actions.map((action) => (
                        <button
                          key={action.key}
                          type="button"
                          onClick={() => {
                            setMobileCollectionSheet(null);
                            handleCollectionPulseAction(action.key);
                          }}
                          className="rounded-full border border-emerald-100 bg-white px-3 py-2 text-xs font-medium text-emerald-700 transition hover:border-emerald-200 hover:bg-emerald-50"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {mobileCollectionSheet === 'history' ? (
                <div className="max-h-[52vh] overflow-hidden rounded-b-[30px]">
                  {workspaceCaptures.length > 0 ? (
                    <WorkspaceCaptureList
                      captures={workspaceCaptures}
                      onClose={() => setMobileCollectionSheet(null)}
                      onOpenReview={handleOpenWorkspaceCaptureReview}
                      maxHeight="52vh"
                      showHeader={false}
                    />
                  ) : (
                    <SessionHistoryList
                      userId={user?.id}
                      onSessionSelect={(session) => {
                        setMobileCollectionSheet(null);
                        void handleLoadHistorySession(session);
                      }}
                      onClose={() => setMobileCollectionSheet(null)}
                      activeSessionId={sessionId}
                      maxHeight="52vh"
                      showHeader={false}
                      variant="capture"
                    />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {showMobileRecorder ? (
        <div className={`relative z-30 flex-shrink-0 ${dockPaddingClass}`}>
          <div className={`mx-auto w-full ${dockWidthClass} rounded-[24px] border border-slate-200/90 bg-white/98 p-1.5 shadow-[0_20px_42px_rgba(15,23,42,0.14)] backdrop-blur`}>
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
        <div className={`relative z-20 flex-shrink-0 ${dockPaddingClass}`}>
          <div className={`mx-auto flex w-full ${dockWidthClass} items-end gap-2 border-t border-[#d8d8d8] bg-[#f7f7f7]/98 px-3 py-2 backdrop-blur`}>
            <button
              type="button"
              onClick={openLiveRecorder}
              disabled={isComposerVoiceRecording || composerVoiceStatus === 'connecting'}
              className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border bg-white transition ${
                showMobileRecorder
                  ? 'border-[#f1b24a] text-[#c88719]'
                  : 'border-[#d9d9d9] text-[#1f2329]'
              } disabled:border-[#e7e7e7] disabled:text-slate-300`}
              aria-label="录制原声"
            >
              <AudioLines size={18} strokeWidth={2} />
            </button>

            <div className="min-w-0 flex-1 rounded-[8px] border border-[#d9d9d9] bg-white px-3 py-2">
              {composerLinkPreview ? (
                <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-[#ece4ff] bg-[#faf7ff] px-3 py-2 text-[11px] text-slate-500">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-fuchsia-600">
                    <Link2 size={12} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-700">
                      识别到 {composerLinkPreview.providerLabel} 链接
                    </p>
                    <p className="truncate text-slate-400">
                      {composerCanAutoImportLink ? '发送后会自动解析进收集流' : '会先作为一条链接笔记留在这里'}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <textarea
                  ref={collectionComposerRef}
                  value={collectionComposerText}
                  onChange={(event) => {
                    setSourceImportError('');
                    setCollectionComposerText(event.target.value);
                  }}
                  onPaste={handleCollectionComposerPaste}
                  placeholder="发一句想法，贴个链接，或者先把这节课丢进来"
                  rows={composerRows}
                  className="max-h-24 min-h-[38px] flex-1 resize-none border-0 bg-transparent px-0 py-0.5 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    void toggleComposerDictation();
                  }}
                  disabled={showMobileRecorder || isRecording}
                  className={`mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition ${
                    composerVoiceStatus === 'connecting' || isComposerVoiceRecording
                      ? 'bg-[#07c160] text-white shadow-[0_10px_24px_rgba(7,193,96,0.22)]'
                      : 'bg-[#e8f9ef] text-[#07c160]'
                  } disabled:bg-slate-100 disabled:text-slate-400`}
                  aria-label={isComposerVoiceRecording || composerVoiceStatus === 'connecting' ? '停止语音听写' : '语音转文字'}
                >
                  <Mic size={15} />
                </button>
              </div>
              {sourceImporting || composerVoiceStatus === 'connecting' || isComposerVoiceRecording || composerCanAutoImportLink ? (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#07c160]" />
                  <span>
                    {sourceImporting
                      ? activeSourceImportCount > 1
                        ? `${activeSourceImportCount} 个文件已收下，稍后慢慢整理`
                        : '这个文件已收下，稍后慢慢整理'
                      : composerVoiceStatus === 'connecting'
                        ? '正在打开语音听写'
                        : isComposerVoiceRecording
                          ? compactText(composerVoiceInterimText || '正在听你说', 28)
                          : '发出去后会自动接进来'}
                  </span>
                </div>
              ) : null}
              {!sourceImporting && sourceImportError ? (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-rose-500">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-rose-400" />
                  <span>{compactText(sourceImportError, 40)}</span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => handleSourceFileButtonClick('all')}
              className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border bg-white transition ${
                sourceImporting
                  ? 'border-[#07c160] text-[#07c160]'
                  : 'border-[#d9d9d9] text-[#1f2329]'
              }`}
              aria-label="上传文件"
            >
              <Plus size={17} />
            </button>

            <button
              type="button"
              onClick={handleCollectionComposerSubmit}
              className={`inline-flex h-11 min-w-[64px] flex-shrink-0 items-center justify-center rounded-[10px] px-4 text-sm font-semibold text-white transition ${
                isComposerVoiceRecording || composerVoiceStatus === 'connecting'
                  ? 'bg-[#07c160]/70'
                  : collectionComposerText.trim()
                    ? 'bg-[#07c160]'
                    : 'bg-[#07c160]/85'
              }`}
              aria-label="发送到收集流"
            >
              发送
            </button>
          </div>
        </div>
      )}

    </div>
  );
  };

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
          ? '.txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx,.ppt,.pptx'
          : 'audio/*,.mp3,.wav,.webm,.ogg,.m4a,.aac,.flac,.txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx,.ppt,.pptx';

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
                  数据收集入口
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
                      className="group inline-flex items-center gap-1 rounded-full border border-cyan-100 bg-cyan-50/60 px-2.5 py-1 text-xs font-medium text-cyan-800"
                    >
                      <span>{item.type === 'document' ? '文档' : '文本'}</span>
                      <span className="max-w-[160px] truncate">{item.title}</span>
                      <span className="text-cyan-500">{item.segmentCount} 段</span>
                      <button
                        type="button"
                        onClick={() => removeSupportSource(item.id)}
                        className="ml-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-cyan-400 opacity-0 transition hover:bg-cyan-200 hover:text-cyan-700 group-hover:opacity-100"
                        title="删除"
                      >
                         ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                 <p className="mt-2 text-xs text-slate-400">可选上传 PDF、讲义或文本，为后续识别和应用生成提供支持。</p>
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
    removeSupportSource,
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
        <div className="card-edu overflow-hidden p-0" style={{ maxHeight: historyMaxHeight, display: showSessionHistory ? undefined : 'none' }}>
          {workspaceCaptures.length > 0 ? (
            <WorkspaceCaptureList
              captures={workspaceCaptures}
              onClose={() => setShowSessionHistory(false)}
              onOpenReview={handleOpenWorkspaceCaptureReview}
              maxHeight={historyMaxHeight}
              showHeader={false}
            />
          ) : (
            <SessionHistoryList
              userId={user?.id}
              onSessionSelect={handleLoadHistorySession}
              onClose={() => setShowSessionHistory(false)}
              activeSessionId={sessionId}
              maxHeight={historyMaxHeight}
              showHeader={false}
              variant="capture"
            />
          )}
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
            <p className="mt-2 text-xs leading-5 text-slate-500">系统会自动融合补充材料里的 PDF 和文本，提升 ASR 与后续应用生成质量。</p>
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
              {(() => {
                const supportList = sourceItems.filter((item) => item.role === 'support');
                return supportList.length > 0 ? (
                  <div className="space-y-2">
                    <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 px-3 py-2 text-xs text-cyan-700">
                      当前补充材料数量：{supportList.length}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {supportList.map((item) => (
                        <div
                          key={item.id}
                          className="group flex items-center justify-between gap-2 rounded-xl border border-slate-150 bg-slate-50/80 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
                            <span className="flex-shrink-0 rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                              {item.type === 'document' ? '文档' : '文本'}
                            </span>
                            <span className="truncate">{item.title}</span>
                            <span className="flex-shrink-0 text-slate-400">{item.segmentCount} 段</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeSupportSource(item.id)}
                            className="flex-shrink-0 rounded-lg p-1 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                            title="删除这份资料"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 px-3 py-2 text-xs text-cyan-700">
                    当前补充材料数量：0
                  </div>
                );
              })()}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleSourceFileButtonClick('support')}
                  disabled={sourceImporting || isRecording}
                  className="rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,116,144,0.28)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sourceImporting ? '处理中...' : '上传资料'}
                </button>
                <span className="text-xs text-slate-500">支持 pdf / docx / ppt / pptx / txt / md / csv / json / html</span>
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
    handleOpenWorkspaceCaptureReview,
    handleSourceFileButtonClick,
    handleVideoImportReady,
    isRecording,
    removeSupportSource,
    sessionId,
    showSessionHistory,
    sourceImportMode,
    sourceImporting,
    sourceItems,
    sourcePanelMode,
    sourceTextInput,
    user?.id,
    workspaceCaptures,
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
              data-onboarding="mode-switch"
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
          {/* NOTE: cleaned corrupted legacy comment. */}
          {isMobile ? (
            <>
              {renderMobileRecordView()}
              {false && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* 顶部品牌区：Logo、模式切换和菜单入口 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-2 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <GraduationCap size={18} strokeWidth={2} className="text-white" />
                </div>
                
                {/* Tab 切换区 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    data-onboarding="mode-switch"
                  />
                </div>
                
                {/* 菜单入口 / 用户头像 */}
                {isAuthenticated && user ? (
                  <button
                    onClick={() => setIsMenuOpen(true)}
                    className="w-8 h-8 bg-gradient-to-br from-lilac-200 to-lilac-300 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                  >
                    <Avatar className="w-full h-full">
                      {user?.avatar ? (
                        <AvatarImage src={user?.avatar ?? undefined} alt={user?.nickname || '用户'} className="object-cover" />
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

                {/* 菜单按钮 */}
                <DedaoMenuButton onClick={() => setIsMenuOpen(true)} />
              </div>

              {/* NOTE: cleaned corrupted legacy comment. */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="w-full max-w-md mx-auto flex flex-col gap-3 pb-6">
                  {/* NOTE: cleaned corrupted legacy comment. */}
                  <div className="flex-shrink-0 mb-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[11px] font-medium tracking-[0.02em] text-slate-500">选择输入方式</span>
                      <span className="text-[10px] text-slate-400">课堂收集入口</span>
                    </div>
                    {renderInputSourceTabs('mobile')}
                  </div>

                  <div className="min-h-[360px]" style={{ display: dataSource === 'live' && !showSessionHistory ? undefined : 'none' }}>
                    <Recorder
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

                  {renderInputSecondaryPanels('mobile')}
                  
                  {/* NOTE: cleaned corrupted legacy comment. */}
                  {anchors.length > 0 && (
                    <div className="card-edu p-4 animate-slide-up">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <span>!</span>
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
              )}
            </>
          ) : (
            <div className="flex-1 min-h-0 page-enter" style={{ background: 'var(--edu-bg-primary)' }}>
              {renderMobileRecordView({ desktopShell: true })}
            </div>
          )}
        </>
      ) : (
        <>
          {/* 濡楀矂娼扮粩顖氱鐏炩偓 */}
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
                          data-onboarding={tab.key === 'apps' ? 'review-apps-tab' : undefined}
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
                                        <span className="ml-auto text-xs text-amber-500">点击对话</span>
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
                          data-onboarding={tab.key === 'timeline' ? 'timeline' : tab.key === 'apps' ? 'review-apps-tab' : undefined}
                          data-testid={tab.testId}
                          onClick={() => setReviewTab(tab.key)}
                          className={`flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-all whitespace-nowrap tab-button ${
                            reviewTab === tab.key
                              ? 'bg-white text-amber-600 font-medium shadow-sm'
                              : 'text-gray-500 hover:text-navy hover:bg-white/50'
                          }`}
                        >
                          {tab.LucideIcon && <tab.LucideIcon size={ICON_TAB} strokeWidth={ICON_TAB_STROKE} />}
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
                            <span>对话</span>
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
                            supportContextText={tutorSupportContextText}
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
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'var(--edu-bg-primary)' }}>
              {/* Logo + 顶部 Tab + 菜单入口 */}
              <div className="flex-shrink-0 px-4 py-2.5 flex items-center gap-2 bg-white border-b" style={{ borderColor: 'var(--edu-border-light)' }}>
                {/* Logo */}
                <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <GraduationCap size={18} strokeWidth={2} className="text-white" />
                </div>
                
                {/* Tab 切换区 */}
                <div className="flex-1 flex items-center justify-center">
                  <MobileTabSwitch
                    activeTab={viewMode}
                    onTabChange={(tab) => handleViewModeChange(tab)}
                    data-onboarding="mode-switch"
                  />
                </div>
                
                {/* 菜单入口 / 用户头像 */}
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

                {/* 菜单按钮 */}
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

                  {/* 全局 AI 入口，适合基于当前课堂继续追问。 */}
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
                    
                    {/* 当前对话 / 历史对话切换 */}
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
                      {/* 历史对话 */}
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
                        breakpoint={selectedBreakpoint}
                        segments={segments}
                        isLoading={false}
                        onResolve={handleResolveAnchor}
                        onActionItemsUpdate={handleActionItemsUpdate}
                        sessionId={sessionId}
                        supportContextText={tutorSupportContextText}
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
                <div className="flex-1 min-h-0 flex flex-col bg-white" data-onboarding="mobile-workshop-panel">
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
        terminologyHint={extractedTermsHint || undefined}
        onSeek={(timeMs) => {
          handleUnifiedSeek(timeMs, true);
        }}
        onClose={closeWorkshopWindow}
        onToggleMinimize={toggleWorkshopWindowMinimize}
        onFocus={focusWorkshopWindow}
        onToggleDisplayMode={toggleWorkshopWindowDisplayMode}
      />
      
      {/* 主要内容区域 */}
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

function formatRelativeCollectionTime(isoString?: string): string {
  if (!isoString) return '刚刚';
  const timestamp = new Date(isoString).getTime();
  if (!Number.isFinite(timestamp)) return '刚刚';
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} 天前`;

  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

function buildSourcePreviewText(segments: TranscriptSegment[], maxLength = 160): string {
  return compactText(
    (segments || [])
      .map((segment) => segment.text || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    maxLength
  );
}

function normalizeImportedVideoSegments(payload: {
  segments?: TranscriptSegment[];
  sentences?: Array<{
    id?: string;
    text?: string;
    beginTime?: number;
    endTime?: number;
    confidence?: number;
  }>;
}): TranscriptSegment[] {
  if (Array.isArray(payload.segments) && payload.segments.length > 0) {
    return payload.segments;
  }

  return (payload.sentences || []).map((item, index) => ({
    id: item.id || `video-seg-${index}`,
    text: String(item.text || ''),
    startMs: Number(item.beginTime || 0),
    endMs: Number(item.endTime || 0),
    confidence: Number(item.confidence || 0.95),
    isFinal: true,
  }));
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
      <div className="min-h-dvh bg-[linear-gradient(180deg,#e9edf5_0%,#dfe5ef_100%)]">
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





