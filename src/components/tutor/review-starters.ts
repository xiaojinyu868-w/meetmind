/**
 * review-starters — 复习态同桌的开场（纯函数）。
 *
 * 同桌是听过这节课的人，开场不该是"同学在这里。"这种谁都能说的话：
 * 有标记就点名时刻（学生能核对），没有就退回通用起手。不推断学习风格，不下命令。
 */

import type { Anchor } from '@/types';
import { COPY } from '@/lib/ui/copy';
import { describeMoment, type MomentSegment } from '@/lib/learning/moment-title';

export interface ReviewStarterInput {
  anchors: ReadonlyArray<Pick<Anchor, 'timestamp' | 'cancelled' | 'resolved'> & { note?: string | null }>;
  keyDifficulties?: readonly string[];
  /** 有转录就能给每个时刻起名（老师那一刻的原话 / 学生备注），chip 不再只是一个时间 */
  segments?: readonly MomentSegment[];
}

export interface ReviewOpening {
  /** 「同学」后面那半句 */
  lead: string;
  prompts: string[];
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function buildReviewOpening(input: ReviewStarterInput): ReviewOpening {
  const copy = COPY.tutor.reviewOpening;
  const active = input.anchors
    .filter((anchor) => !anchor.cancelled && !anchor.resolved)
    .sort((a, b) => a.timestamp - b.timestamp);
  const difficulties = (input.keyDifficulties ?? []).map((item) => item.trim()).filter(Boolean);
  const prompts: string[] = [];

  for (const anchor of active.slice(0, 2)) {
    const named = describeMoment(anchor, input.segments ?? []);
    prompts.push(named.title ? copy.anchorPromptNamed(fmtTime(anchor.timestamp), named.title) : copy.anchorPrompt(fmtTime(anchor.timestamp)));
  }
  if (prompts.length < 3 && difficulties[0]) {
    prompts.push(copy.difficultyPrompt(difficulties[0].slice(0, 16)));
  }
  for (const fallback of COPY.tutor.reviewStarters) {
    if (prompts.length >= 3) break;
    if (!prompts.includes(fallback)) prompts.push(fallback);
  }

  const lead = active.length > 0
    ? copy.leadWithAnchors(active.length, active.slice(0, 2).map((anchor) => fmtTime(anchor.timestamp)))
    : difficulties.length > 0
      ? copy.leadWithDifficulties(difficulties.length)
      : COPY.tutor.emptyAfterName;

  return { lead, prompts: prompts.slice(0, 3) };
}
