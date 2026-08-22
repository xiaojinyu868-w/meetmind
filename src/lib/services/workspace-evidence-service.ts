/**
 * Workspace 课堂证据正规化存储。
 *
 * capture 列表只携带轻量元数据；完整转录和课堂产物按 capture 懒加载。
 * 同步输入沿用现有 portable bundle，便于旧客户端渐进升级。
 */

import prisma from '@/lib/prisma';

export const WORKSPACE_EVIDENCE_METADATA_KEYS = [
  'transcriptSegments',
  'anchors',
  'classSummary',
  'highlightTopics',
  'notes',
] as const;

interface NormalizedEvidenceSegment {
  segmentKey: string;
  position: number;
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
  confidence?: number;
  isFinal: boolean;
}

export interface WorkspaceCaptureEvidencePayload {
  captureId: string;
  sessionId: string;
  sourceType: string;
  contentType: string;
  title: string;
  sourceUrl?: string;
  mediaUrl?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
  durationMs: number;
  segments: Array<{
    id?: string;
    text: string;
    startMs: number;
    endMs: number;
    speakerId?: string;
    confidence?: number;
    isFinal?: boolean;
  }>;
  anchors: unknown[];
  classSummary?: Record<string, unknown>;
  highlightTopics: unknown[];
  notes: unknown[];
  /** 课中「截取这一页」主动截图（payload: { mediaUrl, timestampSec }） */
  keyframes: unknown[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseMetadataJson(value?: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return asRecord(JSON.parse(value)) || {};
  } catch {
    return {};
  }
}

function getSessionId(metadata: Record<string, unknown>): string {
  const value = typeof metadata.sessionId === 'string'
    ? metadata.sessionId
    : typeof metadata.localSessionId === 'string'
      ? metadata.localSessionId
      : '';
  return value.trim();
}

function normalizeSegments(
  metadata: Record<string, unknown>,
  normalizedText?: string | null,
): NormalizedEvidenceSegment[] {
  // 句级分段密度约 12 段/分钟：6 小时长音频约 4300 段，上限留足余量防呆即可，
  // 不能再出现 100 分钟播客被砍掉最后几分钟的情况。
  const rawSegments = Array.isArray(metadata.transcriptSegments)
    ? metadata.transcriptSegments.slice(0, 10000)
    : [];
  const segments = rawSegments.flatMap((item, position) => {
    const segment = asRecord(item);
    const text = typeof segment?.text === 'string' ? segment.text.trim() : '';
    if (!segment || !text) return [];
    const startMs = typeof segment.startMs === 'number' ? Math.max(0, Math.round(segment.startMs)) : 0;
    const endMs = typeof segment.endMs === 'number' ? Math.max(startMs, Math.round(segment.endMs)) : startMs;
    const incomingId = typeof segment.id === 'string' ? segment.id.trim() : '';
    return [{
      segmentKey: incomingId ? `${incomingId}:${position}` : `${startMs}:${endMs}:${position}`,
      position,
      startMs,
      endMs,
      text,
      speakerId: typeof segment.speakerId === 'string' ? segment.speakerId : undefined,
      confidence: typeof segment.confidence === 'number' ? segment.confidence : undefined,
      isFinal: segment.isFinal !== false,
    }];
  });
  if (segments.length > 0) return segments;

  const fallbackText = normalizedText?.trim();
  if (!fallbackText) return [];
  const durationMs = typeof metadata.duration === 'number'
    ? Math.max(1, Math.round(metadata.duration))
    : typeof metadata.durationSec === 'number'
      ? Math.max(1, Math.round(metadata.durationSec * 1000))
      : 1;
  return [{
    segmentKey: 'legacy-normalized-text',
    position: 0,
    startMs: 0,
    endMs: durationMs,
    text: fallbackText,
    confidence: 0.8,
    isFinal: true,
  }];
}

function collectArtifacts(metadata: Record<string, unknown>, sessionId: string) {
  const artifacts: Array<{
    sessionId: string;
    kind: string;
    artifactKey: string;
    payloadJson: string;
  }> = [];

  const appendArray = (kind: string, value: unknown, keyField: string) => {
    if (!Array.isArray(value)) return;
    value.forEach((item, index) => {
      const record = asRecord(item);
      if (!record) return;
      const stableKey = typeof record[keyField] === 'string' && record[keyField]
        ? String(record[keyField])
        : kind === 'anchor' && typeof record.timestamp === 'number'
          ? `${record.timestamp}:${String(record.type || 'confusion')}:${index}`
          : String(index);
      artifacts.push({ sessionId, kind, artifactKey: stableKey, payloadJson: JSON.stringify(record) });
    });
  };

  appendArray('anchor', metadata.anchors, 'anchorId');
  appendArray('highlight', metadata.highlightTopics, 'topicId');
  appendArray('note', metadata.notes, 'noteId');
  const summary = asRecord(metadata.classSummary);
  if (summary) {
    artifacts.push({
      sessionId,
      kind: 'summary',
      artifactKey: typeof summary.summaryId === 'string' ? summary.summaryId : 'summary',
      payloadJson: JSON.stringify(summary),
    });
  }
  return artifacts;
}

/** 写 capture 时同步正规化证据；输入是已经与旧 metadata 合并后的完整值。 */
export async function syncWorkspaceCaptureEvidence(params: {
  captureId: string;
  metadata: Record<string, unknown>;
  normalizedText?: string | null;
}): Promise<boolean> {
  const sessionId = getSessionId(params.metadata);
  if (!sessionId) return false;
  const owns = (key: typeof WORKSPACE_EVIDENCE_METADATA_KEYS[number]) => (
    Object.prototype.hasOwnProperty.call(params.metadata, key)
  );
  const ownsSegments = owns('transcriptSegments');
  const segments = normalizeSegments(params.metadata, params.normalizedText);

  // 证据单调递增护栏：分段表只许「补全」，不许「回退」。
  // 客户端持久化只带 500 段快照 + normalizedText 摘要片段，而服务端可能已有
  // enrich 管线写入的全量分段——没有这道护栏，一次轻量回刷就会把全量证据
  // 删成 1 条整段兜底（真实案例：100 分钟播客 752 段被回刷成 1 段）。
  let replaceSegments = ownsSegments || params.metadata.evidenceAvailable !== true;
  if (replaceSegments) {
    const existingCount = await prisma.workspaceTranscriptSegment.count({
      where: { captureId: params.captureId },
    });
    if (ownsSegments) {
      // 显式带分段：只允许同等或更完整的覆盖（重导入补全场景放行）
      if (existingCount > 1 && segments.length < existingCount) replaceSegments = false;
    } else if (existingCount > 0) {
      // 没带分段 = normalizedText 兜底单段：只允许补空表，永不覆盖已有分段
      replaceSegments = false;
    }
  }
  const artifacts = collectArtifacts(params.metadata, sessionId);
  const artifactKindsToReplace = [
    owns('anchors') ? 'anchor' : null,
    owns('classSummary') ? 'summary' : null,
    owns('highlightTopics') ? 'highlight' : null,
    owns('notes') ? 'note' : null,
  ].filter((kind): kind is string => Boolean(kind));

  await prisma.$transaction(async (tx) => {
    if (replaceSegments) {
      await tx.workspaceTranscriptSegment.deleteMany({ where: { captureId: params.captureId } });
      if (segments.length > 0) {
        await tx.workspaceTranscriptSegment.createMany({
          data: segments.map((segment) => ({
            captureId: params.captureId,
            sessionId,
            ...segment,
          })),
        });
      }
    }

    if (artifactKindsToReplace.length > 0) {
      await tx.workspaceCaptureArtifact.deleteMany({
        where: { captureId: params.captureId, kind: { in: artifactKindsToReplace } },
      });
    }
    const replacementArtifacts = artifacts.filter((artifact) => artifactKindsToReplace.includes(artifact.kind));
    if (replacementArtifacts.length > 0) {
      await tx.workspaceCaptureArtifact.createMany({
        data: replacementArtifacts.map((artifact) => ({ captureId: params.captureId, ...artifact })),
      });
    }
  });
  return segments.length > 0 || artifacts.length > 0 || params.metadata.evidenceAvailable === true;
}

/** 当前列表输出只保留证据索引，完整 payload 通过 evidence endpoint 懒加载。 */
export function toLightweightEvidenceMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const result = { ...metadata };
  const evidenceAvailable = metadata.evidenceAvailable === true || WORKSPACE_EVIDENCE_METADATA_KEYS.some((key) => (
    key === 'classSummary'
      ? Boolean(asRecord(metadata[key]))
      : Array.isArray(metadata[key]) && (metadata[key] as unknown[]).length > 0
  ));
  for (const key of WORKSPACE_EVIDENCE_METADATA_KEYS) delete result[key];
  if (evidenceAvailable) result.evidenceAvailable = true;
  return result;
}

function parseArtifactPayload(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

export async function getWorkspaceCaptureEvidenceForUser(
  userId: string,
  captureId: string,
): Promise<WorkspaceCaptureEvidencePayload | null> {
  const capture = await prisma.workspaceCapture.findFirst({
    where: {
      id: captureId,
      status: { not: 'deleted' },
      workspace: { members: { some: { userId, status: 'active' } } },
    },
    include: {
      transcriptSegments: { orderBy: { position: 'asc' } },
      artifacts: { orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!capture) return null;

  const metadata = parseMetadataJson(capture.metadataJson);
  const sessionId = capture.transcriptSegments[0]?.sessionId
    || capture.artifacts[0]?.sessionId
    || getSessionId(metadata);
  if (!sessionId) return null;

  const tableSegments = capture.transcriptSegments.map((segment) => ({
    id: segment.segmentKey,
    text: segment.text,
    startMs: segment.startMs,
    endMs: segment.endMs,
    speakerId: segment.speakerId || undefined,
    confidence: segment.confidence ?? undefined,
    isFinal: segment.isFinal,
  }));
  const fallbackSegments = normalizeSegments(metadata, capture.normalizedText).map((segment) => ({
    id: segment.segmentKey,
    text: segment.text,
    startMs: segment.startMs,
    endMs: segment.endMs,
    speakerId: segment.speakerId,
    confidence: segment.confidence,
    isFinal: segment.isFinal,
  }));

  const artifactsByKind = new Map<string, Record<string, unknown>[]>();
  for (const artifact of capture.artifacts) {
    const payload = parseArtifactPayload(artifact.payloadJson);
    if (!payload) continue;
    const bucket = artifactsByKind.get(artifact.kind) || [];
    bucket.push(payload);
    artifactsByKind.set(artifact.kind, bucket);
  }
  const summaryFromTable = artifactsByKind.get('summary')?.[0];
  const durationMs = typeof metadata.duration === 'number'
    ? metadata.duration
    : typeof metadata.durationSec === 'number'
      ? metadata.durationSec * 1000
      : (tableSegments.length > 0 ? tableSegments.at(-1)?.endMs : fallbackSegments.at(-1)?.endMs) || 0;

  return {
    captureId: capture.id,
    sessionId,
    sourceType: capture.sourceType,
    contentType: capture.contentType,
    title: capture.title,
    sourceUrl: capture.sourceUrl || undefined,
    mediaUrl: capture.mediaUrl || undefined,
    occurredAt: (capture.occurredAt || capture.createdAt).toISOString(),
    metadata: toLightweightEvidenceMetadata(metadata) || {},
    durationMs,
    segments: tableSegments.length > 0 ? tableSegments : fallbackSegments,
    anchors: artifactsByKind.get('anchor') || (Array.isArray(metadata.anchors) ? metadata.anchors : []),
    classSummary: summaryFromTable || asRecord(metadata.classSummary) || undefined,
    highlightTopics: artifactsByKind.get('highlight') || (Array.isArray(metadata.highlightTopics) ? metadata.highlightTopics : []),
    notes: artifactsByKind.get('note') || (Array.isArray(metadata.notes) ? metadata.notes : []),
    keyframes: artifactsByKind.get('keyframe') || [],
  };
}
