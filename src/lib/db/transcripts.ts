/**
 * 转录片段 (TranscriptSegment) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type TranscriptSegment } from './schema';

/** 添加转录片段 */
export async function addTranscript(
  sessionId: string,
  userId: string,
  text: string,
  startMs: number,
  endMs: number,
  options: { speakerId?: string; confidence?: number; isFinal?: boolean } = {}
): Promise<number> {
  return db.transcripts.add({
    sessionId,
    userId,
    text,
    startMs,
    endMs,
    speakerId: options.speakerId,
    confidence: options.confidence ?? 1.0,
    isFinal: options.isFinal ?? true
  });
}

/** 批量添加转录片段 */
export async function addTranscripts(
  sessionId: string,
  userId: string,
  segments: Array<{
    text: string;
    startMs: number;
    endMs: number;
    speakerId?: string;
    confidence?: number;
    isFinal?: boolean;
  }>
): Promise<number[]> {
  const records = segments.map(seg => ({
    sessionId,
    userId,
    text: seg.text,
    startMs: seg.startMs,
    endMs: seg.endMs,
    speakerId: seg.speakerId,
    confidence: seg.confidence ?? 1.0,
    isFinal: seg.isFinal ?? true
  }));
  
  return db.transcripts.bulkAdd(records);
}

/** 获取会话的所有转录（按用户过滤） */
export async function getSessionTranscripts(
  sessionId: string,
  userId: string
): Promise<TranscriptSegment[]> {
  return db.transcripts
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .sortBy('startMs');
}

/** 删除会话的所有转录 */
export async function deleteSessionTranscripts(
  sessionId: string,
  userId: string
): Promise<number> {
  return db.transcripts
    .where('[userId+sessionId]')
    .equals([userId, sessionId])
    .delete();
}
