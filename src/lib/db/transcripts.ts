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
  
  const added = await db.transcripts.bulkAdd(records);
  await db.audioSessions
    .where('sessionId')
    .equals(sessionId)
    .modify({
      transcriptionStatus: 'completed',
      transcriptionError: undefined,
      transcriptionUpdatedAt: new Date(),
      updatedAt: new Date(),
    });
  return added;
}

/** 获取会话的所有转录 */
export async function getSessionTranscripts(sessionId: string): Promise<TranscriptSegment[]> {
  return db.transcripts
    .where('sessionId')
    .equals(sessionId)
    .sortBy('startMs');
}

/**
 * 批量更新会话转录段的 speakerId
 *
 * 用于录音结束后，Fun-ASR 说话人分离结果回填到已有 segments。
 * 按 startMs 时间戳匹配：取时间区间重叠最大的 diarization 句子的 speakerId。
 *
 * @param sessionId 会话 ID
 * @param updates { startMs → speakerId } 映射（startMs 匹配已有 segment 的 startMs）
 */
export async function updateTranscriptSpeakerIds(
  sessionId: string,
  speakerMap: Array<{ startMs: number; speakerId: string }>,
): Promise<number> {
  const segments = await db.transcripts
    .where('sessionId')
    .equals(sessionId)
    .toArray();

  let updated = 0;
  for (const seg of segments) {
    // 按 startMs 最接近原则匹配
    let bestMatch: { startMs: number; speakerId: string } | null = null;
    let bestDist = Infinity;
    for (const m of speakerMap) {
      const dist = Math.abs(seg.startMs - m.startMs);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = m;
      }
    }
    // 容忍 3 秒以内的偏差（实时 ASR 和非实时 ASR 的时间戳可能有差异）
    if (bestMatch && bestDist < 3000) {
      await db.transcripts.update(seg.id!, { speakerId: bestMatch.speakerId });
      updated++;
    }
  }

  return updated;
}
