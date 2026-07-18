'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  FileText,
  Lightbulb,
  MessageCircleMore,
  MoreHorizontal,
  Pause,
  PencilLine,
  Play,
  Sparkles,
  Sprout,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { useLearningContext, type UseLearningContextReturn } from '@/hooks/useLearningContext';
import { CourseContextSection } from '@/components/CourseContextSection';
import { CourseCheatsheetWorkspace } from '@/components/CourseCheatsheetWorkspace';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import type { LearningActivityEntry, LearningMemoryEntry, LearningMemoryKind } from '@/types/user';
import type { CourseContextGroup } from '@/lib/utils/course-context';

interface LearningMemoryPanelProps {
  onBack: () => void;
  onResumeThread?: () => void;
  onTalkToMeetMind?: () => void;
  initialFocus?: 'cheatsheet';
}

function formatDate(value: string, includeTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', includeTime
    ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'numeric', day: 'numeric' }).format(date);
}

function memoryKindMeta(kind: LearningMemoryKind) {
  switch (kind) {
    case 'preference':
      return { label: COPY.globalAsk.memoryKindPreference, icon: Compass, tone: 'text-pine bg-pine-fog' };
    case 'strength':
      return { label: COPY.globalAsk.memoryKindStrength, icon: Sprout, tone: 'text-pine bg-pine-fog' };
    case 'challenge':
      return { label: COPY.globalAsk.memoryKindChallenge, icon: Lightbulb, tone: 'text-vermilion bg-vermilion-fog' };
    case 'topic':
      return { label: COPY.globalAsk.memoryKindTopic, icon: Target, tone: 'text-ink-secondary bg-paper-warm' };
    case 'progress':
      return { label: COPY.globalAsk.memoryKindProgress, icon: Sparkles, tone: 'text-pine bg-pine-fog' };
  }
}

function activityMeta(kind: LearningActivityEntry['kind']) {
  switch (kind) {
    case 'conversation':
      return { label: COPY.globalAsk.recentKindConversation, icon: MessageCircleMore };
    case 'lesson':
      return { label: COPY.globalAsk.recentKindLesson, icon: BookOpen };
    case 'app':
      return { label: COPY.globalAsk.recentKindApp, icon: Sprout };
    case 'capture':
      return { label: COPY.globalAsk.recentKindCapture, icon: FileText };
  }
}

function MemoryCard({
  memory,
  context,
}: {
  memory: LearningMemoryEntry;
  context: Pick<UseLearningContextReturn, 'saving' | 'updateMemory' | 'removeMemory'>;
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(memory.title);
  const meta = memoryKindMeta(memory.kind);
  const Icon = meta.icon;
  const paused = memory.status === 'paused';

  return (
    <article className={cn(
      'relative rounded-[22px] border bg-white px-4 py-4 sm:px-5 sm:py-5',
      paused ? 'border-divider/70 opacity-70' : 'border-divider',
    )}>
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl', meta.tone)}>
          <Icon size={15} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="pt-1 text-[11.5px] font-medium text-ink-secondary">{meta.label}</p>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink"
                aria-label={COPY.globalAsk.memoryMore}
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-9 z-10 w-36 overflow-hidden rounded-2xl border border-divider bg-white py-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void context.updateMemory(memory.id, { status: paused ? 'active' : 'paused' });
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[12px] text-ink-secondary hover:bg-paper-warm"
                  >
                    {paused ? <Play size={13} /> : <Pause size={13} />}
                    {paused ? COPY.globalAsk.memoryUseAgain : COPY.globalAsk.memoryStopUsing}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void context.removeMemory(memory.id);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[12px] text-vermilion hover:bg-vermilion-fog"
                  >
                    <Trash2 size={13} />{COPY.globalAsk.memoryForget}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {editing ? (
            <div className="mt-3">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={3}
                autoFocus
                placeholder={COPY.globalAsk.memoryCorrectionHint}
                className="w-full resize-none rounded-2xl border border-pine/25 bg-canvas px-3.5 py-3 text-[14px] leading-6 text-ink outline-none focus:border-pine/45"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setDraft(memory.title); setEditing(false); }}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[11.5px] text-ink-muted hover:bg-paper-warm"
                >
                  <X size={12} />{COPY.globalAsk.memoryCorrectionCancel}
                </button>
                <button
                  type="button"
                  disabled={!draft.trim() || context.saving}
                  onClick={async () => {
                    await context.updateMemory(memory.id, { title: draft.trim(), status: 'active' });
                    setEditing(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-pine px-3.5 py-2 text-[11.5px] font-medium text-white disabled:opacity-40"
                >
                  <Check size={12} />{COPY.globalAsk.memoryCorrectionSave}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className={cn('mt-3 text-[15px] leading-7 sm:text-[15.5px]', paused ? 'text-ink-muted' : 'text-ink')}>
                {memory.title}
              </p>
              {memory.detail ? <p className="mt-2 text-[12.5px] leading-6 text-ink-secondary">{memory.detail}</p> : null}
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-divider/70 pt-3">
            <span className="text-[10.5px] text-ink-muted">
              {paused
                ? COPY.globalAsk.memoryPaused
                : memory.source === 'user'
                  ? COPY.globalAsk.memorySourceUser
                  : COPY.globalAsk.memorySourceAi}
              {' · '}{formatDate(memory.updatedAt)}
            </span>
            {!editing ? (
              <button
                type="button"
                onClick={() => { setDraft(memory.title); setEditing(true); }}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] text-ink-muted hover:bg-paper-warm hover:text-pine"
              >
                <PencilLine size={12} />{COPY.globalAsk.memoryCorrection}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function LearningMemoryPanel({ onBack, onResumeThread, onTalkToMeetMind, initialFocus }: LearningMemoryPanelProps) {
  const context = useLearningContext();
  const [view, setView] = useState<'overview' | 'courses' | 'recent'>(() => initialFocus === 'cheatsheet' ? 'courses' : 'overview');
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [focusCheatsheet, setFocusCheatsheet] = useState(initialFocus === 'cheatsheet');
  const [cheatsheetScope, setCheatsheetScope] = useState<{
    courses: CourseContextGroup[];
    initialCourseKeys?: string[];
  } | null>(null);

  const memories = useMemo(() => context.memories
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [context.memories]);
  const recentActivities = useMemo(() => context.recentActivities
    .slice()
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [context.recentActivities]);
  const visibleActivities = showAllRecent ? recentActivities : recentActivities.slice(0, 3);

  if (cheatsheetScope) {
    return (
      <CourseCheatsheetWorkspace
        courses={cheatsheetScope.courses}
        initialCourseKeys={cheatsheetScope.initialCourseKeys}
        onBack={() => setCheatsheetScope(null)}
      />
    );
  }

  const backFromCurrentView = view === 'overview' ? onBack : () => setView('overview');

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-divider bg-white px-4 py-3.5 sm:px-6 sm:py-4">
        <button
          type="button"
          onClick={backFromCurrentView}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-pine"
          aria-label={COPY.globalAsk.memoryBack}
        >
          <ArrowLeft size={16} />
        </button>
        <h2 className="min-w-0 flex-1 text-[16px] font-semibold text-ink">{COPY.globalAsk.memoryTitle}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 sm:px-6 sm:pb-10 sm:pt-9">
        <div className="mx-auto max-w-[820px]">
          {view === 'overview' ? <section>
            <div className="mb-5 flex items-end justify-between gap-4 px-1">
              <div className="min-w-0">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-vermilion">{COPY.globalAsk.memoryUnderstandingTab}</p>
                <h1 className="mt-2 font-serif text-[27px] italic tracking-[-0.03em] text-ink sm:text-[31px]">{COPY.globalAsk.memoryUnderstandingTitle}</h1>
              </div>
              {onTalkToMeetMind && memories.length === 0 ? (
                <button
                  type="button"
                  onClick={onTalkToMeetMind}
                  className="mb-1 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-divider bg-white px-3 py-2 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine"
                >
                  <PencilLine size={12} />{COPY.globalAsk.memoryAddContext}
                </button>
              ) : null}
            </div>

            <div className="space-y-3">
              {memories.length === 0 ? (
                <div className="border-y border-divider px-1 py-7 text-[12.5px] leading-6 text-ink-muted sm:py-9">
                  {COPY.globalAsk.memoryEmpty}
                </div>
              ) : memories.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} context={context} />
              ))}
            </div>
          </section> : null}

          {view === 'overview' ? (
            <nav className="mt-9 border-t border-divider" aria-label={COPY.globalAsk.contextLibraryNavigation}>
              <button type="button" onClick={() => setView('courses')} className="group flex w-full items-center gap-4 border-b border-divider py-5 text-left sm:py-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-pine-fog text-pine"><BookOpen size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.11em] text-vermilion">{COPY.globalAsk.memoryCoursesTab}</span>
                  <span className="mt-1 block text-[15px] font-semibold text-ink">{COPY.globalAsk.contextCoursesOverviewTitle}</span>
                  <span className="mt-1 block text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.contextCoursesOverviewBody}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
              </button>
              <button type="button" onClick={() => setView('recent')} className="group flex w-full items-center gap-4 border-b border-divider py-5 text-left sm:py-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-paper-warm text-pine"><Clock3 size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.11em] text-pine">{COPY.globalAsk.memoryRecentTab}</span>
                  <span className="mt-1 block text-[15px] font-semibold text-ink">{COPY.globalAsk.recentTitle}</span>
                  <span className="mt-1 block truncate text-[11.5px] leading-5 text-ink-muted">{recentActivities[0]?.title || COPY.globalAsk.recentEmpty}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
              </button>
            </nav>
          ) : null}

          {view === 'courses' ? (
            <CourseContextSection
              preferences={context.coursePreferences || []}
              saving={context.saving}
              onUpdatePreference={context.updateCoursePreference}
              onOpenCheatsheet={(courses, initialCourseKeys) => {
                setFocusCheatsheet(false);
                setCheatsheetScope({ courses, initialCourseKeys });
              }}
              focusCheatsheet={focusCheatsheet}
              standalone
            />
          ) : null}

          {view === 'recent' ? <section>
            <div className="mb-5 flex items-end justify-between gap-4 px-1">
              <div>
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-pine">{COPY.globalAsk.memoryRecentTab}</p>
                <h2 className="mt-2 font-serif text-[25px] italic tracking-[-0.025em] text-ink sm:text-[28px]">{COPY.globalAsk.recentTitle}</h2>
              </div>
              {recentActivities.length > 0 ? (
                <span className="mb-1 text-[11px] tabular-nums text-ink-muted">{recentActivities.length}</span>
              ) : null}
            </div>

            {context.activeThread?.status === 'active' ? (
              <div className="mb-4 rounded-[22px] border border-pine/18 bg-pine-fog px-4 py-4 sm:px-5">
                <p className="text-[11px] font-medium text-pine">{COPY.globalAsk.threadTitle}</p>
                <p className="mt-2 text-[15px] font-semibold leading-6 text-ink">{context.activeThread.title}</p>
                {context.activeThread.lastSummary ? <p className="mt-1.5 text-[12.5px] leading-6 text-ink-secondary">{context.activeThread.lastSummary}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {onResumeThread ? (
                    <button type="button" onClick={onResumeThread} className="rounded-full bg-pine px-4 py-2 text-[11.5px] font-medium text-white">
                      {COPY.globalAsk.threadResume}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void context.setActiveThread({ ...context.activeThread!, status: 'completed', updatedAt: new Date().toISOString() })}
                    className="rounded-full border border-divider bg-white px-4 py-2 text-[11.5px] text-ink-secondary"
                  >
                    {COPY.globalAsk.threadComplete}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              {recentActivities.length === 0 ? (
                <div className="border-y border-divider px-1 py-8 text-[12.5px] leading-6 text-ink-muted">
                  {COPY.globalAsk.recentEmpty}
                </div>
              ) : visibleActivities.map((activity) => {
                const meta = activityMeta(activity.kind);
                const Icon = meta.icon;
                return (
                  <article key={activity.id} className="rounded-[20px] border border-divider bg-white px-4 py-4 sm:px-5">
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-paper-warm text-pine">
                        <Icon size={14} strokeWidth={1.8} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] font-medium text-ink-muted">{meta.label}</p>
                          <time className="flex-shrink-0 text-[10.5px] text-ink-muted">{formatDate(activity.occurredAt, true)}</time>
                        </div>
                        <p className="mt-2 text-[14.5px] leading-6 text-ink">{activity.title}</p>
                        {activity.detail ? <p className="mt-1.5 line-clamp-3 text-[12px] leading-5 text-ink-secondary">{activity.detail}</p> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {recentActivities.length > 3 ? (
              <button
                type="button"
                onClick={() => setShowAllRecent((value) => !value)}
                className="mt-4 w-full rounded-[16px] border border-divider bg-white px-4 py-3 text-[12px] text-ink-secondary hover:border-pine/20 hover:text-pine"
              >
                {showAllRecent
                  ? COPY.globalAsk.recentCollapse
                  : COPY.globalAsk.recentShowAll(recentActivities.length)}
              </button>
            ) : null}
          </section> : null}
        </div>
      </div>
    </div>
  );
}
