/**
 * Workspace capture 写入护栏（2026-09-10，从 workspace-context-service 拆出）。
 *
 * 一节课在服务端只该有一行：stop 路径写 live:{uid}:{sid}、旧客户端写 live:audio-xxx、
 * 登录迁移写 local-session:{uid}:{sid}——三把钥匙指的是同一节课（metadata.sessionId 相同）。
 * 生产库 90 天 79 节课里 57 节双行，另一台设备的收集流就出双卡。这里做三件事：
 *   1. 按 userId + sessionId 找到已有 capture，复用它的 sourceKey，而不是再创建一行
 *   2. 标题护栏：零信息标题（「课堂录音」「录音 20:31」）不覆盖已有的具体标题；用户手改（titleSource=user）永不覆盖
 *   3. 读列表时把历史双行折叠成一行（不删数据），优先有证据、其次现场录音行、再看更新时间
 *
 * 纯函数放这里可单测；唯一的 prisma 查询是 findExistingCaptureForSession。
 */

import prisma from '@/lib/prisma';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';

const CLASSROOM_CONTENT_TYPES = ['audio', 'video'];

export function parseCaptureMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** capture metadata 里代表这节课的跨设备主键（sessionId 优先，旧迁移只有 localSessionId） */
export function readCaptureSessionId(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = typeof metadata?.sessionId === 'string'
    ? metadata.sessionId
    : typeof metadata?.localSessionId === 'string'
      ? metadata.localSessionId
      : '';
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * 同一用户、同一 sessionId、不同 sourceKey 的已有 capture。
 * 只看课堂媒体（audio / video）：文章 / 图片没有 sessionId 语义。
 */
export async function findExistingCaptureForSession(params: {
  userId: string;
  workspaceId: string;
  sessionId: string | null;
  sourceKey: string;
}): Promise<{ id: string; sourceKey: string; metadataJson: string | null; title: string } | null> {
  if (!params.sessionId) return null;
  const candidates = await prisma.workspaceCapture.findMany({
    where: {
      workspaceId: params.workspaceId,
      status: { not: 'deleted' },
      contentType: { in: CLASSROOM_CONTENT_TYPES },
      sourceKey: { not: params.sourceKey },
      metadataJson: { contains: params.sessionId },
    },
    select: { id: true, sourceKey: true, metadataJson: true, title: true },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });
  return candidates.find((candidate) => readCaptureSessionId(parseCaptureMetadata(candidate.metadataJson)) === params.sessionId) || null;
}

/**
 * 决定这次写入最终落到哪个标题。
 * - 用户手改过（existingMetadata.titleSource === 'user'）→ 保留
 * - 新标题是零信息、旧标题有信息 → 保留旧的（迁移 / 检查点的占位不能把 AI 标题打回「课堂录音」）
 * - 其他情况用新标题（重导入补全、AI 改名都走这里）
 */
export function resolveCaptureTitle(params: {
  incomingTitle: string;
  existingTitle: string | null | undefined;
  existingMetadata: Record<string, unknown> | null | undefined;
}): string {
  const incoming = (params.incomingTitle || '').trim();
  const existing = (params.existingTitle || '').trim();
  if (!existing) return incoming;
  if (params.existingMetadata?.titleSource === 'user') return existing;
  if (isPlaceholderLessonTitle(incoming) && !isPlaceholderLessonTitle(existing)) return existing;
  return incoming || existing;
}

export interface CollapsibleCapture {
  id: string;
  sourceType: string;
  contentType: string;
  status: string;
  metadata: Record<string, unknown> | null;
  updatedAt: Date | string;
  createdAt: Date | string;
}

function collapseScore(item: CollapsibleCapture): number {
  let score = 0;
  if (item.metadata?.evidenceAvailable === true) score += 100;
  if (item.sourceType === 'live-audio') score += 10;
  if (item.metadata?.recordingState === 'recording') score += 5;
  return score;
}

function toMs(value: Date | string): number {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * 列表读取时按 sessionId 折叠双行：留下"最像这节课本体"的那一行。
 * 不改数据库——历史双行的清理是独立任务；这里只保证用户不再看到双卡。
 * 返回 keep 的 id 集合，调用方按此过滤（保持原顺序）。
 */
export function collapseDuplicateSessionCaptures<T extends CollapsibleCapture>(captures: T[]): T[] {
  const bySession = new Map<string, T>();
  const keep = new Set<string>();
  for (const capture of captures) {
    if (!CLASSROOM_CONTENT_TYPES.includes(capture.contentType)) {
      keep.add(capture.id);
      continue;
    }
    const sessionId = readCaptureSessionId(capture.metadata);
    if (!sessionId) {
      keep.add(capture.id);
      continue;
    }
    const current = bySession.get(sessionId);
    if (!current) {
      bySession.set(sessionId, capture);
      continue;
    }
    const currentScore = collapseScore(current);
    const nextScore = collapseScore(capture);
    const preferNext = nextScore > currentScore
      || (nextScore === currentScore && toMs(capture.updatedAt) > toMs(current.updatedAt));
    if (preferNext) bySession.set(sessionId, capture);
  }
  for (const capture of bySession.values()) keep.add(capture.id);
  return captures.filter((capture) => keep.has(capture.id));
}
