/**
 * 浏览器端按需恢复 Workspace 课堂证据。
 *
 * capture 列表只返回轻量索引；用户首次在新设备打开课堂时，才读取完整证据并
 * 复用 backfill 管线写回 IndexedDB。相同 capture 的并发请求会自动合并。
 */

import { backfillCapturesToIndexedDB } from '@/lib/services/backfill-captures-to-indexeddb';
import type { WorkspaceCaptureMessage } from '@/types/page-types';

export interface WorkspaceEvidenceClientPayload {
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
}

const pendingEvidenceRequests = new Map<string, Promise<WorkspaceEvidenceClientPayload>>();

function buildPortableCapture(evidence: WorkspaceEvidenceClientPayload): WorkspaceCaptureMessage {
  return {
    id: evidence.captureId,
    sourceKey: `evidence:${evidence.captureId}`,
    sourceType: evidence.sourceType,
    status: 'active',
    role: 'primary',
    contentType: evidence.contentType,
    title: evidence.title,
    previewText: evidence.title,
    sourceUrl: evidence.sourceUrl,
    mediaUrl: evidence.mediaUrl,
    occurredAt: evidence.occurredAt,
    createdAt: evidence.occurredAt,
    metadata: {
      ...evidence.metadata,
      sessionId: evidence.sessionId,
      duration: evidence.durationMs,
      transcriptSegments: evidence.segments,
      anchors: evidence.anchors,
      classSummary: evidence.classSummary,
      highlightTopics: evidence.highlightTopics,
      notes: evidence.notes,
    },
  };
}

async function requestEvidence(params: {
  captureId: string;
  accessToken: string;
  userId: string;
}): Promise<WorkspaceEvidenceClientPayload> {
  const response = await fetch(`/api/workspace/captures/${encodeURIComponent(params.captureId)}/evidence`, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const payload = await response.json().catch(() => null) as {
    success?: boolean;
    evidence?: WorkspaceEvidenceClientPayload;
    error?: string;
  } | null;
  if (!response.ok || !payload?.success || !payload.evidence) {
    throw new Error(payload?.error || '读取课堂证据失败');
  }

  await backfillCapturesToIndexedDB([buildPortableCapture(payload.evidence)], params.userId, true);
  return payload.evidence;
}

export function fetchAndBackfillWorkspaceEvidence(params: {
  captureId: string;
  accessToken: string;
  userId: string;
}): Promise<WorkspaceEvidenceClientPayload> {
  const key = `${params.userId}:${params.captureId}`;
  const pending = pendingEvidenceRequests.get(key);
  if (pending) return pending;

  const request = requestEvidence(params).finally(() => {
    pendingEvidenceRequests.delete(key);
  });
  pendingEvidenceRequests.set(key, request);
  return request;
}
