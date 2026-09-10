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

/**
 * 录课检查点：用当前实时字幕快照整体替换这节课已落盘的转录段。
 *
 * 与 addTranscripts 的区别：实时字幕会被合并 / 替换（mergeRealtimeTranscriptSegment 的 replaceIds、
 * 静默纠错改写前句），只能"整段快照覆盖"而不能追加；而且录课中不能把 audioSession 标成
 * transcriptionStatus=completed（那是结束时的语义）。删除 + 批量写在同一个事务里，
 * 页面在中途被杀也不会留下半份。
 */
export async function replaceSessionTranscripts(
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
): Promise<number> {
  if (typeof sessionId !== 'string' || !sessionId.trim()) return 0;
  const records = segments
    .filter((seg) => typeof seg.text === 'string' && seg.text.trim())
    .map(seg => ({
      sessionId,
      userId: userId || ANONYMOUS_USER_ID,
      text: seg.text,
      startMs: seg.startMs,
      endMs: seg.endMs,
      speakerId: seg.speakerId,
      confidence: seg.confidence ?? 1.0,
      isFinal: seg.isFinal ?? true,
    }));
  await db.transaction('rw', db.transcripts, async () => {
    await db.transcripts.where('sessionId').equals(sessionId).delete();
    if (records.length > 0) await db.transcripts.bulkAdd(records);
  });
  return records.length;
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
 * @param speakerMap diarization 句子的时间区间与 speakerId
 */
export async function updateTranscriptSpeakerIds(
  sessionId: string,
  speakerMap: Array<{ startMs: number; endMs?: number; speakerId: string }>,
): Promise<number> {
  const segments = await db.transcripts
    .where('sessionId')
    .equals(sessionId)
    .toArray();

  let updated = 0;
  for (const seg of segments) {
    // 时间区间重叠优先；老数据没有 endMs 时退化为近邻匹配。
    let bestMatch: { startMs: number; endMs?: number; speakerId: string } | null = null;
    let bestOverlap = 0;
    let bestDist = Infinity;
    for (const m of speakerMap) {
      const overlap = typeof m.endMs === 'number'
        ? Math.max(0, Math.min(seg.endMs, m.endMs) - Math.max(seg.startMs, m.startMs))
        : 0;
      const dist = Math.abs(seg.startMs - m.startMs);
      if (overlap > bestOverlap || (overlap === bestOverlap && dist < bestDist)) {
        bestOverlap = overlap;
        bestDist = dist;
        bestMatch = m;
      }
    }
    // 无重叠时只容忍 1.5 秒偏差，错误身份比缺少标签更伤信任。
    if (bestMatch && (bestOverlap > 0 || bestDist < 1500)) {
      await db.transcripts.update(seg.id!, { speakerId: bestMatch.speakerId });
      updated++;
    }
  }

  return updated;
}
