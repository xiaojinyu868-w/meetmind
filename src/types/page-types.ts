/**
 * Page-level types for the Student App.
 *
 * These types were extracted from page.tsx to keep the God File under control
 * and provide a clear contract for any agent touching the collection / echo /
 * workspace domain.
 */

import type { LucideIcon as LucideIconType } from 'lucide-react';
import type { TranscriptSegment } from '@/types';

// ── View / Tab types ──────────────────────────────────────────────

export type ViewMode = 'record' | 'review' | 'classroom';
export type DataSource = 'live' | 'demo' | 'video';

export type SharedWorkspaceTab = 'apps';
export type WorkspaceTab = 'timeline' | 'anchor-detail' | 'chat' | 'confusion' | 'transcript' | SharedWorkspaceTab;
export type ReviewTab = Extract<WorkspaceTab, 'timeline' | 'anchor-detail' | SharedWorkspaceTab>;
export type VideoWorkspaceTab = Extract<WorkspaceTab, 'chat' | 'confusion' | 'transcript' | SharedWorkspaceTab>;

export interface WorkspaceTabConfig<T extends WorkspaceTab> {
  key: T;
  label: string;
  icon: string;
  LucideIcon?: LucideIconType;
  testId?: string;
}

// ── Action items ──────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  type: 'replay' | 'exercise' | 'review';
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  relatedTimestamp?: number;
}

// ── Source / Collection types ─────────────────────────────────────

export type SourceIngestType = 'audio' | 'video' | 'image' | 'document' | 'text';
export type SourceIngestRole = 'primary' | 'support';
export type MobileCollectionSheet = null | 'attachments' | 'video' | 'history' | 'echo' | 'more';

export type SourceIngressChannel = 'composer' | 'upload' | 'recording' | 'wechat' | 'share' | 'system';
export type SourceContentState = 'received' | 'extracting' | 'complete' | 'partial' | 'link-only' | 'failed';

export interface SourceProvenance {
  ingressChannel: SourceIngressChannel;
  platformId?: string;
  platformLabel?: string;
  publisher?: string;
  author?: string;
  originalUrl?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  extractionMethod?: string;
  contentState: SourceContentState;
  completeness?: number;
}

export interface SourceIngestItem {
  id: string;
  /** 对应的服务端 WorkspaceCapture；用于按需读取跨设备课堂证据。 */
  workspaceCaptureId?: string;
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
  /** capture 列表已确认存在完整证据，首次打开时可按需恢复到 IndexedDB。 */
  evidenceAvailable?: boolean;
  /** B站等视频嵌入播放地址 */
  embedUrl?: string;
  /** 视频来源平台 (bilibili / youtube 等) */
  videoProvider?: string;
  /** 服务端视频转录是否已完成 */
  videoImported?: boolean;
  /** 服务端写入的转录 segments（来自 metadataJson.transcriptSegments） */
  serverTranscriptSegments?: Array<{ id?: string; text?: string; startMs?: number; endMs?: number }>;
  /** B站视频 BV 号（跨端恢复播放用） */
  bvid?: string;
  /** B站视频 cid（跨端恢复播放用） */
  cid?: number;
  /** 音频播放 URL（跨端恢复播放用，可能来自代理或 CDN） */
  audioUrl?: string;
  /** 导入模式（bili-native / yt-dlp / direct 等） */
  sourceMode?: string;
  /** 封面图 URL（文章/笔记类型） */
  coverUrl?: string;
  /** 正文中的图片 URL 列表（文章/笔记类型） */
  imageUrls?: string[];
  /** 来源进入方式、原始平台与正文完整度；随 WorkspaceCapture.metadata 跨设备恢复。 */
  provenance?: SourceProvenance;
  /**
   * 照片拍摄时间锚点（相对当前录音 session 的毫秒偏移）。
   * 仅现场态拍照时写入（由 `handleImportFiles` 的 options 透传），
   * 用于 lesson-digest 把图片插入到正确的时间段落。
   * 沉淀态补拍的照片该字段为空。
   */
  capturedAtMs?: number;
}

export interface SupportReferenceItem {
  id: string;
  title: string;
  snippet: string;
}

// ── Tutor launch ─────────────────────────────────────────────────

export interface TutorLaunchImageAsset {
  id: string;
  name: string;
  url: string;
  previewUrl?: string;
}

// ── Recording ────────────────────────────────────────────────────

export type PendingRecordedAudio = {
  recordingId: string;
  itemId: string;
  sessionId: string;
  title: string;
  mediaUrl: string;
  durationMs: number;
  blob: Blob;
  baseSegments: TranscriptSegment[];
  baseOffsetMs: number;
};

// ── Collection Pulse ─────────────────────────────────────────────

export interface CollectionPulseState {
  title: string;
  body: string;
  chips: string[];
  actions: Array<{ key: string; label: string }>;
}

// ── WeChat capture ───────────────────────────────────────────────

export interface WechatCaptureMessage {
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
  status?: string | null;
}

// ── Workspace capture ────────────────────────────────────────────

export interface WorkspaceCaptureMessage {
  id: string;
  sourceKey: string;
  sourceType: string;
  status?: 'active' | 'archived' | 'deleted';
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

export type WorkspaceCaptureEditorMode = 'text' | 'transcript' | 'meta';

export interface WorkspaceCaptureEditorState {
  capture: WorkspaceCaptureMessage;
  mode: WorkspaceCaptureEditorMode;
}

// ── Echo ─────────────────────────────────────────────────────────

export interface WorkspaceEchoMessage {
  id: string;
  sourceKey: string;
  kind?: string | null;
  generatedDateKey?: string | null;
  title: string;
  body: string;
  highlights?: Array<{
    text: string;
    timestamp?: string;
    speaker?: string;
  }>;
  takeaway?: string;
  chips: string[];
  recommendations?: Array<{
    title: string;
    body: string;
  }>;
  memory?: {
    sourceCaptureCount: number;
    todayCaptureCount: number;
    recentCaptureCount: number;
  } | null;
  sourceCaptureIds?: string[];
  sourceKeys?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface DailyEchoRefreshPayload {
  success: boolean;
  skipped?: boolean;
  forced?: boolean;
  reason?: string;
  echo?: WorkspaceEchoMessage;
  debug?: {
    model?: string;
    promptVersion?: string;
    todayCaptureCount?: number;
    recentCaptureCount?: number;
    recentEchoCount?: number;
    similarityToRecent?: number;
  };
  error?: string;
}

export type ManualEchoFeedbackTone = 'pending' | 'success' | 'info' | 'error';

export interface ManualEchoFeedbackState {
  tone: ManualEchoFeedbackTone;
  title: string;
  body: string;
}
