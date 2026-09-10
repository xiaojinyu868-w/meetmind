/**
 * 录课中的音频分片 (RecordingChunk) 数据库操作。
 *
 * 为什么存分片而不是每隔几秒重写整段 blob：一节 1 小时的课 ≈ 28MB，每 5 秒重写一次
 * 等于持续 5MB/s 的写放大；分片是纯追加，每片几十 KB。正常结束时最终 blob 落进
 * audioSessions 后就把分片删掉，只有「没结束」的课才需要拼回去。
 */

import { db, type RecordingChunk } from './schema';

function isValidSessionIdKey(sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && sessionId.trim().length > 0;
}

/** 追加一批分片（seq 由调用方保证递增；同一 seq 重复写入以后来者为准） */
export async function appendRecordingChunks(
  sessionId: string,
  chunks: Array<{ seq: number; blob: Blob; mimeType: string }>,
): Promise<number> {
  if (!isValidSessionIdKey(sessionId) || chunks.length === 0) return 0;
  const now = new Date();
  const rows: RecordingChunk[] = chunks
    .filter((chunk) => chunk.blob && chunk.blob.size > 0)
    .map((chunk) => ({
      sessionId,
      seq: chunk.seq,
      blob: chunk.blob,
      mimeType: chunk.mimeType,
      createdAt: now,
    }));
  if (rows.length === 0) return 0;
  await db.transaction('rw', db.recordingChunks, async () => {
    const seqs = rows.map((row) => row.seq);
    await db.recordingChunks
      .where('[sessionId+seq]')
      .anyOf(seqs.map((seq) => [sessionId, seq]))
      .delete();
    await db.recordingChunks.bulkAdd(rows);
  });
  return rows.length;
}

/** 把已落盘的分片按 seq 拼回一整段原声；没有分片返回 null */
export async function assembleRecordingBlob(
  sessionId: string,
): Promise<{ blob: Blob; mimeType: string; chunkCount: number } | null> {
  if (!isValidSessionIdKey(sessionId)) return null;
  const rows = await db.recordingChunks.where('sessionId').equals(sessionId).sortBy('seq');
  if (rows.length === 0) return null;
  const mimeType = rows[0].mimeType || rows[0].blob.type || 'audio/webm';
  const blob = new Blob(rows.map((row) => row.blob), { type: mimeType });
  return { blob, mimeType, chunkCount: rows.length };
}

/** 统计分片数（恢复条判断"有没有可收的原声"用） */
export async function countRecordingChunks(sessionId: string): Promise<number> {
  if (!isValidSessionIdKey(sessionId)) return 0;
  return db.recordingChunks.where('sessionId').equals(sessionId).count();
}

/** 删除一节课的全部分片（最终 blob 已落 audioSessions 之后调用） */
export async function deleteRecordingChunks(sessionId: string): Promise<number> {
  if (!isValidSessionIdKey(sessionId)) return 0;
  return db.recordingChunks.where('sessionId').equals(sessionId).delete();
}
