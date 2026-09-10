'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Clock3,
  FileText,
  MessageCircleMore,
  PencilLine,
  Sprout,
} from 'lucide-react';
import { useLearningContext } from '@/hooks/useLearningContext';
import { CourseContextSection } from '@/components/CourseContextSection';
import { MasteryTrailSection } from '@/components/MasteryTrailSection';
import { CourseCheatsheetWorkspace } from '@/components/CourseCheatsheetWorkspace';
import { AddMemoryRow, MemoryRow } from '@/components/learner-profile-rows';
import { buildLearnerProfile } from '@/components/learner-profile-model';
import { useMasteryTrail } from '@/hooks/useMasteryTrail';
import { useAuth } from '@/lib/hooks/useAuth';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import type { LearningActivityEntry } from '@/types/user';
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

function activityMeta(kind: LearningActivityEntry['kind']) {
  switch (kind) {
    case 'conversation':
      return { label: GLOBAL_ASK_COPY.recentKindConversation, icon: MessageCircleMore };
    case 'lesson':
      return { label: GLOBAL_ASK_COPY.recentKindLesson, icon: BookOpen };
    case 'app':
      return { label: GLOBAL_ASK_COPY.recentKindApp, icon: Sprout };
    case 'capture':
      return { label: GLOBAL_ASK_COPY.recentKindCapture, icon: FileText };
  }
}

export function LearningMemoryPanel({ onBack, onResumeThread, onTalkToMeetMind, initialFocus }: LearningMemoryPanelProps) {
  const context = useLearningContext();
  const { user } = useAuth();
  // 总览与问同学右侧的画像栏是同一件东西（同学眼里的你）：同一份小传、同一套可维护的行
  const { trail } = useMasteryTrail({ appId: 'my-context' });
  const profileView = useMemo(() => buildLearnerProfile({
    memories: context.memories,
    recentActivities: context.recentActivities,
    activeThread: context.activeThread,
    trail,
    knownSince: user?.createdAt,
  }), [context.activeThread, context.memories, context.recentActivities, trail, user?.createdAt]);
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
    // AppWindowShell 根是 min-h-screen 的页面级外壳；本面板挂在 fixed inset-0 里，
    // 不包滚动容器的话超出视口的内容永远无法到达（页面级 bug：速查表无法滚动）。
    return (
      <div className="flex h-full min-h-0 flex-col bg-canvas">
        <div className="min-h-0 flex-1 overflow-auto">
          <CourseCheatsheetWorkspace
            courses={cheatsheetScope.courses}
            initialCourseKeys={cheatsheetScope.initialCourseKeys}
            onBack={() => setCheatsheetScope(null)}
          />
        </div>
      </div>
    );
  }

  // 从复习页的“考试速查表”直达课程范围时，返回应该回到原来的应用矩阵，
  // 不能先把用户送进并非此次旅程目标的“我的上下文”总览。
  const backFromCurrentView = view === 'overview' || initialFocus === 'cheatsheet'
    ? onBack
    : () => setView('overview');

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-divider bg-white px-4 py-3.5 sm:px-6 sm:py-4">
        <button
          type="button"
          onClick={backFromCurrentView}
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-pine"
          aria-label={GLOBAL_ASK_COPY.memoryBack}
        >
          <ArrowLeft size={16} />
        </button>
        <h2 className="min-w-0 flex-1 text-[16px] font-semibold text-ink">{GLOBAL_ASK_COPY.memoryTitle}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-6 sm:px-6 sm:pb-10 sm:pt-9">
        <div className="mx-auto max-w-[820px]">
          {view === 'overview' ? <section>
            <div className="mb-5 flex items-end justify-between gap-4 px-1">
              <div className="min-w-0">
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-pine">{GLOBAL_ASK_COPY.profile.eyebrow}</p>
                <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.02em] text-ink sm:text-[27px]">{GLOBAL_ASK_COPY.memoryUnderstandingTitle}</h1>
              </div>
              {onTalkToMeetMind && memories.length === 0 ? (
                <button
                  type="button"
                  onClick={onTalkToMeetMind}
                  className="mb-1 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-divider bg-white px-3 py-2 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine"
                >
                  <PencilLine size={12} />{GLOBAL_ASK_COPY.memoryAddContext}
                </button>
              ) : null}
            </div>

            {/* 小传：事实说成话（与画像栏同一份） */}
            {profileView.bio.length > 0 ? (
              <p className="px-1 text-[16px] leading-[1.85] text-ink">{profileView.bio.map((sentence, index) => <span key={index}>{sentence}</span>)}</p>
            ) : (
              <p className="px-1 text-[13.5px] leading-6 text-ink-muted">{GLOBAL_ASK_COPY.memoryEmpty}</p>
            )}

            {/* 记住的：一行一件，悬停出 改 / 忘掉；同学猜的带 对 / 不对；最后一行告诉同学一件事 */}
            <p className="mt-8 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{GLOBAL_ASK_COPY.profile.sections.memories}</p>
            <ul className="mt-1 px-1">
              {profileView.memories.map((row) => (
                <MemoryRow
                  key={row.id}
                  row={row}
                  saving={context.saving}
                  onConfirm={(id) => void context.confirmMemory(id)}
                  onEdit={(id, title) => void context.updateMemory(id, { title, status: 'active' })}
                  onForget={(id) => void context.removeMemory(id)}
                  onResume={(id) => void context.updateMemory(id, { status: 'active' })}
                />
              ))}
              <AddMemoryRow saving={context.saving} onAdd={(kind, title) => void context.addMemory({ kind, title, source: 'user' })} />
            </ul>
          </section> : null}

          {/* 掌握轨迹：测验 / 闪卡 / 讲给同桌听留下的事实按概念连成线——"曾经不稳 → 现在稳"在这里被看见 */}
          {view === 'overview' ? <MasteryTrailSection /> : null}

          {view === 'overview' ? (
            <nav className="mt-9 border-t border-divider" aria-label={GLOBAL_ASK_COPY.contextLibraryNavigation}>
              <button type="button" onClick={() => setView('courses')} className="group flex w-full items-center gap-4 border-b border-divider py-5 text-left sm:py-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-pine-fog text-pine"><BookOpen size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.11em] text-vermilion">{GLOBAL_ASK_COPY.memoryCoursesTab}</span>
                  <span className="mt-1 block text-[15px] font-semibold text-ink">{GLOBAL_ASK_COPY.contextCoursesOverviewTitle}</span>
                  <span className="mt-1 block text-[11.5px] leading-5 text-ink-muted">{GLOBAL_ASK_COPY.contextCoursesOverviewBody}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
              </button>
              <button type="button" onClick={() => setView('recent')} className="group flex w-full items-center gap-4 border-b border-divider py-5 text-left sm:py-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-paper-warm text-pine"><Clock3 size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.11em] text-pine">{GLOBAL_ASK_COPY.memoryRecentTab}</span>
                  <span className="mt-1 block text-[15px] font-semibold text-ink">{GLOBAL_ASK_COPY.recentTitle}</span>
                  <span className="mt-1 block truncate text-[11.5px] leading-5 text-ink-muted">{recentActivities[0]?.title || GLOBAL_ASK_COPY.recentEmpty}</span>
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
                <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-pine">{GLOBAL_ASK_COPY.memoryRecentTab}</p>
                <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[25px]">{GLOBAL_ASK_COPY.recentTitle}</h2>
              </div>
              {recentActivities.length > 0 ? (
                <span className="mb-1 text-[11px] tabular-nums text-ink-muted">{recentActivities.length}</span>
              ) : null}
            </div>

            {context.activeThread?.status === 'active' ? (
              <div className="mb-4 rounded-[22px] border border-pine/18 bg-pine-fog px-4 py-4 sm:px-5">
                <p className="text-[11px] font-medium text-pine">{GLOBAL_ASK_COPY.threadTitle}</p>
                <p className="mt-2 text-[15px] font-semibold leading-6 text-ink">{context.activeThread.title}</p>
                {context.activeThread.lastSummary ? <p className="mt-1.5 text-[12.5px] leading-6 text-ink-secondary">{context.activeThread.lastSummary}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {onResumeThread ? (
                    <button type="button" onClick={onResumeThread} className="rounded-full bg-pine px-4 py-2 text-[11.5px] font-medium text-white">
                      {GLOBAL_ASK_COPY.threadResume}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void context.setActiveThread({ ...context.activeThread!, status: 'completed', updatedAt: new Date().toISOString() })}
                    className="rounded-full border border-divider bg-white px-4 py-2 text-[11.5px] text-ink-secondary"
                  >
                    {GLOBAL_ASK_COPY.threadComplete}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              {recentActivities.length === 0 ? (
                <div className="border-y border-divider px-1 py-8 text-[12.5px] leading-6 text-ink-muted">
                  {GLOBAL_ASK_COPY.recentEmpty}
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
                  ? GLOBAL_ASK_COPY.recentCollapse
                  : GLOBAL_ASK_COPY.recentShowAll(recentActivities.length)}
              </button>
            ) : null}
          </section> : null}
        </div>
      </div>
    </div>
  );
}
