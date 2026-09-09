/**
 * sidebar-recent-model — 侧栏「继续学习 / 最近」的数据（纯函数，可单测）
 *
 * 侧栏本身要有内容（HyperKnow 的 Continue Learning / Recent Activities），不能只是五个入口。
 * 继续学习：有活着的学习线索就是线索，否则是上一节课；最近：可复习的课按时间倒序，去重同一节，最多 6 条。
 * 课名按「主题 · 课程 · M-D」契约只念主题；日期念相对的（今天 / 昨天 / M-D）。
 */

import type { LearningThreadEntry } from '@/types/user';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';
import { COPY } from '@/lib/ui/copy';

export interface SidebarLessonInput {
  id: string;
  title: string;
  /** ISO；排序与相对日期用 */
  at: string;
  /** 同一节课可能有多条收集项（录音 + 视频）；有 sessionId 就按它去重 */
  sessionId?: string | null;
  /** 当前正打开的一节 */
  active?: boolean;
}

export interface SidebarLessonRow {
  id: string;
  title: string;
  fullTitle: string;
  when: string;
  active: boolean;
}

export interface SidebarContinueItem {
  kind: 'thread' | 'lesson';
  kindLabel: string;
  id: string;
  title: string;
  detail?: string;
}

export interface SidebarRecent {
  continueItem?: SidebarContinueItem;
  lessons: SidebarLessonRow[];
  /** 超出展示上限的数量 */
  more: number;
}

const MAX_LESSONS = 6;

function topic(title: string): string {
  return (title.split(' · ')[0] || title).trim();
}

export function relativeDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diffDays <= 0) return COPY.navigation.today;
  if (diffDays === 1) return COPY.navigation.yesterday;
  return `${date.getMonth() + 1}-${date.getDate()}`;
}

export function buildSidebarRecent(input: {
  lessons: readonly SidebarLessonInput[];
  activeThread?: LearningThreadEntry;
  now?: Date;
}): SidebarRecent {
  const now = input.now ?? new Date();
  const seen = new Set<string>();
  const ordered: SidebarLessonInput[] = [];
  for (const lesson of [...input.lessons].sort((a, b) => b.at.localeCompare(a.at))) {
    if (!lesson.title.trim()) continue;
    const key = lesson.sessionId || lesson.id;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(lesson);
  }

  const rows: SidebarLessonRow[] = ordered.slice(0, MAX_LESSONS).map((lesson) => ({
    id: lesson.id,
    title: isPlaceholderLessonTitle(lesson.title) ? lesson.title : topic(lesson.title),
    fullTitle: lesson.title,
    when: relativeDay(lesson.at, now),
    active: Boolean(lesson.active),
  }));

  let continueItem: SidebarContinueItem | undefined;
  if (input.activeThread?.status === 'active' && input.activeThread.title.trim()) {
    continueItem = {
      kind: 'thread',
      kindLabel: COPY.navigation.continueThread,
      id: input.activeThread.id,
      title: input.activeThread.title,
      detail: input.activeThread.nextStep || input.activeThread.lastSummary || undefined,
    };
  } else if (ordered[0] && !ordered[0].active) {
    continueItem = {
      kind: 'lesson',
      kindLabel: COPY.navigation.continueLesson,
      id: ordered[0].id,
      title: topic(ordered[0].title),
      detail: relativeDay(ordered[0].at, now),
    };
  }

  return { continueItem, lessons: rows, more: Math.max(0, ordered.length - MAX_LESSONS) };
}
