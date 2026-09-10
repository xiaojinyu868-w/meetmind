/**
 * 录课检查点（服务端，2026-09-10）。
 *
 * 录音期间客户端每分钟把「录制中」的这节课写一次到 Workspace：同一把 sourceKey
 * （live:{uid}:{sid}），metadata.recordingState='recording'，带已定稿的转录段。
 * 于是另一台设备在录课期间就能在列表里看到「录制中 · 已 12 分钟」，页面被关掉时
 * 服务端也已经握着这节课的大半内容——结束这节课只是把 recordingState 翻成 completed。
 *
 * 检查点不带 normalizedText / tutorContext：半节课的正文不该触发课后理解、也不该被
 * 同桌当成完整课堂引用；正文在结束时一并给。
 *
 * 超过 UNFINISHED_RECORDING_AUTO_FINALIZE_MS 没再收到检查点的「录制中」= 没人回来
 * （关机 / 换设备 / 忘了）：读列表时顺手翻成 completed，并用已有转录出一次标题 / 摘要。
 */

import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import workspaceContextService from '@/lib/services/workspace-context-service';
import {
  buildLiveRecordingCaptureInput,
  buildLiveRecordingTitle,
  isRecordingCheckpointStale,
  type LiveRecordingCaptureSegment,
} from '@/lib/capture/live-recording-capture';
import { parseCaptureMetadata, readCaptureSessionId } from '@/lib/services/workspace-capture-guards';
import {
  applyLessonUnderstanding,
  generateLessonUnderstanding,
} from '@/lib/services/lesson-understanding-service';
import { isGenericLessonTitle } from '@/lib/services/lesson-title-service';
import { runWithMeterContext } from '@/lib/services/point-meter';
import type { TranscriptSegment } from '@/types';

const log = createLogger('recording-checkpoint');

/** 单次检查点最多接受的分段数（与证据表防呆上限一致） */
export const MAX_CHECKPOINT_SEGMENTS = 10000;
/** 单次检查点请求体上限：1 小时课 ≈ 700 段 ≈ 120KB，2MB 足够 13 小时 */
export const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024;

export interface RecordingCheckpointInput {
  sessionId: string;
  /** 'checkpoint' 带分段快照；'heartbeat' 只更新时长 / 时刻（页面隐藏时 keepalive 发） */
  kind: 'checkpoint' | 'heartbeat';
  durationMs: number;
  startedAt?: string;
  title?: string;
  segments?: LiveRecordingCaptureSegment[];
  audioSource?: string;
}

function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,120}$/.test(value);
}

/** 请求体校验：只做形状与上限，不猜内容 */
export function parseRecordingCheckpointBody(body: unknown): RecordingCheckpointInput | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (!isValidSessionId(record.sessionId)) return null;
  const kind = record.kind === 'heartbeat' ? 'heartbeat' : 'checkpoint';
  const durationMs = typeof record.durationMs === 'number' && Number.isFinite(record.durationMs)
    ? Math.max(0, Math.round(record.durationMs))
    : 0;
  const rawSegments = Array.isArray(record.segments) ? record.segments.slice(0, MAX_CHECKPOINT_SEGMENTS) : [];
  const segments: LiveRecordingCaptureSegment[] = [];
  for (const item of rawSegments) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as Record<string, unknown>;
    const text = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (!text) continue;
    const startMs = typeof seg.startMs === 'number' && Number.isFinite(seg.startMs) ? Math.max(0, Math.round(seg.startMs)) : 0;
    const endMs = typeof seg.endMs === 'number' && Number.isFinite(seg.endMs) ? Math.max(startMs, Math.round(seg.endMs)) : startMs;
    segments.push({
      id: typeof seg.id === 'string' ? seg.id.slice(0, 120) : undefined,
      text: text.slice(0, 2000),
      startMs,
      endMs,
      speakerId: typeof seg.speakerId === 'string' ? seg.speakerId.slice(0, 40) : undefined,
      confidence: typeof seg.confidence === 'number' ? seg.confidence : undefined,
      isFinal: seg.isFinal !== false,
    });
  }
  return {
    sessionId: record.sessionId,
    kind,
    durationMs,
    startedAt: typeof record.startedAt === 'string' && !Number.isNaN(new Date(record.startedAt).getTime())
      ? record.startedAt
      : undefined,
    title: typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 80) : undefined,
    segments: kind === 'checkpoint' ? segments : [],
    audioSource: typeof record.audioSource === 'string' ? record.audioSource.slice(0, 20) : undefined,
  };
}

/**
 * 写一次检查点：复用 upsertCaptureForUser 的全部护栏（sessionId 去重 / 标题护栏 / metadata 合并 /
 * 证据单调递增）。heartbeat 不带 transcriptSegments 键，服务端已有的分段不会被动。
 */
export async function upsertRecordingCheckpoint(userId: string, input: RecordingCheckpointInput) {
  const startedAtMs = input.startedAt ? new Date(input.startedAt).getTime() : Date.now() - input.durationMs;
  const captureInput = buildLiveRecordingCaptureInput({
    userId,
    sessionId: input.sessionId,
    title: input.title || buildLiveRecordingTitle(new Date(startedAtMs)),
    segments: (input.segments || []) as TranscriptSegment[],
    durationMs: input.durationMs,
    state: 'recording',
    startedAtMs,
    extraMetadata: {
      ...(input.audioSource ? { audioSource: input.audioSource } : {}),
      checkpointKind: input.kind,
    },
  });
  const result = await workspaceContextService.upsertCaptureForUser(userId, captureInput);
  return { captureId: result.capture.id, sourceKey: result.capture.sourceKey };
}

/**
 * 把太久没有检查点的「录制中」capture 翻成已完成，并尽力出一次理解。
 * 在读工作区列表时调用；每个工作区一次最多处理 5 条，避免拖慢列表。
 */
export async function finalizeStaleRecordingCaptures(params: {
  workspaceId: string;
  userId: string;
  now?: number;
}): Promise<number> {
  const now = params.now ?? Date.now();
  const candidates = await prisma.workspaceCapture.findMany({
    where: {
      workspaceId: params.workspaceId,
      status: { not: 'deleted' },
      metadataJson: { contains: '"recordingState":"recording"' },
    },
    select: { id: true, title: true, metadataJson: true, occurredAt: true, createdAt: true, userId: true },
    orderBy: { updatedAt: 'asc' },
    take: 5,
  });

  let finalized = 0;
  for (const capture of candidates) {
    const metadata = parseCaptureMetadata(capture.metadataJson);
    if (metadata.recordingState !== 'recording') continue;
    if (!isRecordingCheckpointStale(typeof metadata.checkpointAt === 'string' ? metadata.checkpointAt : undefined, now)) continue;

    const sessionId = readCaptureSessionId(metadata) || capture.id;
    const segments = await prisma.workspaceTranscriptSegment.findMany({
      where: { captureId: capture.id },
      orderBy: { position: 'asc' },
      select: { text: true },
    });
    const transcriptSample = segments.map((segment) => segment.text.trim()).filter(Boolean).join(' ');

    await prisma.workspaceCapture.update({
      where: { id: capture.id },
      data: {
        metadataJson: JSON.stringify({
          ...metadata,
          recordingState: 'completed',
          finalizedBy: 'server-timeout',
          finalizedAt: new Date(now).toISOString(),
        }),
        ...(transcriptSample ? { normalizedText: transcriptSample.slice(0, 20000), tutorContext: transcriptSample.slice(0, 20000) } : {}),
      },
    });
    finalized += 1;
    log.info('stale recording capture finalized', { captureId: capture.id, sessionId, segments: segments.length });

    // 尽力出一次标题 / 摘要：没有时间锚点，精选片段留空（与 captures 路由的安全网同口径）
    const ownerId = capture.userId || params.userId;
    if (transcriptSample.length >= 80 && isGenericLessonTitle(capture.title)) {
      void (async () => {
        const understanding = await runWithMeterContext(
          { feature: 'understanding', userId: ownerId, refType: 'understanding', refId: capture.id },
          () => generateLessonUnderstanding({ transcriptSample }),
        );
        if (!understanding) return;
        await applyLessonUnderstanding({
          userId: ownerId,
          captureId: capture.id,
          sessionId,
          understanding: { ...understanding, highlights: [] },
          occurredAt: capture.occurredAt || capture.createdAt,
        });
      })().catch((error) => log.warn('stale recording understanding failed', { captureId: capture.id, error: String(error) }));
    }
  }
  return finalized;
}
