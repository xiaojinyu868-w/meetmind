/**
 * 把一节 live 课（LessonRecord）存成本机的一节课：audioSessions 一行（sourceType='teach-live'，无媒体）+ transcripts 若干段。
 *
 * IndexedDB 是客户端真实数据源，所以课一存进来就出现在课堂列表，复习页按 sessionId 恢复——和录音课、视频课同一条路。
 * 幂等：sessionId = `teach:<threadId>`；每次同步整段替换转录（老师又讲了一轮就多几段），不追加不重复。
 * 只写这节课自己的东西：材料与之前的课不进本表，复习页需要时按 sourceRef 去拉 record。
 */

import { db } from './index';
import { saveAudioSession } from './sessions';
import type { LessonRecord } from '@/lib/services/teach-live/lesson-record';

export const TEACH_SESSION_PREFIX = 'teach:';

export function teachSessionId(threadId: string): string {
  return `${TEACH_SESSION_PREFIX}${threadId}`;
}

export function threadIdFromTeachSession(sessionId: string): string | null {
  return sessionId.startsWith(TEACH_SESSION_PREFIX) ? sessionId.slice(TEACH_SESSION_PREFIX.length) : null;
}

export async function saveLessonRecordAsSession(record: LessonRecord, userId: string): Promise<{ sessionId: string; segments: number }> {
  const sessionId = teachSessionId(record.threadId);
  await saveAudioSession(null, sessionId, userId, {
    topic: record.title,
    duration: record.durationMs,
    sourceType: 'teach-live',
    sourceRef: record.threadId,
    transcriptionStatus: 'completed',
    mimeType: 'text/plain',
  });
  await db.transaction('rw', db.transcripts, async () => {
    await db.transcripts.where('sessionId').equals(sessionId).delete();
    if (!record.segments.length) return;
    await db.transcripts.bulkAdd(
      record.segments.map((segment) => ({
        sessionId,
        userId,
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speaker,
        confidence: 1,
        isFinal: true,
        ...(segment.sourceRef ? { sourceItemId: segment.sourceRef } : {}),
      })),
    );
  });
  return { sessionId, segments: record.segments.length };
}
