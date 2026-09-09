/**
 * learner-profile-model — 「同学眼里的你」（纯函数，可单测）
 *
 * 问同学右侧常驻一栏画像，让用户在这里维护自己的学习画像——这是产品要养成的心智：
 * 你在 MeetMind 有一个会长大的、可以自己改的学习画像；问出去的每个问题都被它接住。
 *
 * 画像不是库存清单：顶部是同学写的一段小传（最多四句，全是事实，按"正在学 → 检验过 → 最近的课 → 你说过的"），
 * 下面才是可以逐条改 / 忘掉 / 确认的事实。只陈述学生留下的事实，不推断学习风格。
 */

import type { LearningActivityEntry, LearningMemoryEntry, LearningMemoryKind, LearningThreadEntry } from '@/types/user';
import type { MasteryTrailEntry } from '@/lib/learning/mastery-trail-model';
import { conceptLabel } from '@/lib/utils/concept-label';
import { isPlaceholderLessonTitle } from '@/lib/learning/lesson-title-generic';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';

export interface ProfileMasteryRow {
  concept: string;
  status: MasteryTrailEntry['status'];
  statusLabel: string;
  /** 点「再练」落进输入框的问题 */
  prompt: string;
}

export interface ProfileMemoryRow {
  id: string;
  kind: LearningMemoryKind;
  kindLabel: string;
  title: string;
  detail?: string;
  paused: boolean;
  /** 同学从互动里猜的、用户还没确认过 */
  guessed: boolean;
}

export interface ProfileLedger {
  days?: number;
  lessons: number;
  memories: number;
}

export interface LearnerProfileView {
  /** 小传，逐句渲染 */
  bio: string[];
  thread?: Pick<LearningThreadEntry, 'id' | 'title' | 'intent'>;
  mastery: ProfileMasteryRow[];
  memories: ProfileMemoryRow[];
  ledger: ProfileLedger;
  /** 什么都还没有：显示空态出口 */
  empty: boolean;
}

export interface LearnerProfileInput {
  memories: readonly LearningMemoryEntry[];
  recentActivities: readonly LearningActivityEntry[];
  activeThread?: LearningThreadEntry;
  trail: readonly MasteryTrailEntry[];
  /** 账号创建时间（登录用户）；访客用最早一条记录 */
  knownSince?: string;
  now?: Date;
}

const MASTERY_MAX = 5;
const BIO_MAX_SENTENCES = 4;
const TITLE_MAX = 24;
const MEMORY_KIND_ORDER: Record<LearningMemoryKind, number> = { challenge: 0, topic: 1, preference: 2, strength: 3, progress: 4 };

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  let units = 0;
  for (let i = 0; i < t.length; i += 1) {
    units += /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(t[i]) ? 2 : 1;
    if (units > max * 2) return `${t.slice(0, i).trimEnd()}…`;
  }
  return t;
}

/** 课名按「主题 · 课程 · M-D」契约只念主题 */
function lessonName(title: string): string {
  return clip(title.split(' · ')[0] || title, TITLE_MAX);
}

/** 模型写的目标句常以动词开头（"关注…" / "掌握…"）；当名词念时去掉 */
function nounPhrase(title: string): string {
  return clip(title.replace(/^(关注|掌握|理解|学习|学会|搞懂|弄懂|复习|巩固|提升|加强)\s*/, ''), TITLE_MAX);
}

function daysBetween(from: string | undefined, now: Date): number | undefined {
  if (!from) return undefined;
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return undefined;
  return Math.max(1, Math.floor((now.getTime() - start) / 86_400_000) + 1);
}

export function buildLearnerProfile(input: LearnerProfileInput): LearnerProfileView {
  const copy = GLOBAL_ASK_COPY.profile;
  const now = input.now ?? new Date();

  // 最近的课：按 sessionId 去重，跳过占位名
  const lessons: LearningActivityEntry[] = [];
  const seen = new Set<string>();
  for (const activity of [...input.recentActivities].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    if (activity.kind !== 'lesson') continue;
    const key = activity.sessionId || activity.title;
    if (seen.has(key) || isPlaceholderLessonTitle(activity.title)) continue;
    seen.add(key);
    lessons.push(activity);
  }

  const unstable = input.trail.filter((e) => e.status === 'unstable');
  const improving = input.trail.filter((e) => e.status === 'improving');
  const stable = input.trail.filter((e) => e.status === 'stable');

  const activeMemories = input.memories.filter((m) => m.status === 'active' && m.title.trim());
  const preference = activeMemories.find((m) => m.kind === 'preference');
  const challenge = activeMemories.find((m) => m.kind === 'challenge');

  // ── 小传 ──
  const bio: string[] = [];
  if (input.activeThread?.status === 'active' && input.activeThread.title.trim()) {
    bio.push(copy.bio.learning(clip(input.activeThread.title, TITLE_MAX)));
  }
  if (unstable.length + improving.length + stable.length > 0) {
    const clauses: string[] = [];
    if (unstable.length >= 2) clauses.push(copy.bio.unstableTwo(conceptLabel(unstable[0].concept), conceptLabel(unstable[1].concept)));
    else if (unstable.length === 1) clauses.push(copy.bio.unstableOne(conceptLabel(unstable[0].concept)));
    if (improving.length > 0) clauses.push(copy.bio.improving(conceptLabel(improving[0].concept)));
    if (stable.length > 0) clauses.push(copy.bio.stableCount(stable.length));
    bio.push(clauses.join(copy.bio.joiner) + copy.bio.period);
  }
  if (lessons.length === 1) bio.push(copy.bio.lessonsOne(lessonName(lessons[0].title)));
  else if (lessons.length > 1) bio.push(copy.bio.lessonsMany(lessons.length, lessonName(lessons[0].title)));
  if (bio.length < BIO_MAX_SENTENCES && preference) bio.push(copy.bio.preference(clip(preference.title.replace(/[。.]$/, ''), 30)));
  // 「还没稳」与「上次没弄明白」常是同一件事（检验事实 vs 蒸馏记忆）：字面互相包含就只说一次
  const challengeNoun = challenge ? nounPhrase(challenge.title) : '';
  const overlapsUnstable = unstable.some((e) => {
    const a = conceptLabel(e.concept).replace(/\s+/g, '');
    const b = challengeNoun.replace(/\s+/g, '');
    return Boolean(a && b) && (a.includes(b) || b.includes(a));
  });
  if (bio.length < BIO_MAX_SENTENCES && challenge && !overlapsUnstable) {
    bio.push(copy.bio.challenge(challengeNoun));
  }

  // ── 检验过的：还没稳先上，最多 5 条 ──
  const statusLabel: Record<MasteryTrailEntry['status'], string> = {
    unstable: GLOBAL_ASK_COPY.masteryTrail.statusUnstable,
    improving: GLOBAL_ASK_COPY.masteryTrail.statusImproving,
    stable: GLOBAL_ASK_COPY.masteryTrail.statusStable,
  };
  const mastery: ProfileMasteryRow[] = [...unstable, ...improving, ...stable].slice(0, MASTERY_MAX).map((entry) => {
    const label = conceptLabel(entry.concept);
    return {
      concept: label,
      status: entry.status,
      statusLabel: statusLabel[entry.status],
      prompt: entry.status === 'stable'
        ? GLOBAL_ASK_COPY.desk.promptFromImproving(label)
        : GLOBAL_ASK_COPY.desk.promptFromUnstable(label),
    };
  });

  // ── 记住的：弱项 → 在学 → 偏好 → 长处 → 进展；停用的沉底 ──
  const memories: ProfileMemoryRow[] = [...input.memories]
    .filter((m) => m.title.trim())
    .sort((a, b) => Number(a.status === 'paused') - Number(b.status === 'paused')
      || MEMORY_KIND_ORDER[a.kind] - MEMORY_KIND_ORDER[b.kind]
      || b.updatedAt.localeCompare(a.updatedAt))
    .map((m) => ({
      id: m.id,
      kind: m.kind,
      kindLabel: copy.kind[m.kind],
      title: m.title,
      detail: m.detail,
      paused: m.status === 'paused',
      guessed: m.source === 'ai' && m.status === 'active',
    }));

  // ── 台账 ──
  const earliest = [...input.recentActivities.map((a) => a.occurredAt), ...input.memories.map((m) => m.createdAt)].sort()[0];
  const ledger: ProfileLedger = {
    days: daysBetween(input.knownSince ?? earliest, now),
    lessons: lessons.length,
    memories: activeMemories.length,
  };

  const empty = bio.length === 0 && mastery.length === 0 && memories.length === 0 && !input.activeThread;
  return {
    bio,
    thread: input.activeThread?.status === 'active' ? { id: input.activeThread.id, title: input.activeThread.title, intent: input.activeThread.intent } : undefined,
    mastery,
    memories,
    ledger,
    empty,
  };
}
