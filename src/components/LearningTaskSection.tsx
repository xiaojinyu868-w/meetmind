'use client';

import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  FileText,
  MessageCircleMore,
  Pause,
  Play,
  RotateCcw,
  Sprout,
} from 'lucide-react';
import { useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { LearningActivityEntry, LearningThreadEntry } from '@/types/user';
import { selectLearningTaskEvidence, type LearningTaskRow } from './learning-task-section-model';

interface LearningTaskSectionProps {
  tasks: LearningTaskRow[];
  recentActivities: LearningActivityEntry[];
  saving: boolean;
  onChangeThread: (thread: LearningThreadEntry) => Promise<void>;
  onResumeThread?: (thread: LearningThreadEntry) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function activityIcon(kind: LearningActivityEntry['kind']) {
  switch (kind) {
    case 'conversation': return MessageCircleMore;
    case 'lesson': return BookOpen;
    case 'app': return Sprout;
    case 'capture': return FileText;
  }
}

function statusMeta(status: LearningThreadEntry['status']) {
  switch (status) {
    case 'active':
      return { label: COPY.globalAsk.taskStatusActive, icon: CircleDot, tone: 'text-pine bg-pine-fog' };
    case 'paused':
      return { label: COPY.globalAsk.taskStatusPaused, icon: Pause, tone: 'text-ink-secondary bg-paper-warm' };
    case 'completed':
      return { label: COPY.globalAsk.taskStatusCompleted, icon: Check, tone: 'text-ink-muted bg-paper-warm' };
  }
}

export function LearningTaskSection({
  tasks,
  recentActivities,
  saving,
  onChangeThread,
  onResumeThread,
}: LearningTaskSectionProps) {
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const changeStatus = async (
    thread: LearningThreadEntry,
    status: LearningThreadEntry['status'],
    resume = false,
  ) => {
    const next = { ...thread, status, updatedAt: new Date().toISOString() };
    await onChangeThread(next);
    if (resume) onResumeThread?.(next);
  };

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4 px-1">
        <div>
          <p className="font-mono text-[9.5px] font-semibold uppercase text-vermilion">{COPY.globalAsk.memoryTasksTab}</p>
          <h2 className="mt-2 font-serif text-[25px] italic text-ink sm:text-[28px]">{COPY.globalAsk.taskTitle}</h2>
        </div>
        {tasks.length > 0 ? (
          <span className="mb-1 text-[11px] tabular-nums text-ink-muted">{COPY.globalAsk.taskCount(tasks.length)}</span>
        ) : null}
      </div>

      {tasks.length === 0 ? (
        <div className="border-y border-divider px-1 py-8 text-[12.5px] leading-6 text-ink-muted">
          {COPY.globalAsk.taskEmpty}
        </div>
      ) : (
        <div className="border-t border-divider">
          {tasks.map(({ thread, lessonCount, activityCount }) => {
            const meta = statusMeta(thread.status);
            const StatusIcon = meta.icon;
            const evidence = COPY.globalAsk.taskEvidence(lessonCount, activityCount);
            const evidenceItems = selectLearningTaskEvidence(thread, recentActivities);
            const evidenceExpanded = expandedTaskId === thread.id;
            return (
              <article key={thread.id} className="border-b border-divider py-5 sm:py-6">
                <div className="flex items-start gap-3.5">
                  <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[13px]', meta.tone)}>
                    <StatusIcon size={15} strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn('text-[10.5px] font-medium', thread.status === 'active' ? 'text-pine' : 'text-ink-muted')}>
                        {meta.label}
                      </span>
                      <span className="text-[10.5px] text-ink-muted">{COPY.globalAsk.taskUpdated(formatDate(thread.updatedAt))}</span>
                      {evidence ? <span className="text-[10.5px] text-ink-muted">{evidence}</span> : null}
                    </div>
                    <h3 className="mt-2 text-[15px] font-semibold leading-6 text-ink">{thread.title}</h3>
                    {thread.lastSummary ? (
                      <p className="mt-2 text-[12.5px] leading-6 text-ink-secondary">
                        <span className="font-medium text-ink-muted">{COPY.globalAsk.taskProgress}</span>{thread.lastSummary}
                      </p>
                    ) : null}
                    {thread.nextStep && thread.status !== 'completed' ? (
                      <p className="mt-1 text-[12.5px] leading-6 text-ink-secondary">
                        <span className="font-medium text-ink-muted">{COPY.globalAsk.taskNextStep}</span>{thread.nextStep}
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {thread.status === 'active' ? (
                        <>
                          {onResumeThread ? (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => onResumeThread(thread)}
                              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-pine px-3.5 py-2 text-[11.5px] font-medium text-white disabled:opacity-40 sm:min-h-9"
                            >
                              <Play size={12} />{COPY.globalAsk.taskResume}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void changeStatus(thread, 'paused')}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-divider bg-white px-3.5 py-2 text-[11.5px] text-ink-secondary disabled:opacity-40 sm:min-h-9"
                          >
                            <Pause size={12} />{COPY.globalAsk.taskPause}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void changeStatus(thread, 'completed')}
                            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-[11.5px] text-ink-muted hover:bg-paper-warm disabled:opacity-40 sm:min-h-9"
                          >
                            <Check size={12} />{COPY.globalAsk.taskComplete}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void changeStatus(thread, 'active', true)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-divider bg-white px-3.5 py-2 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine disabled:opacity-40 sm:min-h-9"
                        >
                          {thread.status === 'completed' ? <RotateCcw size={12} /> : <Play size={12} />}
                          {thread.status === 'completed' ? COPY.globalAsk.taskReopen : COPY.globalAsk.taskResume}
                        </button>
                      )}
                    </div>
                    {activityCount > 0 ? (
                      <>
                        <button
                          type="button"
                          aria-expanded={evidenceExpanded}
                          onClick={() => setExpandedTaskId(evidenceExpanded ? null : thread.id)}
                          className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5 py-2 text-[11.5px] text-ink-muted hover:bg-paper-warm hover:text-pine sm:min-h-9"
                        >
                          {evidenceExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          {evidenceExpanded ? COPY.globalAsk.taskEvidenceCollapse : COPY.globalAsk.taskEvidenceAction}
                        </button>
                        {evidenceExpanded ? (
                          <div className="mt-2 border-l border-pine/25 pl-3">
                            <p className="text-[10.5px] font-medium text-pine">{COPY.globalAsk.taskEvidenceHeading}</p>
                            {evidenceItems.length > 0 ? evidenceItems.map((activity) => {
                              const ActivityIcon = activityIcon(activity.kind);
                              return (
                                <div key={activity.id} className="mt-3 flex items-start gap-2.5">
                                  <ActivityIcon className="mt-0.5 shrink-0 text-ink-muted" size={13} strokeWidth={1.8} />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                      <p className="text-[12px] leading-5 text-ink">{activity.title}</p>
                                      <time className="shrink-0 text-[10px] text-ink-muted">{formatDate(activity.occurredAt)}</time>
                                    </div>
                                    {activity.detail ? <p className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-ink-secondary">{activity.detail}</p> : null}
                                  </div>
                                </div>
                              );
                            }) : (
                              <p className="mt-2 text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.taskEvidenceUnavailable}</p>
                            )}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
