'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  Pause,
  PencilLine,
  Play,
  Tag,
  Undo2,
  Unlink,
  X,
} from 'lucide-react';
import { useAudioSessions } from '@/hooks/useAudioSessions';
import { CourseAssessmentCard } from '@/components/CourseAssessmentCard';
import { COPY } from '@/lib/ui/copy';
import { buildCourseContextGroups, type CourseContextGroup } from '@/lib/utils/course-context';
import { cn } from '@/lib/utils';
import type { CourseContextPreference } from '@/types/user';

interface CourseContextSectionProps {
  preferences: CourseContextPreference[];
  saving: boolean;
  onUpdatePreference: (
    courseKey: string,
    patch: Partial<Pick<CourseContextPreference, 'displayName' | 'tags' | 'status' | 'confirmedByUser' | 'excludedSessionIds' | 'assessments'>>,
  ) => Promise<void>;
  onOpenCheatsheet: (courses: CourseContextGroup[], initialCourseKeys?: string[]) => void;
  focusCheatsheet?: boolean;
  standalone?: boolean;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function confidenceLabel(course: CourseContextGroup): string {
  if (course.status === 'paused') return COPY.globalAsk.courseContextPaused;
  if (course.detachedFromCourseKey) return COPY.globalAsk.courseContextDetached;
  if (course.confidence === 'suggested') return COPY.globalAsk.courseContextSuggested;
  if (course.confidence === 'unclassified') return COPY.globalAsk.courseContextUnclassified;
  return COPY.globalAsk.courseContextActive;
}

function CourseCard({
  course,
  saving,
  onUpdatePreference,
  onOpenCheatsheet,
  preference,
  onDetachLesson,
  onRestoreLesson,
  cheatsheetCourses,
}: {
  course: CourseContextGroup;
  saving: boolean;
  onUpdatePreference: CourseContextSectionProps['onUpdatePreference'];
  onOpenCheatsheet: CourseContextSectionProps['onOpenCheatsheet'];
  preference?: CourseContextPreference;
  onDetachLesson: (course: CourseContextGroup, sessionId: string) => Promise<void>;
  onRestoreLesson: (course: CourseContextGroup) => Promise<void>;
  cheatsheetCourses: CourseContextGroup[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(course.title);
  const [draftTags, setDraftTags] = useState(course.tags.join('、'));
  const paused = course.status === 'paused';

  return (
    <article className={cn(
      'overflow-hidden rounded-[22px] border bg-white transition-colors',
      paused ? 'border-divider/70 opacity-70' : 'border-divider',
    )}>
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[13px] bg-pine-fog text-pine">
            <BookOpen size={16} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      autoFocus
                      placeholder={COPY.globalAsk.courseContextRenameHint}
                      className="min-w-0 flex-1 rounded-xl border border-pine/30 bg-canvas px-3 py-2 text-[15px] font-semibold text-ink outline-none focus:border-pine/55"
                    />
                    <button
                      type="button"
                      disabled={!draft.trim() || saving}
                      onClick={async () => {
                        await onUpdatePreference(course.courseKey, {
                          displayName: draft.trim(),
                          tags: draftTags.split(/[、,，]/u).map((tag) => tag.trim()).filter(Boolean),
                          confirmedByUser: true,
                        });
                        setEditing(false);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-pine text-white disabled:opacity-40"
                      aria-label={COPY.globalAsk.courseContextSave}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDraft(course.title); setDraftTags(course.tags.join('、')); setEditing(false); }}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm"
                      aria-label={COPY.globalAsk.courseContextCancel}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <h3 className="truncate text-[16px] font-semibold leading-6 text-ink sm:text-[17px]">{course.title}</h3>
                )}
                {editing ? (
                  <label className="mt-2 flex items-center gap-2 rounded-xl border border-divider bg-canvas px-3 py-2">
                    <Tag size={12} className="flex-shrink-0 text-ink-muted" />
                    <span className="sr-only">{COPY.globalAsk.courseContextTags}</span>
                    <input
                      value={draftTags}
                      onChange={(event) => setDraftTags(event.target.value)}
                      placeholder={COPY.globalAsk.courseContextTagsHint}
                      className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink outline-none placeholder:text-ink-muted"
                    />
                  </label>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                  <span>{COPY.globalAsk.courseContextLessons(course.lessons.length)}</span>
                  {course.totalDurationMin > 0 ? <span>{COPY.globalAsk.courseContextMinutes(course.totalDurationMin)}</span> : null}
                  {course.scheduleLabel ? (
                    <span className="inline-flex items-center gap-1"><CalendarDays size={11} />{course.scheduleLabel}</span>
                  ) : null}
                </div>
                {!editing && course.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {course.tags.map((tag) => <span key={tag} className="rounded-full bg-paper-warm px-2 py-1 text-[9.5px] text-ink-muted">{tag}</span>)}
                  </div>
                ) : null}
              </div>
              <span className={cn(
                'flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium',
                paused
                  ? 'bg-paper-warm text-ink-muted'
                  : course.confidence === 'confirmed'
                    ? 'bg-pine-fog text-pine'
                    : 'bg-vermilion-fog text-vermilion',
              )}>
                {confidenceLabel(course)}
              </span>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex items-center gap-1.5 rounded-full border border-divider px-3 py-2 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine"
              >
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? COPY.globalAsk.courseContextCollapse : COPY.globalAsk.courseContextDetails}
              </button>
            </div>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-divider/80 bg-canvas/70 px-4 py-3 sm:px-5">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 border-b border-divider/60 pb-3">
            {!editing ? (
              <button
                type="button"
                onClick={() => { setDraft(course.title); setDraftTags(course.tags.join('、')); setEditing(true); }}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11.5px] text-ink-muted hover:bg-white hover:text-pine"
              >
                <PencilLine size={12} />{COPY.globalAsk.courseContextRename}
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => void onUpdatePreference(course.courseKey, { status: paused ? 'active' : 'paused' })}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11.5px] text-ink-muted hover:bg-white hover:text-pine disabled:opacity-40"
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
              {paused ? COPY.globalAsk.courseContextResume : COPY.globalAsk.courseContextPause}
            </button>
            {!paused && course.lessons.length >= 2 && course.confidence === 'suggested' ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void onUpdatePreference(course.courseKey, { confirmedByUser: true })}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11.5px] text-pine hover:bg-white disabled:opacity-40"
              >
                <Check size={12} />{COPY.globalAsk.courseContextConfirm}
              </button>
            ) : null}
            {!paused && !course.assessment && course.confidence === 'confirmed' && cheatsheetCourses.reduce((sum, item) => sum + item.lessons.length, 0) >= 2 ? (
              <button
                type="button"
                onClick={() => onOpenCheatsheet(cheatsheetCourses, [course.courseKey])}
                className="inline-flex items-center gap-1.5 rounded-full bg-pine px-3.5 py-2 text-[11.5px] font-medium text-white"
              >
                <FileText size={12} />{COPY.globalAsk.courseContextCheatsheet}
              </button>
            ) : null}
            {course.detachedFromCourseKey ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void onRestoreLesson(course)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11.5px] text-pine hover:bg-white disabled:opacity-40"
              >
                <Undo2 size={12} />{COPY.globalAsk.courseContextRestore}
              </button>
            ) : null}
          </div>
          {!paused && !course.detachedFromCourseKey ? (
            <CourseAssessmentCard
              course={course}
              preference={preference}
              saving={saving}
              onUpdatePreference={onUpdatePreference}
              onOpenCheatsheet={(selectedCourse) => onOpenCheatsheet(cheatsheetCourses, [selectedCourse.courseKey])}
            />
          ) : null}
          {course.lessons.map((lesson) => (
            <div key={lesson.sessionId} className="flex items-center gap-3 border-b border-divider/60 py-3 last:border-b-0">
              <Clock3 size={13} className="flex-shrink-0 text-ink-muted" />
              <p className="min-w-0 flex-1 truncate text-[12.5px] text-ink-secondary">{lesson.title}</p>
              <time className="flex-shrink-0 text-[10.5px] text-ink-muted">{formatDate(lesson.occurredAt)}</time>
              {course.lessons.length >= 2 ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onDetachLesson(course, lesson.sessionId)}
                  className="inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] text-ink-muted hover:bg-white hover:text-vermilion disabled:opacity-40"
                  title={COPY.globalAsk.courseContextDetachTitle(lesson.title)}
                  aria-label={COPY.globalAsk.courseContextDetachTitle(lesson.title)}
                >
                  <Unlink size={10.5} />{COPY.globalAsk.courseContextDetach}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function CourseContextSection({
  preferences,
  saving,
  onUpdatePreference,
  onOpenCheatsheet,
  focusCheatsheet = false,
  standalone = false,
}: CourseContextSectionProps) {
  const sessions = useAudioSessions();
  const sectionRef = useRef<HTMLElement | null>(null);
  const focusedScopeOpenedRef = useRef(false);
  const courses = useMemo(
    () => buildCourseContextGroups(sessions, preferences),
    [preferences, sessions],
  );
  const eligibleCheatsheetCourses = useMemo(
    () => courses.filter((course) => (
      course.status === 'active'
      && !course.detachedFromCourseKey
      && course.lessons.length >= 1
    )),
    [courses],
  );
  const eligibleCheatsheetLessonCount = useMemo(
    () => eligibleCheatsheetCourses.reduce((sum, course) => sum + course.lessons.length, 0),
    [eligibleCheatsheetCourses],
  );

  useEffect(() => {
    if (!focusCheatsheet) return;
    if (eligibleCheatsheetLessonCount >= 2 && !focusedScopeOpenedRef.current) {
      focusedScopeOpenedRef.current = true;
      onOpenCheatsheet(eligibleCheatsheetCourses);
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [eligibleCheatsheetCourses, eligibleCheatsheetLessonCount, focusCheatsheet, onOpenCheatsheet]);
  const detachLesson = async (course: CourseContextGroup, sessionId: string) => {
    const preference = preferences.find((item) => item.courseKey === course.courseKey);
    const excludedSessionIds = Array.from(new Set([...(preference?.excludedSessionIds || []), sessionId]));
    await onUpdatePreference(course.courseKey, { excludedSessionIds });
  };
  const restoreLesson = async (course: CourseContextGroup) => {
    const sourceKey = course.detachedFromCourseKey;
    const sessionId = course.lessons[0]?.sessionId;
    if (!sourceKey || !sessionId) return;
    const preference = preferences.find((item) => item.courseKey === sourceKey);
    const excludedSessionIds = (preference?.excludedSessionIds || []).filter((id) => id !== sessionId);
    await onUpdatePreference(sourceKey, { excludedSessionIds });
  };

  return (
    <section ref={sectionRef} className={cn('scroll-mt-4', !standalone && 'mt-10 border-t border-divider pt-8 sm:mt-12 sm:pt-10')}>
      <div className="mb-5 flex items-end justify-between gap-4 px-1">
        <div>
          <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-vermilion">{COPY.globalAsk.memoryCoursesTab}</p>
          <h2 className="mt-2 font-serif text-[25px] italic tracking-[-0.025em] text-ink sm:text-[28px]">{COPY.globalAsk.courseContextTitle}</h2>
        </div>
        {courses.length > 0 ? <span className="mb-1 text-[11px] tabular-nums text-ink-muted">{courses.length}</span> : null}
      </div>

      <div
        className={cn(
          'mb-5 border-y px-1 py-5 sm:py-6',
          focusCheatsheet ? 'border-pine/40' : 'border-divider',
        )}
        data-testid="course-cheatsheet-launcher"
      >
        <div className="flex items-start gap-3 sm:items-center sm:gap-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-pine-fog text-pine sm:h-11 sm:w-11">
            <FileText size={17} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-vermilion">
              {COPY.globalAsk.courseCheatsheetEntryEyebrow}
            </p>
            <h3 className="mt-1 text-[17px] font-semibold text-ink">{COPY.globalAsk.courseCheatsheetEntryTitle}</h3>
            <p className="mt-1.5 text-[12px] leading-5 text-ink-secondary">{COPY.globalAsk.courseCheatsheetEntryBody}</p>
          </div>
          {eligibleCheatsheetLessonCount >= 2 ? (
            <button
              type="button"
              onClick={() => onOpenCheatsheet(eligibleCheatsheetCourses)}
              className="ml-auto hidden min-h-10 shrink-0 items-center justify-center rounded-full bg-pine px-4 text-[11.5px] font-medium text-white sm:inline-flex"
            >
              {COPY.globalAsk.courseCheatsheetEntryAction}
            </button>
          ) : <span className="ml-auto hidden max-w-[170px] shrink-0 text-right text-[10.5px] leading-5 text-ink-muted sm:block">{COPY.globalAsk.courseCheatsheetEntryEmpty}</span>}
        </div>

        {eligibleCheatsheetLessonCount >= 2 ? (
          <div className="mt-3 flex items-center justify-between gap-3 pl-[52px] sm:hidden">
            <p className="text-[10.5px] text-ink-muted">{COPY.globalAsk.courseCheatsheetEntryAvailable(eligibleCheatsheetCourses.length, eligibleCheatsheetLessonCount)}</p>
            <button type="button" onClick={() => onOpenCheatsheet(eligibleCheatsheetCourses)} className="shrink-0 rounded-full bg-pine px-4 py-2.5 text-[11.5px] font-medium text-white">
              {COPY.globalAsk.courseCheatsheetEntryAction}
            </button>
          </div>
        ) : <p className="mt-3 pl-[52px] text-[10.5px] leading-5 text-ink-muted sm:hidden">{COPY.globalAsk.courseCheatsheetEntryEmpty}</p>}
      </div>

      <div className="space-y-3">
        {courses.length === 0 ? (
          <div className="border-b border-divider px-1 py-8 text-[12.5px] leading-6 text-ink-muted">
            {COPY.globalAsk.courseContextEmpty}
          </div>
        ) : courses.map((course) => (
          <CourseCard
            key={course.courseKey}
            course={course}
            saving={saving}
            onUpdatePreference={onUpdatePreference}
            onOpenCheatsheet={onOpenCheatsheet}
            preference={preferences.find((item) => item.courseKey === course.courseKey)}
            onDetachLesson={detachLesson}
            onRestoreLesson={restoreLesson}
            cheatsheetCourses={eligibleCheatsheetCourses}
          />
        ))}
      </div>
    </section>
  );
}
