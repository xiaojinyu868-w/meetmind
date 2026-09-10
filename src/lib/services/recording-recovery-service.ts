/**
 * 没结束的课怎么收（2026-09-10 录课不丢）。
 *
 * 页面被关 / 崩溃 / 被系统回收后，IndexedDB 里留着：audioSessions 占位行（status 仍是 recording）、
 * 录课中检查点写下的 transcripts 快照与 recordingChunks 音频分片。这里把它们收成一节正常的课：
 *   1. 分片按 seq 拼回一整段原声 → 与转录一起落 audioSessions（status → completed）
 *   2. 有原声没文字 → 交给 retranscribeStuckSessions 兜底批量转写（它认「completed + blob + 0 段 + 无状态标记」）
 *   3. 登录用户：同一把 sourceKey 写服务端 capture（recordingState=completed）→ 上传原声 → 课后理解
 *      写服务端失败只标 syncState=failed，sync-pending-recordings 会再补
 *   4. 什么都没录下来的占位（0 秒、无分片、无文字）直接删掉，不留一张永远「正在整理」的空卡
 *
 * 「继续录」= 先按这里收好前半段，再由调用方开一段新的录音（两段各自成课；原声容器无法无缝接续）。
 */

import {
  assembleRecordingBlob,
  deleteRecordingChunks,
  deleteSession,
  getSessionById,
  getSessionTranscripts,
  saveAudioSession,
  setSessionSyncState,
  ANONYMOUS_USER_ID,
} from '@/lib/db';
import type { AudioSession } from '@/lib/db/schema';
import {
  buildLiveRecordingCaptureInput,
  buildLiveRecordingTitle,
} from '@/lib/capture/live-recording-capture';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';
import { uploadRecordingAudio } from '@/lib/services/upload-recording-audio';
import { requestLessonUnderstanding } from '@/lib/services/lesson-title-client';
import { retranscribeStuckSessions } from '@/lib/services/retranscribe-stuck-sessions';
import type { TranscriptSegment } from '@/types';

export interface FinalizeUnfinishedRecordingResult {
  sessionId: string;
  /** 占位里什么都没有，行已删除 */
  discarded: boolean;
  durationMs: number;
  segmentCount: number;
  hasAudio: boolean;
  /** 服务端 capture id（登录且写成功时） */
  captureId?: string;
  syncState?: 'synced' | 'failed' | 'skipped';
  /** 课后理解改出的新标题（有则调用方同步 UI） */
  title?: string;
}

function toDate(value: Date | string | number | undefined): Date {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** 恢复条 / 自动收尾共用：这节课"已录多久"的最佳估计 */
export function resolveUnfinishedDurationMs(session: AudioSession, lastSegmentEndMs = 0): number {
  return Math.max(
    session.lastCheckpointDurationMs || 0,
    session.duration || 0,
    lastSegmentEndMs,
  );
}

/** 把服务端 capture 写请求发出去（不经 hook：恢复条可能在没有 Recorder 的页面生命周期里执行） */
async function postCapture(
  accessToken: string,
  body: ReturnType<typeof buildLiveRecordingCaptureInput>,
): Promise<string | undefined> {
  const response = await fetch('/api/workspace/captures', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { success?: boolean; capture?: { id: string } } | null;
  if (!response.ok || !payload?.success || !payload.capture?.id) {
    throw new Error(`capture ${response.status}`);
  }
  return payload.capture.id;
}

export async function finalizeUnfinishedRecording(params: {
  sessionId: string;
  userId?: string | null;
  accessToken?: string | null;
}): Promise<FinalizeUnfinishedRecordingResult> {
  const { sessionId } = params;
  const userId = params.userId || ANONYMOUS_USER_ID;
  const session = await getSessionById(sessionId);
  let transcripts = (await getSessionTranscripts(sessionId)).sort((a, b) => a.startMs - b.startMs);
  const assembled = await assembleRecordingBlob(sessionId).catch(() => null);
  const lastEndMs = transcripts[transcripts.length - 1]?.endMs || 0;
  const durationMs = session ? resolveUnfinishedDurationMs(session, lastEndMs) : lastEndMs;

  if (!session) {
    return { sessionId, discarded: true, durationMs: 0, segmentCount: 0, hasAudio: false };
  }

  // 占位里什么都没有：不是用户的内容，别留一张永远「正在整理」的空卡
  if (!assembled && transcripts.length === 0 && durationMs === 0) {
    await deleteSession(sessionId);
    return { sessionId, discarded: true, durationMs: 0, segmentCount: 0, hasAudio: false };
  }

  await saveAudioSession(assembled?.blob ?? null, sessionId, userId, {
    duration: durationMs,
    sourceType: 'recording',
    mimeType: assembled?.mimeType,
    transcriptionStatus: transcripts.length > 0
      ? 'completed'
      : assembled
        ? undefined // 有原声没文字：下面立刻交给 retranscribeStuckSessions 兜底批量转写
        : 'failed',
    transcriptionError: transcripts.length > 0 || assembled ? undefined : '这节课没有留下可用内容',
  });
  if (assembled) await deleteRecordingChunks(sessionId).catch(() => 0);

  if (transcripts.length === 0 && assembled) {
    // 有原声没文字（实时字幕一句没接住就被关页）：先把原声转出来再往服务端写，
    // 否则另一台设备拿到的是一节 0 段的空课。force 跳过 page-lifetime 幂等，因为这是用户动作触发的。
    await retranscribeStuckSessions('auto', true).catch(() => undefined);
    transcripts = (await getSessionTranscripts(sessionId)).sort((a, b) => a.startMs - b.startMs);
  }

  const segments: TranscriptSegment[] = transcripts.map((item, index) => ({
    id: `recovered-${item.startMs}-${index}`,
    text: item.text,
    startMs: item.startMs,
    endMs: item.endMs,
    speakerId: item.speakerId,
    confidence: item.confidence,
    isFinal: true,
  }));

  const result: FinalizeUnfinishedRecordingResult = {
    sessionId,
    discarded: false,
    durationMs,
    segmentCount: segments.length,
    hasAudio: Boolean(assembled),
    syncState: 'skipped',
  };

  const canSync = userId !== ANONYMOUS_USER_ID && Boolean(params.accessToken);
  if (!canSync) return result;
  const accessToken = params.accessToken as string;

  const startedAt = toDate(session.createdAt);
  const title = session.topic && !isPlaceholderLessonTitle(session.topic)
    ? session.topic
    : buildLiveRecordingTitle(startedAt);

  await setSessionSyncState(sessionId, 'pending').catch(() => undefined);
  try {
    const captureId = await postCapture(accessToken, buildLiveRecordingCaptureInput({
      userId,
      sessionId,
      title,
      segments,
      durationMs,
      state: 'completed',
      startedAtMs: startedAt.getTime(),
      extraMetadata: { finalizedBy: 'client-recovery' },
    }));
    result.captureId = captureId;
    result.syncState = 'synced';
    await setSessionSyncState(sessionId, 'synced').catch(() => undefined);

    if (assembled) {
      // upload-audio 按 userId + sessionId 把 mediaUrl 绑回刚写好的 capture
      void uploadRecordingAudio({ blob: assembled.blob, sessionId, authToken: accessToken }).catch(() => undefined);
    }
    if (captureId && segments.length > 0) {
      result.title = await requestLessonUnderstanding({
        sessionId,
        captureId,
        segments,
        occurredAtMs: startedAt.getTime(),
        accessToken,
      }).catch(() => undefined);
    }
  } catch (error) {
    result.syncState = 'failed';
    await setSessionSyncState(sessionId, 'failed', error instanceof Error ? error.message : String(error)).catch(() => undefined);
  }
  return result;
}
