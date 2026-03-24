/**
 * Utility functions extracted from page.tsx.
 *
 * Pure helpers that do NOT depend on React hooks or component state.
 * They operate on domain types defined in @/types/page-types.
 */

import type { TranscriptSegment } from '@/types';
import type {
  SourceIngestItem,
  SourceIngestType,
  SourceIngestRole,
  SupportReferenceItem,
  WorkspaceCaptureMessage,
  WorkspaceEchoMessage,
  WechatCaptureMessage,
  DailyEchoRefreshPayload,
  ManualEchoFeedbackState,
  ManualEchoFeedbackTone,
} from '@/types/page-types';
import type { VideoInsightItem } from '@/components/VideoInsightTimeline';
import type { WorkspaceCaptureListItem } from '@/components/WorkspaceCaptureList';
import {
  getCollectionContextDisplayTitle,
} from '@/lib/capture/collection-context';
import type { FloatingWorkshopWindowState } from '@/components/apps/windows/WorkshopWindowManager';

// ── Constants ─────────────────────────────────────────────────────

export const ACTION_PROGRESS_KEY_PREFIX = 'action_progress:';
export const WORKSHOP_WINDOW_STATE_PREFIX = 'app_workspace_open_windows:';
export const MAX_ACTIVE_WORKSHOP_WINDOWS = 2;

export const VIDEO_INSIGHT_COLORS = ['#B48EFA', '#7FD4B2', '#7FADEB', '#F2AE8F', '#F0CD70', '#90D4DD'];
export const ENABLE_ECHO_MANUAL_TRIGGER =
  process.env.NODE_ENV !== 'production' ||
  String(process.env.NEXT_PUBLIC_ENABLE_ECHO_MANUAL_TRIGGER || '').toLowerCase() === 'true';

// ── Text helpers ──────────────────────────────────────────────────

export function compactText(value: string, maxLength: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

export function compactMultilineText(value: string, maxLength: number): string {
  const normalized = (value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

// ── Key builders ──────────────────────────────────────────────────

export function getActionProgressKey(sessionId: string): string {
  return `${ACTION_PROGRESS_KEY_PREFIX}${sessionId}`;
}

export function getWorkshopWindowStorageKey(sessionId: string): string {
  return `${WORKSHOP_WINDOW_STATE_PREFIX}${sessionId}`;
}

// ── Workshop window helpers ───────────────────────────────────────

export function normalizeWorkshopWindows(windows: FloatingWorkshopWindowState[]): FloatingWorkshopWindowState[] {
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

// ── Segment helpers ───────────────────────────────────────────────

export function mapSegmentsForAppend(
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

export function getSegmentBatchDurationMs(segments: TranscriptSegment[]): number {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  const startMs = segments[0]?.startMs || 0;
  const endMs = segments[segments.length - 1]?.endMs || 0;
  return Math.max(0, endMs - startMs);
}

// ── Support reference helpers ─────────────────────────────────────

export function buildSupportReferenceSnippet(
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

  const head = chunks.slice(0, 10);
  const tail = chunks.slice(Math.max(chunks.length - 6, 10));
  const middleStart = Math.max(10, Math.floor(chunks.length * 0.45));
  const middle = chunks.slice(middleStart, Math.min(middleStart + 8, chunks.length - 6));

  return compactText([...head, ...middle, ...tail].join(' '), maxLength);
}

export function mergeSupportReferences(
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

export function getSupportReferenceDisplayTitle(item: Pick<SourceIngestItem, 'type' | 'title' | 'preview' | 'fullText'>): string {
  return getCollectionContextDisplayTitle(item, 80) || '补充材料';
}

// ── Echo helpers ──────────────────────────────────────────────────

export function mergeWorkspaceEchoes(
  previous: WorkspaceEchoMessage[],
  incoming: WorkspaceEchoMessage[],
  limit: number = 16
): WorkspaceEchoMessage[] {
  const normalized = [...incoming, ...previous]
    .filter((item) => item && item.id && item.title && item.body)
    .map((item) => ({
      ...item,
      title: compactText(item.title, 80),
      body: String(item.body || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      chips: Array.isArray(item.chips) ? item.chips.filter(Boolean).slice(0, 4) : [],
      recommendations: Array.isArray(item.recommendations)
        ? item.recommendations
            .map((recommendation) => ({
              title: String(recommendation?.title || '')
                .replace(/\r\n/g, '\n')
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim(),
              body: String(recommendation?.body || '')
                .replace(/\r\n/g, '\n')
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim(),
            }))
            .filter((recommendation) => recommendation.title && recommendation.body)
            .slice(0, 2)
        : [],
      memory:
        item.memory &&
        Number.isFinite(item.memory.sourceCaptureCount) &&
        item.memory.sourceCaptureCount > 0
          ? {
              sourceCaptureCount: Math.max(0, item.memory.sourceCaptureCount),
              todayCaptureCount: Math.max(0, item.memory.todayCaptureCount || 0),
              recentCaptureCount: Math.max(0, item.memory.recentCaptureCount || 0),
            }
          : null,
      updatedAt: item.updatedAt || item.createdAt,
    }));

  const unique: WorkspaceEchoMessage[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique
    .sort(
      (a, b) =>
        new Date(resolveEchoDisplayTime(b)).getTime() - new Date(resolveEchoDisplayTime(a)).getTime()
    )
    .slice(0, limit);
}

export function resolveEchoDisplayTime(item: Pick<WorkspaceEchoMessage, 'createdAt' | 'updatedAt'>): string {
  return item.updatedAt || item.createdAt;
}

export function getEchoDebugReasonLabel(reason?: string): string {
  switch (reason) {
    case 'active':
      return '今天这条回声已经生成好了';
    case 'pending':
      return '今日回声还在生成中';
    case 'context-too-thin':
      return '当前上下文还太薄，先多收一点';
    case 'too-short':
      return '这次结果太短，先保留当前版本';
    case 'too-similar':
      return '这次和最近回声太像，先保留当前版本';
    case 'low-signal':
      return '这次结果不够聚焦，先保留当前版本';
    case 'workspace-missing':
      return '当前工作区不可用';
    case 'config-missing':
      return '回声服务还没配置好';
    default:
      return reason || '已跳过';
  }
}

export function getEchoQualityWarningLabel(reason?: string): string {
  switch (reason) {
    case 'too-short':
      return '这次结果偏短';
    case 'too-similar':
      return '这次和上一版很接近';
    case 'low-signal':
      return '这次结果不够聚焦';
    default:
      return getEchoDebugReasonLabel(reason);
  }
}

export function buildManualEchoFeedbackFromPayload(payload: DailyEchoRefreshPayload): ManualEchoFeedbackState {
  if (payload.echo && !payload.skipped) {
    if (payload.reason === 'too-similar') {
      return {
        tone: 'success',
        title: '测试版已更新',
        body: '这次和上一版很接近，但上面已经换成新结果了。',
      };
    }
    if (payload.reason === 'low-signal') {
      return {
        tone: 'success',
        title: '测试版已更新',
        body: '这次结果有点散，但上面已经换成新结果了。',
      };
    }
    if (payload.reason === 'too-short') {
      return {
        tone: 'success',
        title: '测试版已更新',
        body: '这次结果偏短，但上面已经换成新结果了。',
      };
    }
    return {
      tone: 'success',
      title: '测试生成完成',
      body: '上面已经换成新版本。',
    };
  }

  switch (payload.reason) {
    case 'active':
      return {
        tone: 'info',
        title: '今天这条已经有了',
        body: '先看上面的版本，不必重复生成。',
      };
    case 'pending':
      return {
        tone: 'pending',
        title: '已经发出测试请求',
        body: '再等几秒，今天这条就会回来。',
      };
    case 'context-too-thin':
      return {
        tone: 'info',
        title: '线索还不够',
        body: '先再补一句，结果会更像样。',
      };
    case 'too-short':
      return {
        tone: 'info',
        title: '这次结果太空了',
        body: '先保留当前版本。',
      };
    case 'too-similar':
      return {
        tone: 'info',
        title: '这次没有更好',
        body: '和当前版本太像了，先不覆盖。',
      };
    case 'low-signal':
      return {
        tone: 'info',
        title: '这次没抓住线索',
        body: '先保留当前版本，晚点再试。',
      };
    case 'config-missing':
      return {
        tone: 'error',
        title: '回声服务还没接好',
        body: '先检查 CommonStack 配置。',
      };
    default:
      return {
        tone: 'info',
        title: '这次没有生成出新回声',
        body: '可以稍后再试。',
      };
  }
}

export function buildManualEchoErrorFeedback(message: string): ManualEchoFeedbackState {
  return {
    tone: 'error',
    title: '这次生成没成功',
    body: message || '这次没拿到可用结果。',
  };
}

export function buildManualEchoUnavailableFeedback(params: {
  isGuestFastEntry: boolean;
  isCheckingAuth: boolean;
}): ManualEchoFeedbackState {
  if (params.isCheckingAuth) {
    return {
      tone: 'pending',
      title: '正在确认账号状态',
      body: '确认完登录状态后再试。',
    };
  }

  if (params.isGuestFastEntry) {
    return {
      tone: 'info',
      title: '游客模式下不能直接测回声',
      body: '先登录，再在工作区里触发。',
    };
  }

  return {
    tone: 'info',
    title: '登录后才能测试回声',
    body: '先登录，再回来试这一条。',
  };
}

export function getManualEchoFeedbackClasses(tone: ManualEchoFeedbackTone) {
  switch (tone) {
    case 'pending':
      return 'border-[#E9E9E7] bg-[#FDF3C0]/50 text-[#232322]';
    case 'success':
      return 'border-[#E9E9E7] bg-[#D1F4E0]/50 text-[#232322]';
    case 'error':
      return 'border-rose-200/80 bg-rose-50/70 text-rose-800';
    default:
      return 'border-slate-200 bg-white/80 text-slate-700';
  }
}

export function resolveEchoTimeBucket(createdAt: string): 'today' | 'week' | 'earlier' {
  const created = new Date(createdAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = now.getTime() - created.getTime();

  if (created.getTime() >= startOfToday) return 'today';
  if (diff <= 7 * 24 * 60 * 60 * 1000) return 'week';
  return 'earlier';
}

export function getEchoBucketLabel(bucket: 'today' | 'week' | 'earlier'): string {
  if (bucket === 'today') return '今天';
  if (bucket === 'week') return '最近 7 天';
  return '更早';
}

// ── Workspace capture helpers ─────────────────────────────────────

export function mergeWorkspaceCaptures(
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
    if (item.status === 'deleted') continue;
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

// ── Audio / media helpers ─────────────────────────────────────────

export function resolvePendingAudioFailureStatus(message: string): string {
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

export function resolveSourceFailureStatus(params: {
  isAudio?: boolean;
  isVideo?: boolean;
  isImage?: boolean;
}): string {
  if (params.isAudio) return '原声已保留';
  if (params.isVideo) return '视频已保留';
  if (params.isImage) return '图片已保留';
  return '文件已保留';
}

export async function getLocalMediaDurationMs(file: Blob): Promise<number> {
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

export function formatVoiceDurationCompact(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}"`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}'${seconds.toString().padStart(2, '0')}"`;
}

export function getFileExtensionBadge(title: string): string | null {
  const index = title.lastIndexOf('.');
  if (index <= 0 || index >= title.length - 1) return null;
  return compactText(title.slice(index + 1).trim().toUpperCase(), 8) || null;
}

// ── WeChat capture helpers ────────────────────────────────────────

export function inferWechatCaptureSourceType(message: WechatCaptureMessage): SourceIngestType {
  if (message.msgType === 'voice') return 'audio';
  if (message.msgType === 'image') return 'image';
  if (message.reachChannel === 'video-link') return 'video';
  if (message.msgType === 'link') return 'document';
  return 'text';
}

export function inferWechatCaptureRole(message: WechatCaptureMessage): SourceIngestRole {
  if (message.msgType === 'event') return 'support';
  return 'primary';
}

export function inferWechatCaptureTitle(message: WechatCaptureMessage): string {
  if (message.title?.trim()) return compactText(message.title.trim(), 60);
  if (message.msgType === 'voice') return '微信语音';
  if (message.msgType === 'image') return '微信图片';
  if (message.msgType === 'link') return '微信链接';
  if (message.msgType === 'event') return '微信服务号';
  return '微信随手记';
}

export function inferWorkspaceCaptureSourceType(item: WorkspaceCaptureMessage): SourceIngestType {
  if (item.contentType === 'audio') return 'audio';
  if (item.contentType === 'video') return 'video';
  if (item.contentType === 'image') return 'image';
  if (item.contentType === 'link' || item.contentType === 'document') return 'document';
  return 'text';
}

export function inferWorkspaceCaptureRole(item: WorkspaceCaptureMessage): SourceIngestRole {
  if (item.sourceType === 'wechat') return 'primary';
  if (item.role === 'primary' || item.role === 'support') return item.role;
  return item.contentType === 'audio' ? 'primary' : 'support';
}

export function resolveSourceItemSourceKey(item: SourceIngestItem): string | null {
  if (item.sourceKey?.trim()) return item.sourceKey.trim();
  if (item.id.startsWith('wechat-')) return `wechat:${item.id.replace('wechat-', '')}`;
  if (item.id.startsWith('quick-note-')) return `manual:${item.id}`;
  if (item.id.startsWith('pasted-text-')) return `import:${item.id}`;
  if ((item.type === 'audio' || item.type === 'video') && item.role === 'primary') return `ingest:${item.id}`;
  if (item.role === 'support' && (item.type === 'document' || item.type === 'image' || item.type === 'text')) {
    return `support:${item.id}`;
  }
  return null;
}

export function resolveCaptureSourceFullText(params: {
  type: SourceIngestType;
  normalizedText?: string | null;
  previewText?: string | null;
  title: string;
}): string | undefined {
  const transcriptOnly = params.type === 'audio' || params.type === 'video';
  const raw = transcriptOnly
    ? params.normalizedText || ''
    : params.normalizedText || params.previewText || params.title;
  const resolved = compactMultilineText(raw, 3200);
  return resolved || undefined;
}

export function buildWorkspaceCaptureSourceItem(item: WorkspaceCaptureMessage): SourceIngestItem {
  const type = inferWorkspaceCaptureSourceType(item);
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : null;
  const thumbnailUrl =
    typeof metadata?.thumbnailUrl === 'string' && metadata.thumbnailUrl.trim()
      ? metadata.thumbnailUrl.trim()
      : undefined;
  const embedUrl =
    typeof metadata?.embedUrl === 'string' && metadata.embedUrl.trim()
      ? metadata.embedUrl.trim()
      : undefined;
  const videoProvider =
    typeof metadata?.videoProvider === 'string' && metadata.videoProvider.trim()
      ? metadata.videoProvider.trim()
      : undefined;
  const videoImported = metadata?.videoImported === true;
  const serverTranscriptSegments =
    Array.isArray(metadata?.transcriptSegments) && (metadata.transcriptSegments as unknown[]).length > 0
      ? (metadata.transcriptSegments as Array<{ id?: string; text?: string; startMs?: number; endMs?: number }>)
      : undefined;
  const durationSec =
    typeof metadata?.durationSec === 'number' ? metadata.durationSec : undefined;
  const resolvedText = resolveCaptureSourceFullText({
    type,
    normalizedText: item.normalizedText,
    previewText: item.previewText,
    title: item.title,
  });
  const displayTitle =
    getCollectionContextDisplayTitle(
      {
        type,
        title: item.title,
        preview: item.previewText || resolvedText || item.title,
        fullText: resolvedText,
      },
      48
    ) || item.title;

  return {
    id: `workspace-${item.id}`,
    sourceKey: item.sourceKey,
    type,
    role: inferWorkspaceCaptureRole(item),
    title: displayTitle,
    preview: compactText(item.previewText || item.title, 180),
    previewUrl:
      type === 'image'
        ? item.mediaUrl || undefined
        : type === 'video'
          ? thumbnailUrl
          : undefined,
    mediaUrl: type === 'audio' || type === 'video' ? item.mediaUrl || undefined : undefined,
    attachmentUrl: item.sourceUrl || undefined,
    fullText: resolvedText,
    segmentCount: resolvedText ? 1 : 0,
    addedAt: item.occurredAt || item.createdAt,
    origin: 'user',
    sessionId:
      metadata && typeof metadata.sessionId === 'string'
        ? metadata.sessionId
        : undefined,
    durationMs:
      durationSec != null
        ? Math.round(durationSec * 1000)
        : metadata && typeof metadata.duration === 'number'
          ? metadata.duration
          : undefined,
    reviewable: type === 'audio' || type === 'video',
    embedUrl,
    videoProvider,
    videoImported,
    serverTranscriptSegments,
  };
}

export function buildWechatCaptureSourceItem(message: WechatCaptureMessage): SourceIngestItem {
  const sourceType = inferWechatCaptureSourceType(message);
  const title = inferWechatCaptureTitle(message);
  const preview = compactText(
    message.normalizedText?.trim() || message.previewText?.trim() || title,
    180
  );
  const fullText = resolveCaptureSourceFullText({
    type: sourceType,
    normalizedText: message.normalizedText,
    previewText: message.previewText,
    title,
  });
  const addedAt = message.messageAt || new Date().toISOString();

  return {
    id: `wechat-${message.linkToken}`,
    sourceKey: `wechat:${message.linkToken}`,
    type: sourceType,
    role: inferWechatCaptureRole(message),
    title,
    preview,
    previewUrl: sourceType === 'image' ? message.mediaUrl || undefined : undefined,
    mediaUrl: sourceType === 'audio' || sourceType === 'video' ? message.mediaUrl || undefined : undefined,
    attachmentUrl: message.sourceUrl || undefined,
    fullText,
    segmentCount: fullText ? 1 : 0,
    addedAt,
    origin: 'user',
  };
}

export function buildCollectionListItemFromSourceItem(
  item: SourceIngestItem,
  status: 'active' | 'archived' = 'active'
): WorkspaceCaptureListItem {
  const inferredSourceKey = resolveSourceItemSourceKey(item) || `local:${item.id}`;
  const normalizedText =
    compactMultilineText(item.fullText || item.preview || item.title, 3200) || null;

  return {
    id: item.id,
    sourceKey: inferredSourceKey,
    sourceType: 'local-collection',
    kind: 'local',
    sourceItemId: item.id,
    editable: false,
    status,
    role: item.role,
    contentType: item.type,
    title: item.title,
    previewText: item.preview || item.title,
    normalizedText,
    sourceUrl: item.attachmentUrl || null,
    mediaUrl: item.mediaUrl || null,
    tutorContext: normalizedText,
    occurredAt: item.addedAt,
    createdAt: item.addedAt,
    metadata: {
      sourceItemId: item.id,
      localOnly: true,
      sessionId: item.sessionId || null,
      duration: item.durationMs || null,
      status: item.status || 'ready',
    },
  };
}

export function mergeWechatWorkspaceCapturesIntoSourceItems(
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

  let changed = false;
  const next = [...previous];

  for (const item of wechatCaptures) {
    const built = buildWorkspaceCaptureSourceItem(item);
    const matchIndex = next.findIndex(
      (existing) => existing.id === built.id || resolveSourceItemSourceKey(existing) === item.sourceKey
    );

    if (matchIndex >= 0) {
      const current = next[matchIndex];
      const merged: SourceIngestItem = {
        ...current,
        ...built,
        id: current.id.startsWith('wechat-') ? current.id : built.id,
      };

      if (JSON.stringify(current) !== JSON.stringify(merged)) {
        next[matchIndex] = merged;
        changed = true;
      }
      continue;
    }

    next.push(built);
    changed = true;
  }

  return changed ? next : previous;
}

// ── API helpers ───────────────────────────────────────────────────

export async function readJsonApiResponse<T>(response: Response, errorPrefix: string): Promise<T> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T;
  } catch {
    const snippet = compactText(raw.replace(/\s+/g, ' ').trim(), 200);
    const _detail = snippet ? `：${snippet}` : '';
    throw new Error(`${errorPrefix}（接口返回非 JSON，HTTP ${response.status}）${_detail}`);
  }
}

// ── ASR / Tutor context builders ──────────────────────────────────

export function buildASRContextHint(params: {
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

export function buildTutorSupportContextText(
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

export function buildTutorQuestionFromEcho(
  params: {
    title: string;
    body: string;
    chips?: string[];
  },
  _mode: 'explore' | 'review' = 'explore'
): string {
  return compactMultilineText(
    `顺着这条回声继续带我学：\n${params.body}`,
    280
  );
}

// ── Video insight helpers ─────────────────────────────────────────

export function buildSeedVideoInsights(segments: TranscriptSegment[]): VideoInsightItem[] {
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

// ── Format helpers (bottom-of-file functions) ─────────────────────

export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

export function formatRelativeCollectionTime(isoString?: string): string {
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

export function buildSourcePreviewText(segments: TranscriptSegment[], maxLength = 160): string {
  return compactText(
    (segments || [])
      .map((segment) => segment.text || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    maxLength
  );
}

export function normalizeImportedVideoSegments(payload: {
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

// ---------------------------------------------------------------------------
// API call helpers (zero React-state dependency, safe to call from anywhere)
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file via /api/transcribe-turbo or /api/transcribe with
 * automatic fallback. Files ≤ 12 MB prefer the turbo endpoint first.
 */
export async function transcribeAudioFile(
  file: File,
  contextHint: string,
): Promise<TranscriptSegment[]> {
  const createFormData = () => {
    const formData = new FormData();
    formData.append('audio', file);
    if (contextHint.trim()) {
      formData.append('context', contextHint.trim());
    }
    return formData;
  };

  const preferTurbo = file.size <= 12 * 1024 * 1024;
  const endpoints = preferTurbo
    ? (['/api/transcribe-turbo', '/api/transcribe'] as const)
    : (['/api/transcribe', '/api/transcribe-turbo'] as const);

  let response: Response | null = null;
  let payload: {
    success?: boolean;
    error?: string;
    code?: string;
    segments?: TranscriptSegment[];
    sentences?: Array<{
      id?: string;
      text: string;
      beginTime?: number;
      endTime?: number;
    }>;
  } = {};
  let lastErrorMessage = '音频转写失败';

  for (const endpoint of endpoints) {
    response = await fetch(endpoint, {
      method: 'POST',
      body: createFormData(),
    });

    payload = await readJsonApiResponse<{
      success?: boolean;
      error?: string;
      code?: string;
      segments?: TranscriptSegment[];
      sentences?: Array<{
        id?: string;
        text: string;
        beginTime?: number;
        endTime?: number;
      }>;
    }>(response, '音频转写失败');

    if (response.ok && payload.success) {
      break;
    }

    lastErrorMessage = payload.error || lastErrorMessage;
  }

  if (!response || !response.ok || !payload.success) {
    throw new Error(payload.error || lastErrorMessage);
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
}

/**
 * Upload a document file for server-side parsing (text / PDF / docx …).
 */
export async function parseDocumentFile(
  file: File,
): Promise<{ title: string; fileType: string; segments: TranscriptSegment[] }> {
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
}

/**
 * Upload an image file for server-side OCR / analysis.
 */
export async function parseImageFile(
  file: File,
): Promise<{ title: string; fileType: string; segments: TranscriptSegment[] }> {
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
}
