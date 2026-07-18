'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSessionSummary } from '@/lib/db';
import type { Anchor as DBAnchor, TranscriptSegment as DBTranscriptSegment } from '@/lib/db/schema';
import type { ContextPack, LessonContext } from '@/lib/ai-native/types';
import type { CourseContextGroup } from '@/lib/utils/course-context';
import type { Anchor, TranscriptSegment } from '@/types';

function toTranscriptSegments(rows: DBTranscriptSegment[]): TranscriptSegment[] {
  return rows.map((row, index) => ({
    id: String(row.id ?? `segment-${index + 1}`),
    text: row.text,
    startMs: row.startMs,
    endMs: row.endMs,
    confidence: row.confidence,
    speakerId: row.speakerId,
    isFinal: row.isFinal,
  }));
}

function toAnchors(
  sessionId: string,
  rows: DBAnchor[],
): Anchor[] {
  return rows.map((row, index) => ({
    id: `anchor-${row.id ?? index + 1}`,
    sessionId,
    studentId: 'local-student',
    timestamp: row.timestamp,
    type: row.type,
    cancelled: false,
    resolved: row.status === 'resolved',
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
    note: row.note,
    aiExplanation: row.aiExplanation,
  }));
}

export interface CourseContextPackState {
  pack: ContextPack | null;
  loading: boolean;
  availableLessonCount: number;
}

/**
 * 从课程卡中的真实 session 懒加载多课上下文。缺少转录的课堂不会被伪装成可用材料；
 * 至少两节课有原文时才形成 unit ContextPack。
 */
export function useCourseContextPack(course: CourseContextGroup): CourseContextPackState {
  const lessonKey = course.lessons.map((lesson) => lesson.sessionId).join('|');
  const assessmentKey = course.assessment
    ? [course.assessment.id, course.assessment.name, course.assessment.targetDate, course.assessment.mode, course.assessment.syllabus].join('|')
    : '';
  const snapshot = useLiveQuery(async () => {
    const lessons = await Promise.all(course.lessons.map(async (lesson): Promise<LessonContext | null> => {
      const [transcriptRows, anchorRows, summary] = await Promise.all([
        db.transcripts.where('sessionId').equals(lesson.sessionId).sortBy('startMs'),
        db.anchors.where('sessionId').equals(lesson.sessionId).sortBy('timestamp'),
        getSessionSummary(lesson.sessionId),
      ]);
      if (transcriptRows.length === 0) return null;
      return {
        sessionId: lesson.sessionId,
        title: lesson.title,
        occurredAt: new Date(lesson.occurredAt).getTime(),
        transcript: toTranscriptSegments(transcriptRows),
        anchors: toAnchors(lesson.sessionId, anchorRows),
        summary: summary?.overview,
        keyDifficulties: Array.isArray(summary?.keyDifficulties) ? summary.keyDifficulties : undefined,
        metadata: {
          subject: lesson.courseTitle || course.title,
          sourceType: lesson.sourceType,
        },
      };
    }));
    const available = lessons.filter((lesson): lesson is LessonContext => Boolean(lesson));
    const assessment = course.assessment;
    return {
      availableLessonCount: available.length,
      pack: available.length >= 2
        ? assessment
          ? {
              tier: 'exam' as const,
              lessons: available,
              exam: {
                name: assessment.name,
                mode: assessment.mode,
                targetDate: assessment.targetDate
                  ? new Date(`${assessment.targetDate}T12:00:00`).getTime()
                  : undefined,
                syllabus: assessment.syllabus,
              },
            }
          : { tier: 'unit' as const, lessons: available }
        : null,
    };
  }, [assessmentKey, course.courseKey, course.title, lessonKey]);

  return {
    pack: snapshot?.pack ?? null,
    loading: snapshot === undefined,
    availableLessonCount: snapshot?.availableLessonCount ?? 0,
  };
}
