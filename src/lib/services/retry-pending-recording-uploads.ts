/**
 * 录音原声后台自愈上传。
 *
 * 录音停止时的首次上传可能因切后台、断网或页面关闭失败。原始 Blob 仍在 IndexedDB，
 * 下次进入课堂时顺序重试少量 session；失败不标记完成，后续页面生命周期仍可再试。
 */

import { db } from '@/lib/db';
import type { AudioSession } from '@/lib/db/schema';
import { uploadRecordingAudio } from '@/lib/services/upload-recording-audio';

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
