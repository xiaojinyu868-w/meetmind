/**
 * 录音原声后台自愈上传。
 *
 * 录音停止时的首次上传可能因切后台、断网或页面关闭失败。原始 Blob 仍在 IndexedDB，
 * 下次进入课堂时顺序重试少量 session；失败不标记完成，后续页面生命周期仍可再试。
 */

import { db, getSessionTranscripts, setSessionSyncState } from '@/lib/db';
import type { AudioSession } from '@/lib/db/schema';
import { uploadRecordingAudio } from '@/lib/services/upload-recording-audio';
import {
  buildLiveRecordingCaptureInput,
  buildLiveRecordingTitle,
} from '@/lib/capture/live-recording-capture';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';
import type { TranscriptSegment } from '@/types';

const MIN_UPLOAD_BYTES = 8 * 1024;
const uploadedSessionIds = new Set<string>();

export function isPendingRecordingUpload(session: AudioSession): boolean {
  if (session.status !== 'completed') return false;
  // 早期版本的本地录音没有 sourceType；明确的 upload / video 则不应当重复备份。
  if (session.sourceType && session.sourceType !== 'recording') return false;
  if (!session.blob || session.blob.size < MIN_UPLOAD_BYTES) return false;
  const mediaUrl = session.mediaUrl?.trim() || '';
  if (!mediaUrl || mediaUrl.startsWith('blob:') || mediaUrl.startsWith('data:')) return true;
  return false;
}

export interface RecordingUploadRetryResult {
  scanned: number;
  attempted: number;
  uploaded: number;
  failed: number;
}

export async function retryPendingRecordingUploads(
  authToken: string,
  limit = 2,
): Promise<RecordingUploadRetryResult> {
  const result: RecordingUploadRetryResult = { scanned: 0, attempted: 0, uploaded: 0, failed: 0 };
  if (!authToken) return result;

  let sessions: AudioSession[];
  try {
    sessions = await db.audioSessions.where('status').equals('completed').toArray();
  } catch {
    return result;
  }
  result.scanned = sessions.length;

  const candidates = sessions
    .filter(isPendingRecordingUpload)
    .filter((session) => !uploadedSessionIds.has(session.sessionId))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, Math.max(0, limit));

  for (const session of candidates) {
    if (!session.blob) continue;
    result.attempted += 1;
    const outcome = await uploadRecordingAudio({
      blob: session.blob,
      sessionId: session.sessionId,
      authToken,
    });
    if (outcome.ok) {
      uploadedSessionIds.add(session.sessionId);
      result.uploaded += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
}

export function __resetRecordingUploadRetryGuard(): void {
  uploadedSessionIds.clear();
}

// ── 结束时写服务端 capture 失败的课：按本地数据补传（2026-09-10 录课不丢） ──

/** 单次 sweep 最多重试的课数；pending 卡住超过这个时间视为可重试（POST 正常几秒内完成） */
const MAX_CAPTURE_SYNC_PER_SWEEP = 3;
const PENDING_SYNC_STUCK_AFTER_MS = 60_000;
const captureSyncInFlight = new Set<string>();

export interface PendingCaptureSyncResult {
  scanned: number;
  attempted: number;
  synced: number;
  failed: number;
}

/**
 * 需要补传服务端 capture 的课：登录用户结束时 POST 失败（syncState=failed）或一直卡在 pending
 * （页面在 POST 返回前被关）。访客 / 旧数据（syncState undefined）不在此列——它们走登录迁移。
 */
export function isPendingCaptureSync(session: AudioSession, now = Date.now()): boolean {
  if (session.status !== 'completed') return false;
  if (session.syncState === 'failed') return true;
  if (session.syncState !== 'pending') return false;
  const updatedAt = session.updatedAt instanceof Date ? session.updatedAt.getTime() : new Date(session.updatedAt).getTime();
  return !Number.isFinite(updatedAt) || now - updatedAt > PENDING_SYNC_STUCK_AFTER_MS;
}

/**
 * 把 syncState 为 failed / 卡住的 pending 的课按本地转录重新写到服务端（同一把 sourceKey，幂等）。
 * 进课堂、恢复联网、页面回前台时各跑一次；成功标 synced，失败标 failed 留给下次。
 */
export async function syncPendingRecordings(
  authToken: string,
  userId: string,
): Promise<PendingCaptureSyncResult> {
  const result: PendingCaptureSyncResult = { scanned: 0, attempted: 0, synced: 0, failed: 0 };
  if (!authToken || !userId) return result;

  let sessions: AudioSession[];
  try {
    sessions = await db.audioSessions.where('status').equals('completed').toArray();
  } catch {
    return result;
  }
  result.scanned = sessions.length;

  const candidates = sessions
    .filter((session) => isPendingCaptureSync(session))
    .filter((session) => !captureSyncInFlight.has(session.sessionId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MAX_CAPTURE_SYNC_PER_SWEEP);

  for (const session of candidates) {
    captureSyncInFlight.add(session.sessionId);
    result.attempted += 1;
    try {
      const transcripts = (await getSessionTranscripts(session.sessionId)).sort((a, b) => a.startMs - b.startMs);
      const segments: TranscriptSegment[] = transcripts.map((item, index) => ({
        id: `sync-${item.startMs}-${index}`,
        text: item.text,
        startMs: item.startMs,
        endMs: item.endMs,
        speakerId: item.speakerId,
        confidence: item.confidence,
        isFinal: true,
      }));
      const startedAt = session.createdAt instanceof Date ? session.createdAt : new Date(session.createdAt);
      const durationMs = Math.max(session.duration || 0, segments[segments.length - 1]?.endMs || 0);
      const body = buildLiveRecordingCaptureInput({
        userId,
        sessionId: session.sessionId,
        title: session.topic && !isPlaceholderLessonTitle(session.topic) ? session.topic : buildLiveRecordingTitle(startedAt),
        segments,
        durationMs,
        state: 'completed',
        startedAtMs: startedAt.getTime(),
        mediaUrl: session.mediaUrl && !session.mediaUrl.startsWith('blob:') ? session.mediaUrl : undefined,
        extraMetadata: { finalizedBy: 'client-retry' },
      });
      const response = await fetch('/api/workspace/captures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { success?: boolean } | null;
      if (!response.ok || !payload?.success) throw new Error(`capture ${response.status}`);
      await setSessionSyncState(session.sessionId, 'synced');
      result.synced += 1;
    } catch (error) {
      await setSessionSyncState(session.sessionId, 'failed', error instanceof Error ? error.message : String(error)).catch(() => undefined);
      result.failed += 1;
    } finally {
      captureSyncInFlight.delete(session.sessionId);
    }
  }

  return result;
}
