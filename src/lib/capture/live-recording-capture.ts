/**
 * 现场录音 → Workspace capture 的唯一 payload 真相（2026-09-10）。
 *
 * 一节录下来的课在服务端只应有一行 capture，而它会被四个时刻写到：
 *   录课中检查点（每分钟）→ 结束这节课 → 原声上传成功回写 mediaUrl → 忘记结束后的「就到这里」。
 * 四处都从这里拿 sourceKey 与 metadata 形状，服务端才能按 sourceKey 幂等 upsert，
 * 另一台设备才能凭 metadata.sessionId / recordingState 把它认成同一节课。
 *
 * sourceKey 用 userId + sessionId 而不是结束时随机生成的 audio-xxx：录课一开始就要能写，
 * 而 sessionId 只保证同用户内唯一（session-<ms>），全局唯一键还得带上 userId。
 * 旧数据的 live:audio-xxx 键继续有效，服务端另有按 sessionId 的去重护栏。
 */

import type { TranscriptSegment } from '@/types';
import { compactText } from '@/lib/utils/page/text-and-constants';

export const LIVE_RECORDING_SOURCE_TYPE = 'live-audio';
export type LiveRecordingState = 'recording' | 'completed';

/** 服务端 / 本机判定「没人回来」的时限：超过就按「就到这里」自动收尾 */
export const UNFINISHED_RECORDING_AUTO_FINALIZE_MS = 6 * 60 * 60 * 1000;

/** 与服务端证据表的防呆上限一致（句级密度约 12 段/分钟，10000 段 ≈ 13 小时） */
const MAX_SEGMENTS = 10000;

export function buildLiveCaptureSourceKey(userId: string, sessionId: string): string {
  return `live:${userId}:${sessionId}`;
}

/** 结束前还没有 AI 标题时的占位：与旧 stop 路径一致的「录音 HH:MM」，课后理解会改名 */
export function buildLiveRecordingTitle(startedAt: Date = new Date()): string {
  return `录音 ${startedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

export interface LiveRecordingCaptureSegment {
  id?: string;
  text: string;
  startMs: number;
  endMs: number;
  speakerId?: string;
  confidence?: number;
  isFinal?: boolean;
}

export interface LiveRecordingCaptureInput {
  sourceType: string;
  sourceKey: string;
  role: 'primary';
  contentType: 'audio';
  title: string;
  previewText?: string;
  normalizedText?: string;
  tutorContext?: string;
  mediaUrl?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

function toPortableSegments(segments: TranscriptSegment[]): LiveRecordingCaptureSegment[] {
  return segments
    .filter((seg) => typeof seg.text === 'string' && seg.text.trim() && !seg.provisional)
    .slice(0, MAX_SEGMENTS)
    .map((seg) => ({
      id: seg.id,
      text: seg.text,
      startMs: seg.startMs,
      endMs: seg.endMs,
      speakerId: seg.speakerId,
      confidence: seg.confidence,
      isFinal: seg.isFinal !== false,
    }));
}

function joinSegmentText(segments: TranscriptSegment[], maxLength: number): string {
  return compactText(
    segments.map((seg) => (seg.text || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' '),
    maxLength,
  );
}

/**
 * 组装写 capture 的请求体。
 *
 * - state='recording'（检查点）：不带 normalizedText / tutorContext——它们是"这节课的正文"，
 *   半节课的正文会触发服务端 45s 课后理解安全网、也会被同桌当成完整课堂引用；只带 previewText 供列表。
 * - state='completed'：正文与 tutorContext 一起给，服务端据此出标题 / 摘要。
 * - segments 为空时不放 transcriptSegments 键：服务端按"没带分段"处理，绝不用空数组把已有证据删掉。
 */
export function buildLiveRecordingCaptureInput(params: {
  userId: string;
  sessionId: string;
  title: string;
  segments: TranscriptSegment[];
  durationMs: number;
  state: LiveRecordingState;
  startedAtMs?: number;
  mediaUrl?: string;
  audioUploaded?: boolean;
  /** 「继续录」开出的新一段：记住它接在哪一节后面 */
  continuationOf?: string;
  extraMetadata?: Record<string, unknown>;
}): LiveRecordingCaptureInput {
  const portable = toPortableSegments(params.segments);
  const durationMs = Math.max(0, Math.round(params.durationMs || 0));
  const startedAtMs = typeof params.startedAtMs === 'number' && params.startedAtMs > 0
    ? params.startedAtMs
    : Date.now() - durationMs;
  const metadata: Record<string, unknown> = {
    from: 'live-recording',
    sessionId: params.sessionId,
    duration: durationMs,
    durationSec: Math.round(durationMs / 1000),
    recordingState: params.state,
    checkpointAt: new Date().toISOString(),
    ...(params.audioUploaded ? { audioUploaded: true } : {}),
    ...(params.continuationOf ? { continuationOf: params.continuationOf } : {}),
    ...(params.extraMetadata || {}),
  };
  // 没带分段的写入（原声回写 / 心跳）不放 segmentCount，服务端合并 metadata 时才不会把已有计数清成 0
  if (portable.length > 0) {
    metadata.segmentCount = portable.length;
    metadata.transcriptSegments = portable;
  }

  const previewText = joinSegmentText(params.segments, 180);
  const body: LiveRecordingCaptureInput = {
    sourceType: LIVE_RECORDING_SOURCE_TYPE,
    sourceKey: buildLiveCaptureSourceKey(params.userId, params.sessionId),
    role: 'primary',
    contentType: 'audio',
    title: params.title,
    previewText: previewText || undefined,
    mediaUrl: params.mediaUrl,
    occurredAt: new Date(startedAtMs).toISOString(),
    metadata,
  };
  if (params.state === 'completed' && portable.length > 0) {
    const fullText = joinSegmentText(params.segments, 2800);
    body.normalizedText = fullText;
    body.tutorContext = fullText;
  }
  return body;
}

/** 服务端 capture metadata 里的录制态（缺省 = 旧数据 = 已完成） */
export function readRecordingState(metadata: Record<string, unknown> | null | undefined): LiveRecordingState {
  return metadata?.recordingState === 'recording' ? 'recording' : 'completed';
}

/** 检查点是不是已经"太久没人回来"：没有时间戳按 0 算（一定过期） */
export function isRecordingCheckpointStale(
  checkpointAt: Date | string | number | null | undefined,
  now: number = Date.now(),
  limitMs: number = UNFINISHED_RECORDING_AUTO_FINALIZE_MS,
): boolean {
  const ts = checkpointAt instanceof Date
    ? checkpointAt.getTime()
    : typeof checkpointAt === 'number'
      ? checkpointAt
      : checkpointAt
        ? new Date(checkpointAt).getTime()
        : 0;
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return now - ts > limitMs;
}
