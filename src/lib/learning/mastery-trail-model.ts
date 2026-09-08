/**
 * mastery-trail-model — 掌握轨迹的纯模型（客户端与服务端共用）。
 *
 * 记忆要"记得住变化"：曾经不稳 → 现在稳，是状态迁移，不是覆盖。把测验 / 闪卡 / 讲给同桌听留下的检验结果
 * 按概念聚成一条条轨迹，每条只陈述事实（哪一步、什么结果），状态词只有三个：还没稳 / 刚记住 / 已经稳了。
 *
 * 输入是 AssessmentRecord（LearningAssessmentDraft + 发生时刻）：客户端来自 review-session-outcomes（localStorage），
 * 服务端来自 LearningEvent 表的 assessment 事件（learner-context-provider）。两边同一份规则，学生在三处看到同一个自己。
 * 概念按原文归一匹配——跨应用的同义匹配留给 context 系统，这里不猜。
 */

import type { LearningAssessmentDraft, LearningAssessmentItem, LearningAssessmentOutcome } from '@/types/learning-event';
import type { LearnerConceptState } from '@/types/learner-context';

/** 一次检验 + 发生时刻（毫秒） */
export type AssessmentRecord = LearningAssessmentDraft & { at: number };

export type MasteryStatus = 'unstable' | 'improving' | 'stable';

export interface MasteryStep {
  appKey: string;
  outcome: LearningAssessmentOutcome;
  positive: boolean;
  at: number;
}

export interface MasteryTrailEntry {
  concept: string;
  status: MasteryStatus;
  steps: MasteryStep[];
  lastAt: number;
  /** 最近一次证据（回到原话用） */
  evidence?: LearningAssessmentItem['evidence'];
}

const POSITIVE: ReadonlySet<LearningAssessmentOutcome> = new Set(['correct', 'got', 'mastery']);
const NEGATIVE: ReadonlySet<LearningAssessmentOutcome> = new Set(['wrong', 'missed', 'blind-spot', 'aware-gap']);

function normalizeConcept(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}


/**
 * 按概念聚合成轨迹。状态只看事实序列：
 * - 最后一步是负的 → 还没稳
 * - 最后一步是正的，且之前出现过负的或只对过一次 → 刚记住（曾经不稳 → 现在稳，这是产品要记住的那种变化）
 * - 最后两步都是正的且没有更近的负 → 已经稳了
 * uncovered（讲给同桌听没讲到）不计入。
 */
export function buildMasteryTrail(assessments: readonly AssessmentRecord[], limit = 8): MasteryTrailEntry[] {
  const byConcept = new Map<string, { concept: string; steps: MasteryStep[]; evidence?: LearningAssessmentItem['evidence'] }>();
  const sorted = [...assessments].sort((a, b) => a.at - b.at);
  for (const assessment of sorted) {
    for (const item of assessment.items) {
      if (item.outcome === 'uncovered') continue;
      const key = normalizeConcept(item.concept);
      if (!key) continue;
      const entry = byConcept.get(key) ?? { concept: item.concept.trim(), steps: [] };
      entry.steps.push({
        appKey: assessment.appKey,
        outcome: item.outcome,
        positive: POSITIVE.has(item.outcome),
        at: assessment.at,
      });
      if (item.evidence) entry.evidence = item.evidence;
      byConcept.set(key, entry);
    }
  }
  const entries: MasteryTrailEntry[] = [];
  byConcept.forEach(({ concept, steps, evidence }) => {
    if (steps.length === 0) return;
    const last = steps[steps.length - 1];
    const prev = steps[steps.length - 2];
    let status: MasteryStatus;
    if (!last.positive) status = 'unstable';
    else if (prev && prev.positive) status = 'stable';
    else status = 'improving';
    entries.push({ concept, status, steps, lastAt: last.at, evidence });
  });
  // 还没稳的排最前（最需要被看见），其后按时间倒序
  const rank: Record<MasteryStatus, number> = { unstable: 0, improving: 1, stable: 2 };
  return entries
    .sort((a, b) => rank[a.status] - rank[b.status] || b.lastAt - a.lastAt)
    .slice(0, limit);
}

export function isNegativeOutcome(outcome: LearningAssessmentOutcome): boolean {
  return NEGATIVE.has(outcome);
}

const STATUS_RANK: Record<MasteryStatus, number> = { unstable: 0, improving: 1, stable: 2 };

function sortTrail(entries: MasteryTrailEntry[], limit: number): MasteryTrailEntry[] {
  return entries
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.lastAt - a.lastAt)
    .slice(0, limit);
}

/**
 * 服务端切片（LearnerContext.mastery）→ 轨迹条目。服务端只给 positive 不给 outcome 原词，
 * 展示层只用 positive / appKey，这里补一个等价的 outcome 让形状对齐。
 */
export function trailFromLearnerMastery(mastery: readonly LearnerConceptState[]): MasteryTrailEntry[] {
  return mastery
    .filter((state) => state.concept?.trim())
    .map((state) => {
      const lastAt = Date.parse(state.lastAt) || 0;
      const steps: MasteryStep[] = (state.steps ?? []).map((step) => ({
        appKey: step.appId,
        outcome: step.positive ? 'correct' : 'wrong',
        positive: step.positive,
        at: Date.parse(step.at) || lastAt,
      }));
      return {
        concept: state.concept.trim(),
        status: state.status,
        steps,
        lastAt,
        evidence: state.evidence ? { startMs: state.evidence.startMs, endMs: state.evidence.endMs } : undefined,
      };
    });
}

/**
 * 合并本机轨迹与服务端轨迹：同一概念（原文归一）以服务端为准——它有跨设备的完整历史；
 * 只在本机有的（访客态做的、或刚做完还没写进事件表）保留。排序规则与 buildMasteryTrail 一致。
 */
export function mergeMasteryTrails(local: readonly MasteryTrailEntry[], server: readonly MasteryTrailEntry[], limit = 8): MasteryTrailEntry[] {
  const byConcept = new Map<string, MasteryTrailEntry>();
  for (const entry of local) byConcept.set(normalizeConcept(entry.concept), entry);
  for (const entry of server) {
    const key = normalizeConcept(entry.concept);
    const mine = byConcept.get(key);
    // 本机比服务端更新（刚做完这一轮）时保留本机，否则服务端为准
    byConcept.set(key, mine && mine.lastAt > entry.lastAt ? mine : entry);
  }
  return sortTrail([...byConcept.values()], limit);
}
