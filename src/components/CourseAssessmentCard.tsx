'use client';

import { useState } from 'react';
import { CalendarCheck2, Check, ChevronRight, PencilLine, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { CourseContextGroup } from '@/lib/utils/course-context';
import type { CourseAssessmentEntry, CourseContextPreference } from '@/types/user';

interface CourseAssessmentCardProps {
  course: CourseContextGroup;
  preference?: CourseContextPreference;
  saving: boolean;
  onUpdatePreference: (
    courseKey: string,
    patch: Partial<Pick<CourseContextPreference, 'assessments' | 'confirmedByUser'>>,
  ) => Promise<void>;
  onOpenCheatsheet: (course: CourseContextGroup) => void;
}

function createAssessment(courseTitle: string): CourseAssessmentEntry {
  const now = new Date().toISOString();
  return {
    id: `exam-${Date.now()}`,
    name: COPY.globalAsk.courseAssessmentDefaultName(courseTitle),
    mode: 'unknown',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

function assessmentMeta(assessment: CourseAssessmentEntry): string[] {
  const meta: string[] = [];
  if (assessment.targetDate) {
    const date = new Date(`${assessment.targetDate}T12:00:00`);
    if (!Number.isNaN(date.getTime())) {
      meta.push(new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date));
    }
  }
  if (assessment.mode === 'open-book') meta.push(COPY.globalAsk.courseAssessmentOpenBook);
  if (assessment.mode === 'closed-book') meta.push(COPY.globalAsk.courseAssessmentClosedBook);
  if (assessment.syllabus) meta.push(COPY.globalAsk.courseAssessmentHasScope);
  return meta;
}

export function CourseAssessmentCard({
  course,
  preference,
  saving,
  onUpdatePreference,
  onOpenCheatsheet,
}: CourseAssessmentCardProps) {
  const assessment = course.assessment;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CourseAssessmentEntry>(() => assessment ?? createAssessment(course.title));

  const beginEditing = () => {
    setDraft(assessment ?? createAssessment(course.title));
    setEditing(true);
  };

  const persistAssessment = async (next: CourseAssessmentEntry) => {
    const assessments = Array.isArray(preference?.assessments) ? preference.assessments : [];
    await onUpdatePreference(course.courseKey, {
      confirmedByUser: true,
      assessments: [
        ...assessments.filter((item) => item.id !== next.id),
        next,
      ],
    });
  };

  if (editing) {
    return (
      <div className="mt-3 rounded-[18px] border border-pine/18 bg-white p-3.5 sm:p-4">
        <div className="flex items-center gap-2">
          <CalendarCheck2 size={14} className="text-pine" />
          <p className="text-[12px] font-semibold text-ink">{COPY.globalAsk.courseAssessmentEditTitle}</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
          <label className="min-w-0">
            <span className="sr-only">{COPY.globalAsk.courseAssessmentName}</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder={COPY.globalAsk.courseAssessmentNameHint}
              className="h-10 w-full rounded-xl border border-divider bg-canvas px-3 text-[13px] text-ink outline-none focus:border-pine/45"
            />
          </label>
          <label>
            <span className="sr-only">{COPY.globalAsk.courseAssessmentDate}</span>
            <input
              type="date"
              value={draft.targetDate || ''}
              onChange={(event) => setDraft((current) => ({ ...current, targetDate: event.target.value || undefined }))}
              className="h-10 w-full rounded-xl border border-divider bg-canvas px-3 text-[12px] text-ink outline-none focus:border-pine/45"
              aria-label={COPY.globalAsk.courseAssessmentDate}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={COPY.globalAsk.courseAssessmentMode}>
          {([
            ['unknown', COPY.globalAsk.courseAssessmentUnknown],
            ['closed-book', COPY.globalAsk.courseAssessmentClosedBook],
            ['open-book', COPY.globalAsk.courseAssessmentOpenBook],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDraft((current) => ({ ...current, mode: value }))}
              className={cn(
                'rounded-full px-3 py-1.5 text-[11px] transition-colors',
                draft.mode === value ? 'bg-pine text-white' : 'bg-paper-warm text-ink-secondary hover:text-pine',
              )}
              aria-pressed={draft.mode === value}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="sr-only">{COPY.globalAsk.courseAssessmentScope}</span>
          <textarea
            value={draft.syllabus || ''}
            onChange={(event) => setDraft((current) => ({ ...current, syllabus: event.target.value || undefined }))}
            placeholder={COPY.globalAsk.courseAssessmentScopeHint}
            rows={2}
            className="w-full resize-none rounded-xl border border-divider bg-canvas px-3 py-2.5 text-[12px] leading-5 text-ink outline-none placeholder:text-ink-muted focus:border-pine/45"
          />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          {assessment ? (
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                await persistAssessment({ ...assessment, status: 'completed', updatedAt: new Date().toISOString() });
                setEditing(false);
              }}
              className="rounded-full px-3 py-2 text-[11px] text-ink-muted hover:bg-paper-warm hover:text-vermilion disabled:opacity-40"
            >
              {COPY.globalAsk.courseAssessmentStop}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm"
              aria-label={COPY.globalAsk.courseContextCancel}
            >
              <X size={13} />
            </button>
            <button
              type="button"
              disabled={!draft.name.trim() || saving}
              onClick={async () => {
                await persistAssessment({
                  ...draft,
                  name: draft.name.trim(),
                  status: 'active',
                  updatedAt: new Date().toISOString(),
                });
                setEditing(false);
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-pine px-3.5 text-[11px] font-medium text-white disabled:opacity-40"
            >
              <Check size={12} />{COPY.globalAsk.courseAssessmentSave}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!assessment) {
    return (
      <button
        type="button"
        onClick={beginEditing}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11.5px] text-ink-muted hover:bg-white hover:text-pine"
      >
        <CalendarCheck2 size={12} />{COPY.globalAsk.courseAssessmentAdd}
      </button>
    );
  }

  const meta = assessmentMeta(assessment);
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[18px] border border-pine/14 bg-white px-3.5 py-3">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-vermilion-fog text-vermilion">
        <CalendarCheck2 size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold text-ink">{assessment.name}</p>
        {meta.length > 0 ? <p className="mt-0.5 truncate text-[10.5px] text-ink-muted">{meta.join(' · ')}</p> : null}
      </div>
      <button
        type="button"
        onClick={beginEditing}
        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-pine"
        aria-label={COPY.globalAsk.courseAssessmentEdit}
      >
        <PencilLine size={12} />
      </button>
      {course.lessons.length >= 2 ? (
        <button
          type="button"
          onClick={() => onOpenCheatsheet(course)}
          className="inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-full bg-pine px-3 text-[11px] font-medium text-white"
        >
          {COPY.globalAsk.courseAssessmentPrepare}<ChevronRight size={11} />
        </button>
      ) : null}
    </div>
  );
}
