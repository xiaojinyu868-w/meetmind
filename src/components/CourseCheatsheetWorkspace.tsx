'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Check, Layers3 } from 'lucide-react';
import { getWorkshopAppByKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import type { CourseContextGroup } from '@/lib/utils/course-context';
import { useCourseContextPack } from '@/hooks/useCourseContextPack';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { AppWindowShell } from '@/components/apps/windows/AppWindowShell';
import { ShareArtifactAction } from '@/components/share/ShareArtifactAction';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';

interface CourseCheatsheetWorkspaceProps {
  courses: CourseContextGroup[];
  initialCourseKeys?: string[];
  onBack: () => void;
}

const IDLE_SCOPE_STATE: AppTaskState = { status: 'idle', updatedAt: 0 };

export function CourseCheatsheetWorkspace({ courses, initialCourseKeys = [], onBack }: CourseCheatsheetWorkspaceProps) {
  const app = getWorkshopAppByKey('cheatsheet')!;
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<string>>(
    () => {
      const seededCourses = courses.filter((course) => initialCourseKeys.includes(course.courseKey));
      const startingCourses = seededCourses.length > 0 ? seededCourses : courses.slice(0, 1);
      return new Set(startingCourses.flatMap((course) => course.lessons.slice(0, 4).map((lesson) => lesson.sessionId)));
    },
  );
  const [started, setStarted] = useState(false);
  const selectedCourses = useMemo(() => courses
    .map((course) => {
      const lessons = course.lessons
        .filter((lesson) => selectedLessonIds.has(lesson.sessionId))
        .map((lesson) => ({ ...lesson, courseKey: course.courseKey, courseTitle: course.title }));
      return {
        ...course,
        lessons,
        totalDurationMin: lessons.reduce((sum, lesson) => sum + lesson.durationMin, 0),
        sourceCounts: lessons.reduce((counts, lesson) => {
          if (lesson.sourceType === 'video-file' || lesson.sourceType === 'video-link') counts.videos += 1;
          else if (lesson.sourceType === 'upload') counts.uploads += 1;
          else counts.recordings += 1;
          return counts;
        }, { recordings: 0, uploads: 0, videos: 0 }),
      };
    })
    .filter((course) => course.lessons.length > 0), [courses, selectedLessonIds]);
  const selectedCourse = useMemo<CourseContextGroup>(() => {
    const lessons = selectedCourses.flatMap((course) => course.lessons);
    const title = selectedCourses.length === 1
      ? selectedCourses[0].title
      : COPY.globalAsk.courseContextCombinedScope(selectedCourses.length);
    return {
      courseKey: `scope:${selectedCourses.map((course) => course.courseKey).sort().join('|')}`,
      title,
      status: 'active',
      confidence: 'confirmed',
      origin: 'single',
      latestAt: lessons.reduce(
        (latest, lesson) => lesson.occurredAt > latest ? lesson.occurredAt : latest,
        new Date(0).toISOString(),
      ),
      totalDurationMin: lessons.reduce((sum, lesson) => sum + lesson.durationMin, 0),
      sourceCounts: selectedCourses.reduce((counts, course) => ({
        recordings: counts.recordings + course.sourceCounts.recordings,
        uploads: counts.uploads + course.sourceCounts.uploads,
        videos: counts.videos + course.sourceCounts.videos,
      }), { recordings: 0, uploads: 0, videos: 0 }),
      tags: Array.from(new Set(selectedCourses.flatMap((course) => course.tags))),
      lessons,
      assessment: selectedCourses.length === 1 ? selectedCourses[0].assessment : undefined,
    };
  }, [selectedCourses]);
  const executionId = useMemo(
    () => `${selectedCourse.assessment ? `exam:${selectedCourse.assessment.id}` : selectedCourse.courseKey}:${selectedCourse.lessons.map((lesson) => lesson.sessionId).sort().join(',')}`,
    [selectedCourse.assessment, selectedCourse.courseKey, selectedCourse.lessons],
  );
  const context = useCourseContextPack(selectedCourse);
  const shareContext = useMemo(() => context.pack?.lessons
    .map((lesson) => {
      const fallback = lesson.transcript.map((segment) => segment.text.trim()).filter(Boolean).join(' ').slice(0, 500);
      return `${lesson.title}：${lesson.summary?.trim() || fallback}`;
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 4_000), [context.pack]);
  const execution = useAppExecution({
    app,
    sessionId: executionId,
    dataSource: 'unknown',
    transcript: [],
    anchors: [],
    contextTitle: selectedCourse.title,
    contextPack: context.pack ?? undefined,
    autoRun: started && Boolean(context.pack),
  });

  let content;
  if (!started) {
    content = (
      <div className="mx-auto flex min-h-[540px] w-full max-w-[980px] flex-col px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-vermilion">
              {COPY.globalAsk.courseCheatsheetScopeEyebrow}
            </p>
            <h2 className="mt-2 font-serif text-[27px] italic tracking-[-0.03em] text-ink sm:text-[31px]">
              {COPY.globalAsk.courseAssessmentChooseScope}
            </h2>
            <p className="mt-2 max-w-2xl text-[12.5px] leading-6 text-ink-secondary">
              {COPY.globalAsk.courseCheatsheetScopeHint}
            </p>
          </div>
          <p className="text-[11px] tabular-nums text-ink-muted">
            {COPY.globalAsk.courseCheatsheetSelectionSummary(selectedCourses.length, selectedLessonIds.size)}
          </p>
        </div>

        <div className="mt-6 grid min-h-0 flex-1 overflow-hidden rounded-[24px] border border-divider bg-white md:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="min-w-0 border-b border-divider bg-paper px-3 py-3 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-3 px-2 pb-2">
              <p className="text-[11px] font-semibold text-ink">{COPY.globalAsk.courseCheatsheetCoursesLabel}</p>
              <button
                type="button"
                onClick={() => setSelectedLessonIds(new Set())}
                className="text-[10.5px] text-ink-muted hover:text-vermilion"
              >
                {COPY.globalAsk.courseCheatsheetClear}
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:max-h-[470px] md:gap-1.5 md:overflow-x-visible md:overflow-y-auto md:pb-0">
              {courses.map((course) => {
                const selectedCount = course.lessons.filter((lesson) => selectedLessonIds.has(lesson.sessionId)).length;
                const selected = selectedCount === course.lessons.length && course.lessons.length > 0;
                const partiallySelected = selectedCount > 0 && !selected;
                return (
                  <button
                    key={course.courseKey}
                    type="button"
                    onClick={() => setSelectedLessonIds((current) => {
                      const next = new Set(current);
                      if (selected || partiallySelected) course.lessons.forEach((lesson) => next.delete(lesson.sessionId));
                      else course.lessons.forEach((lesson) => next.add(lesson.sessionId));
                      return next;
                    })}
                    className={`flex min-w-[168px] shrink-0 items-start gap-2.5 rounded-[14px] border px-3 py-3 text-left transition md:min-w-0 md:border-transparent ${selectedCount > 0 ? 'border-pine/15 bg-pine-fog' : 'border-divider bg-white/65 hover:bg-white md:bg-transparent'}`}
                    aria-pressed={selectedCount > 0}
                  >
                    <span className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${selectedCount > 0 ? 'border-pine bg-pine text-white' : 'border-divider bg-white text-transparent'}`}>
                      {partiallySelected ? <span className="h-0.5 w-2 rounded-full bg-white" /> : <Check size={12} strokeWidth={2.2} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[12.5px] font-semibold text-ink">{course.title}</strong>
                      <span className="mt-0.5 block text-[10px] text-ink-muted">
                        {COPY.globalAsk.courseCheatsheetCourseSelection(selectedCount, course.lessons.length)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto bg-canvas/55 px-4 py-4 sm:px-5">
            {selectedCourses.length === 0 ? (
              <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-pine-fog text-pine"><Layers3 size={18} /></span>
                <p className="mt-3 text-[13px] font-semibold text-ink">{COPY.globalAsk.courseCheatsheetEmptySelectionTitle}</p>
                <p className="mt-1 max-w-sm text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.courseCheatsheetEmptySelectionBody}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {selectedCourses.map((course) => (
                  <section key={course.courseKey}>
                    <div className="mb-2 flex items-center justify-between gap-3 px-1">
                      <h3 className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-ink">
                        <BookOpen size={13} className="flex-shrink-0 text-pine" />
                        <span className="truncate">{course.title}</span>
                      </h3>
                      <span className="text-[10px] tabular-nums text-ink-muted">{course.lessons.length}</span>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {courses.find((item) => item.courseKey === course.courseKey)?.lessons.map((lesson) => {
                        const selected = selectedLessonIds.has(lesson.sessionId);
                        return (
                          <button
                            key={lesson.sessionId}
                            type="button"
                            onClick={() => setSelectedLessonIds((current) => {
                              const next = new Set(current);
                              if (selected) next.delete(lesson.sessionId);
                              else next.add(lesson.sessionId);
                              return next;
                            })}
                            className={`flex min-h-12 items-center gap-2.5 rounded-[14px] border px-3 py-2.5 text-left transition ${selected ? 'border-pine/25 bg-white' : 'border-divider/80 bg-white/55 opacity-65 hover:opacity-100'}`}
                            aria-pressed={selected}
                          >
                            <span className={`flex h-4.5 w-4.5 flex-shrink-0 items-center justify-center rounded border ${selected ? 'border-pine bg-pine text-white' : 'border-divider text-transparent'}`}>
                              <Check size={10.5} />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-secondary">{lesson.title}</span>
                            <time className="flex-shrink-0 text-[9.5px] text-ink-muted">
                              {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(lesson.occurredAt))}
                            </time>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 border-t border-divider bg-canvas/95 px-1 pb-1 pt-4 backdrop-blur-sm">
          <p className="text-[10.5px] text-ink-muted">{COPY.globalAsk.courseCheatsheetMinimumHint}</p>
          <button
            type="button"
            disabled={selectedLessonIds.size < 2}
            onClick={() => {
              setStarted(true);
              if (context.pack && execution.taskState.status === 'error') void execution.rerun();
            }}
            className="rounded-full bg-pine px-5 py-2.5 text-[12px] font-medium text-white disabled:opacity-35"
          >
            {COPY.globalAsk.courseContextBeginCheatsheet(selectedLessonIds.size)}
          </button>
        </div>
      </div>
    );
  } else if (context.loading) {
    content = <AppWindowPlaceholder status="loading" appName={app.name} loadingLabel={COPY.globalAsk.courseContextCheatsheetLoading} />;
  } else if (!context.pack) {
    content = (
      <AppWindowPlaceholder
        status="empty"
        appName={app.name}
        description={COPY.globalAsk.courseContextCheatsheetNeedsTranscript(context.availableLessonCount)}
        onBack={onBack}
        backLabel={COPY.globalAsk.courseContextBackToCourse}
      />
    );
  } else if (!execution.result && execution.taskState.status === 'running') {
    content = <AppWindowPlaceholder status="loading" appName={app.name} loadingLabel={COPY.globalAsk.courseContextCheatsheetLoading} />;
  } else if (!execution.result && execution.taskState.status === 'error') {
    const errorMessage = execution.taskState.error === COPY.apps.matrix.executeNotReady
      ? COPY.globalAsk.courseContextCheatsheetNotReady
      : execution.taskState.error;
    content = (
      <AppWindowPlaceholder
        status="error"
        appName={app.name}
        errorMessage={errorMessage}
        onRetry={() => void execution.rerun()}
        onBack={onBack}
        backLabel={COPY.globalAsk.courseContextBackToCourse}
      />
    );
  } else {
    content = (
      <AppRenderSurface
        appKey="cheatsheet"
        result={execution.result}
        taskState={execution.taskState}
        sessionId={executionId}
        onRegenerate={() => void execution.rerun()}
        onResultUpdate={execution.updateResult}
      />
    );
  }

  return (
    <AppWindowShell
      app={app}
      taskState={started ? execution.taskState : IDLE_SCOPE_STATE}
      onRegenerate={() => void execution.rerun()}
      showPrimaryAction={started && Boolean(execution.result)}
      onBack={onBack}
      backLabel={COPY.globalAsk.courseContextBackToCourse}
      headerActions={execution.result ? (
        <ShareArtifactAction
          appKey="cheatsheet"
          result={execution.result}
          sessionId={executionId}
          courseTitle={selectedCourse.assessment?.name || selectedCourse.title}
          summary={shareContext}
        />
      ) : undefined}
    >
      {content}
    </AppWindowShell>
  );
}
