/**
 * assessment-events — 把应用窗口里的一次检验结果整理成记忆事件载荷（纯函数）。
 *
 * 三个应用各自的判定词表原样进事件（correct/wrong、got/missed、teach-back 四象限 + uncovered），
 * 不在这里抹平成"稳 / 不稳"——那是物化层的事（掌握轨迹与读侧一起设计）。
 * concept 用用户看得懂的原文（题面 / 卡片正面 / 目标点），便于回放时不查库就能读。
 */

import type { TeachBackEvaluationItem } from '@/lib/ai-native/types';
import type { LearningAssessmentDraft, LearningAssessmentItem } from '@/types/learning-event';
import type { FlashcardItem } from './flashcards-window-model';
import type { QuizQuestion } from './quiz-window-model';
import { isQuizAnswerCorrect } from './quiz-window-model';

/** 窗口只负责给出 appKey + items；sessionId / lessonTitle / v 由 hook 补齐。 */
export type AssessmentDraft = LearningAssessmentDraft;

const CONCEPT_MAX_CHARS = 200;

function toConcept(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, CONCEPT_MAX_CHARS);
}

function toEvidence(startMs: number | undefined, endMs?: number): LearningAssessmentItem['evidence'] {
  if (typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0) return undefined;
  const start = Math.round(startMs);
  if (typeof endMs === 'number' && Number.isFinite(endMs) && endMs >= start) {
    return { startMs: start, endMs: Math.round(endMs) };
  }
  return { startMs: start };
}

/** 测验：只收已提交的题；主观题按学生自评（QUIZ_SELF_CORRECT / QUIZ_SELF_WRONG）计。 */
export function buildQuizAssessment(
  questions: QuizQuestion[],
  selected: Record<string, string | undefined>,
  submitted: Record<string, boolean>,
): AssessmentDraft | null {
  const items: LearningAssessmentItem[] = [];
  for (const question of questions) {
    if (!submitted[question.id]) continue;
    const concept = toConcept(question.stem);
    if (!concept) continue;
    items.push({
      concept,
      outcome: isQuizAnswerCorrect(question, selected[question.id]) ? 'correct' : 'wrong',
      evidence: toEvidence(question.evidence?.startMs),
    });
  }
  return items.length > 0 ? { appKey: 'quiz', items } : null;
}

/** 闪卡：全部打完分时调用；未打分的卡不进事件。 */
export function buildFlashcardsAssessment(
  cards: FlashcardItem[],
  scores: Record<string, 'got' | 'missed' | undefined>,
): AssessmentDraft | null {
  const items: LearningAssessmentItem[] = [];
  for (const card of cards) {
    const score = scores[card.id];
    if (!score) continue;
    const concept = toConcept(card.front);
    if (!concept) continue;
    items.push({
      concept,
      outcome: score,
      evidence: toEvidence(card.evidence?.startMs),
    });
  }
  return items.length > 0 ? { appKey: 'flashcards', items } : null;
}

/** 讲给同桌听：评估里的每个目标点一条；没被讲到的按 uncovered 留史。 */
export function buildTeachBackAssessment(items: TeachBackEvaluationItem[]): AssessmentDraft | null {
  const drafts: LearningAssessmentItem[] = [];
  for (const item of items) {
    const concept = toConcept(item.point);
    if (!concept) continue;
    drafts.push({
      concept,
      outcome: item.quadrant ?? 'uncovered',
      evidence: toEvidence(item.evidence?.startMs, item.evidence?.endMs),
    });
  }
  return drafts.length > 0 ? { appKey: 'teach-back', items: drafts } : null;
}

