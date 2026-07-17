'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { getWorkshopAppByKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import type { CourseContextGroup } from '@/lib/utils/course-context';
import { useCourseContextPack } from '@/hooks/useCourseContextPack';
import { useAppExecution } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { AppWindowShell } from '@/components/apps/windows/AppWindowShell';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';

interface CourseCheatsheetWorkspaceProps {
  course: CourseContextGroup;
  onBack: () => void;
}

const IDLE_SCOPE_STATE: AppTaskState = { status: 'idle', updatedAt: 0 };

export function CourseCheatsheetWorkspace({ course, onBack }: CourseCheatsheetWorkspaceProps) {
  const app = getWorkshopAppByKey('cheatsheet')!;
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<string>>(
    () => new Set(course.lessons.slice(0, 4).map((lesson) => lesson.sessionId)),
  );
  const [started, setStarted] = useState(false);
  const selectedCourse = useMemo<CourseContextGroup>(() => ({
    ...course,
    lessons: course.lessons.filter((lesson) => selectedLessonIds.has(lesson.sessionId)),
  }), [course, selectedLessonIds]);
  const executionId = useMemo(
    () => `${course.assessment ? `exam:${course.assessment.id}` : `unit:${course.courseKey}`}:${selectedCourse.lessons.map((lesson) => lesson.sessionId).sort().join(',')}`,
    [course.assessment, course.courseKey, selectedCourse.lessons],
  );
  const context = useCourseContextPack(selectedCourse);
  const execution = useAppExecution({
    app,
    sessionId: executionId,
    dataSource: 'unknown',
    transcript: [],
    anchors: [],
    contextTitle: course.title,
    contextPack: context.pack ?? undefined,
    autoRun: started && Boolean(context.pack),
  });

  let content;
  if (!started) {
    content = (
      <div className="mx-auto flex min-h-[520px] w-full max-w-[720px] flex-col px-4 py-7 sm:px-6 sm:py-10">
        <div className="px-1">
          {course.assessment ? (
            <p className="mb-2 font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-vermilion">
              {course.assessment.name}
            </p>
          ) : null}
          <h2 className="font-serif text-[26px] italic tracking-[-0.03em] text-ink sm:text-[30px]">
            {course.assessment ? COPY.globalAsk.courseAssessmentChooseScope : COPY.globalAsk.courseContextChooseLessons}
          </h2>
          <p className="mt-2 text-[12.5px] leading-6 text-ink-secondary">
            {COPY.globalAsk.courseContextChooseLessonsHint}
          </p>
        </div>
        <div className="mt-6 space-y-2">
          {course.lessons.map((lesson) => {
            const selected = selectedLessonIds.has(lesson.sessionId);
            return (
              <button
                key={lesson.sessionId}
                type="button"
                onClick={() => setSelectedLessonIds((current) => {
                  const next = new Set(current);
                  if (next.has(lesson.sessionId)) next.delete(lesson.sessionId);
                  else next.add(lesson.sessionId);
                  return next;
                })}
                className={`flex w-full items-center gap-3 rounded-[16px] border px-4 py-3.5 text-left transition ${
                  selected ? 'border-pine/30 bg-pine-fog' : 'border-divider bg-white hover:border-pine/20'
                }`}
                aria-pressed={selected}
              >
                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border ${
                  selected ? 'border-pine bg-pine text-white' : 'border-divider bg-white text-transparent'
                }`}>
                  <Check size={12} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{lesson.title}</span>
                <time className="flex-shrink-0 text-[10.5px] text-ink-muted">
                  {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(lesson.occurredAt))}
                </time>
              </button>
            );
          })}
        </div>
        <div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-divider bg-canvas/95 px-1 pb-1 pt-5 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setSelectedLessonIds(new Set(course.lessons.map((lesson) => lesson.sessionId)))}
            className="rounded-full px-3 py-2 text-[11.5px] text-ink-muted hover:bg-white hover:text-pine"
          >
            {COPY.globalAsk.courseContextSelectAll}
          </button>
          <button
            type="button"
            disabled={selectedLessonIds.size < 2}
            onClick={() => {
              setStarted(true);
              // A previous attempt may have failed for this exact scope. A new
              // explicit start should retry it; successful cached work is kept.
              if (context.pack && execution.taskState.status === 'error') {
                void execution.rerun();
              }
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
    >
      {content}
    </AppWindowShell>
  );
}
