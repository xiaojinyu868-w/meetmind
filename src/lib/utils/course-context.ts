import type { AudioSession } from '@/lib/db';
import { COPY } from '@/lib/ui/copy';
import type { CourseAssessmentEntry, CourseContextPreference } from '@/types/user';

export type CourseContextOrigin = 'subject' | 'topic' | 'schedule' | 'single';

export interface CourseContextLesson {
  sessionId: string;
  title: string;
  occurredAt: string;
  durationMin: number;
  sourceType: AudioSession['sourceType'];
}

export interface CourseContextGroup {
  courseKey: string;
  title: string;
  status: 'active' | 'paused';
  confidence: 'confirmed' | 'suggested' | 'unclassified';
  origin: CourseContextOrigin;
  scheduleLabel?: string;
  latestAt: string;
  totalDurationMin: number;
  sourceCounts: { recordings: number; uploads: number; videos: number };
  lessons: CourseContextLesson[];
  assessment?: CourseAssessmentEntry;
  /** 这是一节被用户从自动课程分组中移出的课堂，可随时放回。 */
  detachedFromCourseKey?: string;
}

const GENERIC_LABELS = new Set([
  '',
  '课堂',
  '课堂录音',
  '课堂回顾',
  '未知学科',
  '未知课程',
  '未命名课堂',
  '视频复习',
]);

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function compact(value: string | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizedKey(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s·•—–_\-：:，,。.!！?？()（）\[\]【】]/g, '');
}

function isMeaningfulLabel(value: string | undefined): value is string {
  const label = compact(value);
  return label.length > 0 && !GENERIC_LABELS.has(label);
}

/**
 * 只移除明显属于“第几讲 / 日期”的课次尾巴，不猜课程语义。
 * 例如“线性代数 第 3 讲”可稳定归到“线性代数”；“线性代数与空间”不会被截断。
 */
function courseTitleFromTopic(value: string): string {
  return compact(value)
    .replace(/[（(]?\s*第?\s*[0-9０-９一二三四五六七八九十百]+\s*(?:讲|课|节|章|周)\s*[)）]?\s*$/u, '')
    .replace(/\s*[·•—–_-]?\s*20\d{2}[./-]\d{1,2}(?:[./-]\d{1,2})?\s*$/u, '')
    .trim();
}

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function dateTitle(date: Date): string {
  return COPY.globalAsk.courseContextFallbackTitle(date.getMonth() + 1, date.getDate());
}

function lessonDateTitle(date: Date): string {
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return COPY.globalAsk.courseContextLessonFallbackTitle(date.getMonth() + 1, date.getDate(), time);
}

function roundedHalfHour(date: Date): number {
  const total = date.getHours() * 60 + date.getMinutes();
  return Math.round(total / 30) * 30;
}

function scheduleKey(date: Date): string {
  return `schedule:${date.getDay()}:${roundedHalfHour(date)}`;
}

function scheduleTitle(date: Date): string {
  return COPY.globalAsk.courseContextScheduleTitle(WEEKDAYS[date.getDay()]);
}

function recurringSchedule(lessons: CourseContextLesson[]): string | undefined {
  if (lessons.length < 2) return undefined;
  const dates = lessons.map((lesson) => toDate(lesson.occurredAt));
  if (dates.some((date) => date.getTime() === 0)) return undefined;
  const weekday = dates[0].getDay();
  if (!dates.every((date) => date.getDay() === weekday)) return undefined;
  const minutes = dates.map((date) => date.getHours() * 60 + date.getMinutes());
  if (Math.max(...minutes) - Math.min(...minutes) > 90) return undefined;
  const average = Math.round(minutes.reduce((sum, value) => sum + value, 0) / minutes.length / 5) * 5;
  const time = `${String(Math.floor(average / 60)).padStart(2, '0')}:${String(average % 60).padStart(2, '0')}`;
  return COPY.globalAsk.courseContextRecurring(WEEKDAYS[weekday], time);
}

interface Seed {
  key: string;
  title: string;
  origin: CourseContextOrigin;
  confidence: CourseContextGroup['confidence'];
  detachedFromCourseKey?: string;
}

function seedForSession(session: AudioSession, genericScheduleCounts: Map<string, number>): Seed {
  if (isMeaningfulLabel(session.subject)) {
    const title = compact(session.subject);
    return { key: `subject:${normalizedKey(title)}`, title, origin: 'subject', confidence: 'confirmed' };
  }

  if (isMeaningfulLabel(session.topic)) {
    const inferred = courseTitleFromTopic(session.topic);
    if (inferred && !GENERIC_LABELS.has(inferred)) {
      return {
        key: `topic:${normalizedKey(inferred)}`,
        title: inferred,
        origin: 'topic',
        confidence: 'suggested',
      };
    }
  }

  const createdAt = toDate(session.createdAt);
  const key = scheduleKey(createdAt);
  if ((genericScheduleCounts.get(key) || 0) >= 2) {
    return { key, title: scheduleTitle(createdAt), origin: 'schedule', confidence: 'suggested' };
  }
  return {
    key: `session:${session.sessionId}`,
    title: dateTitle(createdAt),
    origin: 'single',
    confidence: 'unclassified',
  };
}

function sourceCounts(lessons: CourseContextLesson[]): CourseContextGroup['sourceCounts'] {
  return lessons.reduce((counts, lesson) => {
    if (lesson.sourceType === 'video-file' || lesson.sourceType === 'video-link') counts.videos += 1;
    else if (lesson.sourceType === 'upload') counts.uploads += 1;
    else counts.recordings += 1;
    return counts;
  }, { recordings: 0, uploads: 0, videos: 0 });
}

export function buildCourseContextGroups(
  sessions: AudioSession[],
  preferences: CourseContextPreference[] = [],
): CourseContextGroup[] {
  const unique = new Map<string, AudioSession>();
  sessions.forEach((session) => {
    if (!session.sessionId || session.status === 'archived') return;
    const current = unique.get(session.sessionId);
    if (!current || toDate(session.updatedAt).getTime() >= toDate(current.updatedAt).getTime()) {
      unique.set(session.sessionId, session);
    }
  });
  const values = Array.from(unique.values());
  const preferenceByKey = new Map(preferences.map((item) => [item.courseKey, item]));

  const genericScheduleCounts = new Map<string, number>();
  values.forEach((session) => {
    if (isMeaningfulLabel(session.subject) || isMeaningfulLabel(session.topic)) return;
    const key = scheduleKey(toDate(session.createdAt));
    genericScheduleCounts.set(key, (genericScheduleCounts.get(key) || 0) + 1);
  });

  const buckets = new Map<string, { seed: Seed; sessions: AudioSession[] }>();
  values.forEach((session) => {
    const inferredSeed = seedForSession(session, genericScheduleCounts);
    const excludedSessionIds = preferenceByKey.get(inferredSeed.key)?.excludedSessionIds;
    const excluded = Array.isArray(excludedSessionIds) && excludedSessionIds.includes(session.sessionId);
    const createdAt = toDate(session.createdAt);
    const seed: Seed = excluded
      ? {
          key: `session:${session.sessionId}`,
          title: isMeaningfulLabel(session.topic) ? compact(session.topic) : lessonDateTitle(createdAt),
          origin: 'single',
          confidence: 'unclassified',
          detachedFromCourseKey: inferredSeed.key,
        }
      : inferredSeed;
    const bucket = buckets.get(seed.key) || { seed, sessions: [] };
    bucket.sessions.push(session);
    buckets.set(seed.key, bucket);
  });

  return Array.from(buckets.values()).map(({ seed, sessions: groupedSessions }) => {
    const preference = preferenceByKey.get(seed.key);
    const assessments = Array.isArray(preference?.assessments) ? preference.assessments : [];
    const lessons = groupedSessions
      .map<CourseContextLesson>((session) => {
        const occurred = toDate(session.createdAt);
        return {
          sessionId: session.sessionId,
          title: isMeaningfulLabel(session.topic) ? compact(session.topic) : lessonDateTitle(occurred),
          occurredAt: occurred.toISOString(),
          durationMin: Math.max(0, Math.round((session.duration || 0) / 60_000)),
          sourceType: session.sourceType,
        };
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    return {
      courseKey: seed.key,
      title: compact(preference?.displayName) || seed.title,
      status: preference?.status ?? 'active',
      confidence: preference?.confirmedByUser ? 'confirmed' : seed.confidence,
      origin: seed.origin,
      scheduleLabel: recurringSchedule(lessons),
      latestAt: lessons[0]?.occurredAt || new Date(0).toISOString(),
      totalDurationMin: lessons.reduce((sum, lesson) => sum + lesson.durationMin, 0),
      sourceCounts: sourceCounts(lessons),
      lessons,
      assessment: assessments
        .filter((assessment) => assessment?.status === 'active' && assessment.id && assessment.name)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
      detachedFromCourseKey: seed.detachedFromCourseKey,
    } satisfies CourseContextGroup;
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return b.latestAt.localeCompare(a.latestAt);
  });
}
