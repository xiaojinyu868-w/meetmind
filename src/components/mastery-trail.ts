/**
 * mastery-trail — 「我的上下文」里的掌握轨迹（纯函数 + 本机数据读取）。
 *
 * 记忆要"记得住变化"：曾经不稳 → 现在稳，是状态迁移，不是覆盖。这里把测验 / 闪卡 / 讲给同桌听
 * 留在本机的检验结果（review-session-outcomes，按课存 localStorage）按概念聚成一条条轨迹，
 * 每条只陈述事实（哪一步、什么结果），状态词也只有三个：还没稳 / 刚记住 / 已经稳了。
 *
 * 数据边界：现在读的是这台设备上的会话层结果；外部 context 系统合并后，同一形状由它供给
 * （docs/plans/2026-09-08-product-renewal-plan.md §6 读契约）。概念按原文归一匹配——跨应用的
 * 同义匹配留给 context 系统，这里不猜。
 */

import type { LearningAssessmentItem, LearningAssessmentOutcome } from '@/types/learning-event';
import type { StoredAssessment } from '@/components/apps/review-session-outcomes';

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
const STORAGE_PREFIX = 'mm-review-outcomes:';

function normalizeConcept(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// 概念展示名统一在 lib/utils/concept-label（课后路径的推荐理由也用它）；这里 re-export 供既有消费方
export { conceptLabel } from '@/lib/utils/concept-label';

/** 扫这台设备上所有课的会话层结果（只读）。 */
export function collectDeviceOutcomes(): StoredAssessment[] {
  if (typeof window === 'undefined') return [];
  const out: StoredAssessment[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (item && typeof (item as StoredAssessment).appKey === 'string' && Array.isArray((item as StoredAssessment).items)) {
          out.push(item as StoredAssessment);
        }
      }
    }
  } catch { /* 隐私模式或配额：没有轨迹就不显示 */ }
  return out;
}

/**
 * 按概念聚合成轨迹。状态只看事实序列：
 * - 最后一步是负的 → 还没稳
 * - 最后一步是正的，且之前出现过负的或只对过一次 → 刚记住（曾经不稳 → 现在稳，这是产品要记住的那种变化）
 * - 最后两步都是正的且没有更近的负 → 已经稳了
 * uncovered（讲给同桌听没讲到）不计入。
 */
export function buildMasteryTrail(assessments: readonly StoredAssessment[], limit = 8): MasteryTrailEntry[] {
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
