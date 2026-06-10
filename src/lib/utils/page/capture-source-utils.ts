/**
 * Workspace Capture / WeChat Capture / SourceIngestItem 转换与合并。
 */

import type {
  SourceIngestItem,
  SourceIngestType,
  SourceIngestRole,
  WorkspaceCaptureMessage,
  WechatCaptureMessage,
} from '@/types/page-types';
import type { WorkspaceCaptureListItem } from '@/components/WorkspaceCaptureList';
import { getCollectionContextDisplayTitle } from '@/lib/capture/collection-context';
import { parseVideoLink } from '@/lib/utils/video-link';
import { compactText, compactMultilineText } from './text-and-constants';
import { markdownToPlainText } from '@/lib/services/web-article-extract-service';

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
  if (/Failed to fetch|NetworkError|ECONNRESET|ETIMEDOUT|network|网络/i.test(text)) {
    return '网络不稳，原声已保留';
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
  if (message.reachChannel === 'article-link' || message.msgType === 'link') return 'document';
  return 'text';
}

export function inferWechatCaptureRole(message: WechatCaptureMessage): SourceIngestRole {
  if (message.msgType === 'event') return 'support';
  return 'primary';
}

export function inferWechatCaptureTitle(message: WechatCaptureMessage): string {
  const rawTitle = message.title?.trim();
  // 过滤掉本身就是 URL 的 title（微信有时会把 URL 填到 Title 字段）
  const isUrlLike = rawTitle && /^https?:\/\//i.test(rawTitle);
  if (rawTitle && !isUrlLike) return compactText(rawTitle, 60);

  // 对 link / article-link 类型，尝试从 sourceUrl 提取平台名作为标题
  const hasLink = message.msgType === 'link' || message.reachChannel === 'article-link' || message.reachChannel === 'web-link';
  if (hasLink && message.sourceUrl) {
    const parsed = parseVideoLink(message.sourceUrl);
    if (parsed && parsed.provider !== 'generic') {
      return `${parsed.providerLabel} 文章`;
    }
    try {
      const hostname = new URL(message.sourceUrl).hostname.replace(/^www\./i, '');
      if (hostname) return `${hostname} 文章`;
    } catch { /* ignore */ }
  }

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
  // v3.0：shared-agent 是同学分享回来的产物（链接形态）
  if (item.sourceType === 'shared-agent') return 'document';
  return 'text';
}

/**
 * v3.0：根据分享元数据生成 capture 列表里的 preview 文本，
 * 让 B 一眼看出"这是 X 分享的速查表"，而不是一条 untyped 的 capture。
 */
const SHARED_AGENT_KIND_LABEL: Record<string, string> = {
  cheatsheet: '考前速查表',
  mindmap: '思维导图',
  quiz: '课堂测验',
  flashcards: '课堂闪卡',
  infographic: '课堂信息图',
  'audio-overview': '课堂播客',
  notes: '同学版笔记',
  'chat-only': '一段对话',
};
function buildSharedAgentPreview(params: {
  sharerNickname?: string;
  artifactKind?: string;
  title: string;
  fallback?: string | null;
}): string {
  const sharer = params.sharerNickname?.trim() || '一位同学';
  const kindLabel = (params.artifactKind && SHARED_AGENT_KIND_LABEL[params.artifactKind]) || '一份分享';
  return `${sharer}留下的${kindLabel} · 点开继续看 / 跟同学聊`;
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

/**
 * 清理正文中的 Markdown 图片语法和残余分隔线，提升阅读体验。
 * 对存量数据（服务端以前存的 Markdown）做兜底过滤。
 *
 * 复用 web-article-extract-service 的 markdownToPlainText，
 * 统一处理 SVG/XML 残留、URL 编码垃圾、HTML 实体等。
 */
function stripMarkdownArtifacts(text: string): string {
  return markdownToPlainText(text);
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
  const cleaned = stripMarkdownArtifacts(raw);
  const resolved = compactMultilineText(cleaned, 3200);
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
  const bvid =
    typeof metadata?.bvid === 'string' && metadata.bvid.trim()
      ? metadata.bvid.trim()
      : undefined;
  const cid =
    typeof metadata?.cid === 'number' ? metadata.cid : undefined;
  const audioUrl =
    typeof metadata?.audioUrl === 'string' && metadata.audioUrl.trim()
      ? metadata.audioUrl.trim()
      : undefined;
  const sourceMode =
    typeof metadata?.sourceMode === 'string' && metadata.sourceMode.trim()
      ? metadata.sourceMode.trim()
      : undefined;
  // v3.0：shared-agent capture —— 让点击 attachmentUrl 跳回 /share/[token]
  // 这样 B 领取后还能继续看完整产物 + 跟同学对话（同一个 token，幂等）
  const sharedAgentToken =
    item.sourceType === 'shared-agent' && typeof metadata?.sharedAgentToken === 'string'
      ? (metadata.sharedAgentToken as string).trim()
      : undefined;
  const sharedAgentSharerNickname =
    typeof metadata?.sharerNickname === 'string'
      ? (metadata.sharerNickname as string).trim() || undefined
      : undefined;
  const sharedAgentArtifactKind =
    typeof metadata?.artifactKind === 'string'
      ? (metadata.artifactKind as string).trim() || undefined
      : undefined;
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

  // v3.0：shared-agent capture 的 preview 文本 / attachmentUrl 都要替换
  const sharedAgentPreview = sharedAgentToken
    ? buildSharedAgentPreview({
        sharerNickname: sharedAgentSharerNickname,
        artifactKind: sharedAgentArtifactKind,
        title: item.title,
        fallback: item.previewText,
      })
    : undefined;

  return {
    id: `workspace-${item.id}`,
    sourceKey: item.sourceKey,
    type,
    role: inferWorkspaceCaptureRole(item),
    title: displayTitle,
    preview: compactText(sharedAgentPreview || item.previewText || item.title, 180),
    previewUrl:
      type === 'image'
        ? item.mediaUrl || undefined
        : type === 'video'
          ? thumbnailUrl
          : undefined,
    mediaUrl: type === 'audio' || type === 'video' ? item.mediaUrl || undefined : undefined,
    // v3.0：shared-agent capture 的 attachmentUrl 指回分享页（A/B 都能点开看产物 + 对话）
    attachmentUrl: sharedAgentToken ? `/share/${sharedAgentToken}` : item.sourceUrl || undefined,
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
    bvid,
    cid,
    audioUrl,
    sourceMode,
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
    reviewable: sourceType === 'audio' || sourceType === 'video',
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
