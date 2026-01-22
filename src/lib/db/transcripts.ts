/**
 * 转录片段 (TranscriptSegment) 数据库操作
 * Owner: 录音模块开发者
 */

import { db, type TranscriptSegment } from './schema';

/** 添加转录片段 */
export async function addTranscript(
  sessionId: string,
  text: string,
  startMs: number,
  endMs: number,
  options: { speakerId?: string; confidence?: number; isFinal?: boolean } = {}
): Promise<number> {
  return db.transcripts.add({
    sessionId,
    text,
    startMs,
    endMs,
    speakerId: options.speakerId,
    confidence: options.confidence ?? 1.0,
    isFinal: options.isFinal ?? true
  });
}

/** 获取会话的所有转录 */
export async function getSessionTranscripts(sessionId: string): Promise<TranscriptSegment[]> {
  return db.transcripts
    .where('sessionId')
    .equals(sessionId)
    .sortBy('startMs');
}
