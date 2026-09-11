/**
 * spaced-review-model — 闪卡跨会话间隔复习的到期模型（纯函数，客户端与服务端共用）。
 *
 * 为什么：闪卡作为产品的核心不是"这一轮翻完"，而是隔几天再翻时先来那几张该复习的。
 * 会话内已有"没记住的再来一遍"；这里把它接到跨会话——依据是同一份 assessment 事件（got / missed）：
 * 登录用户来自服务端 LearningEvent（LearnerContext.mastery[].steps），访客来自本机 review-session-outcomes。
 *
 * 规则（SM-2 思路，刻意轻）：
 *   - 没记住 → 间隔回到 1 天（明天到期），连续记住数归零，忘过的次数 +1；
 *   - 记住 → 第一次 1 天，之后每次翻倍（1 → 2 → 4 → 8 …），上限 MAX_INTERVAL_DAYS；
 *   - 同一坐（上一步之后 SAME_SITTING_MS 内）再记住一次不算"隔了一次"：间隔与连续数不变，只更新最近一次时刻——
 *     否则"没记住的再来一遍"里补上的那一次会把间隔翻倍。
 *   - 到期 = 最近一次时刻 + 间隔。还没检验过的卡没有档，按"新卡"排在到期卡之后。
 *
 * 不做：难度系数（EF）、打卡、连胜——它们要么需要用户输入四档评分，要么是 gamification，产品明确不要。
 * 概念键与 mastery-trail-model 同一规则（原文归一：空白折叠 + 小写），卡的正面就是它被检验时记的 concept。
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** 上一步之后这么久内的再次记住算同一坐 */
export const SAME_SITTING_MS = 4 * 60 * 60 * 1000;
export const MAX_INTERVAL_DAYS = 60;

export interface ReviewStep {
  positive: boolean;
  /** 毫秒时间戳 */
  at: number;
}

export interface ReviewSchedule {
  /** 最近一次检验时刻 */
  lastAt: number;
  /** 最近一次是否记住 */
  lastPositive: boolean;
  /** 当前间隔（天）：下一次到期距最近一次检验多久 */
  intervalDays: number;
  /** 到期时刻（毫秒） */
  dueAt: number;
  /** 连续记住的（隔坐）次数 */
  streak: number;
  /** 忘过几次 */
  lapses: number;
}

export function normalizeReviewConcept(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200).toLowerCase();
}

/** 一张卡的检验历史（任意顺序）→ 当前档；没有步骤返回 null */
export function scheduleFromSteps(steps: readonly ReviewStep[]): ReviewSchedule | null {
  const ordered = [...steps].filter((step) => Number.isFinite(step.at)).sort((a, b) => a.at - b.at);
  if (ordered.length === 0) return null;
  let intervalDays = 0;
  let streak = 0;
  let lapses = 0;
  let lastAt = ordered[0].at;
  let lastPositive = ordered[0].positive;
  ordered.forEach((step, index) => {
    if (!step.positive) {
      intervalDays = 1;
      streak = 0;
      lapses += 1;
    } else if (index > 0 && step.at - ordered[index - 1].at < SAME_SITTING_MS && streak > 0) {
      // 同一坐里又记住一次：不算隔了一次
    } else {
      streak += 1;
      intervalDays = streak === 1 ? 1 : Math.min(MAX_INTERVAL_DAYS, intervalDays * 2);
    }
    lastAt = step.at;
    lastPositive = step.positive;
  });
  return { lastAt, lastPositive, intervalDays, dueAt: lastAt + intervalDays * DAY_MS, streak, lapses };
}

export interface ReviewCardRef {
  id: string;
  /** 正面原文（检验时记进事件的 concept） */
  front: string;
}

export interface ReviewPlan {
  /** 复习顺序（卡 id）：到期（没记住的在前、越过期越前）→ 上次没记住但还没到期 → 新卡 → 记住了且还没到期 */
  order: string[];
  /** 到期的卡（dueAt ≤ now） */
  due: string[];
  /** 上次没记住、按间隔还没到期的卡（重开牌堆时也先来） */
  lapsed: string[];
  /** 还没检验过的卡 */
  fresh: string[];
  /** 记住了、还没到期的卡 */
  later: string[];
  /** 每张卡的档（有历史的才有） */
  schedules: Record<string, ReviewSchedule>;
}

/**
 * 一叠卡 + 每张卡的历史 → 复习计划。history 的键是 normalizeReviewConcept(front)。
 */
export function planReview(cards: readonly ReviewCardRef[], history: ReadonlyMap<string, readonly ReviewStep[]>, now: number): ReviewPlan {
  const due: Array<{ id: string; schedule: ReviewSchedule }> = [];
  const lapsed: Array<{ id: string; schedule: ReviewSchedule }> = [];
  const later: Array<{ id: string; schedule: ReviewSchedule }> = [];
  const fresh: string[] = [];
  const schedules: Record<string, ReviewSchedule> = {};
  for (const card of cards) {
    const schedule = scheduleFromSteps(history.get(normalizeReviewConcept(card.front)) ?? []);
    if (!schedule) {
      fresh.push(card.id);
      continue;
    }
    schedules[card.id] = schedule;
    if (schedule.dueAt <= now) due.push({ id: card.id, schedule });
    else if (!schedule.lastPositive) lapsed.push({ id: card.id, schedule });
    else later.push({ id: card.id, schedule });
  }
  // 到期的：没记住的在前，其后越过期越前
  due.sort((a, b) => Number(a.schedule.lastPositive) - Number(b.schedule.lastPositive) || a.schedule.dueAt - b.schedule.dueAt);
  lapsed.sort((a, b) => a.schedule.lastAt - b.schedule.lastAt);
  later.sort((a, b) => a.schedule.dueAt - b.schedule.dueAt);
  return {
    order: [...due.map((item) => item.id), ...lapsed.map((item) => item.id), ...fresh, ...later.map((item) => item.id)],
    due: due.map((item) => item.id),
    lapsed: lapsed.map((item) => item.id),
    fresh,
    later: later.map((item) => item.id),
    schedules,
  };
}

export type ReviewEntryNotice =
  /** 「上次没记住的 N 张先来」 */
  | { kind: 'missed'; count: number }
  /** 「今天到期 N 张」 */
  | { kind: 'due'; count: number }
  | null;

/**
 * 进入牌堆时那一句：到期的全是上次没记住的 → 说"上次没记住的 N 张先来"；到期里有记住过又该复习的 → 说"今天到期 N 张"；
 * 没到期但有上次没记住还没到期的 → 也说"上次没记住的 N 张先来"；全是新卡 → 不说。
 */
export function describeReviewEntry(plan: ReviewPlan): ReviewEntryNotice {
  if (plan.due.length > 0) {
    const allMissed = plan.due.every((id) => plan.schedules[id]?.lastPositive === false);
    return allMissed ? { kind: 'missed', count: plan.due.length } : { kind: 'due', count: plan.due.length };
  }
  if (plan.lapsed.length > 0) return { kind: 'missed', count: plan.lapsed.length };
  return null;
}

/** 把 assessment 事件（按概念聚的 steps）折成 planReview 要的历史表 */
export function historyFromSteps(entries: ReadonlyArray<{ concept: string; steps: ReadonlyArray<ReviewStep> }>): Map<string, ReviewStep[]> {
  const history = new Map<string, ReviewStep[]>();
  for (const entry of entries) {
    const key = normalizeReviewConcept(entry.concept);
    if (!key) continue;
    const existing = history.get(key) ?? [];
    history.set(key, [...existing, ...entry.steps]);
  }
  return history;
}
