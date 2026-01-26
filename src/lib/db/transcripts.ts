/**
 * 转录片段 (TranscriptSegment) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type TranscriptSegment } from './schema';
import { ANONYMOUS_USER_ID } from './sessions';

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
    userId: userId || ANONYMOUS_USER_ID,
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
    confidence?: number;
    isFinal?: boolean;
  }>
): Promise<number> {
  const records = segments.map(seg => ({
    sessionId,
    userId: userId || ANONYMOUS_USER_ID,
    text: seg.text,
    startMs: seg.startMs,
    endMs: seg.endMs,
    confidence: seg.confidence ?? 1.0,
    isFinal: seg.isFinal ?? true
  }));
  
  return db.transcripts.bulkAdd(records);
}

/** 获取会话的所有转录 */
export async function getSessionTranscripts(sessionId: string): Promise<TranscriptSegment[]> {
  return db.transcripts
    .where('sessionId')
    .equals(sessionId)
    .sortBy('startMs');
}
