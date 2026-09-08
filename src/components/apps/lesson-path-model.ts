/**
 * lesson-path-model — 课后学习页 v2 的纯函数层：
 *
 * - 学习路径四步（检验 → 记住 → 讲出来 → 带走）是页面的骨架，取代"按类别陈列 8 张卡"
 * - 会话内结果（review-session-outcomes）→ 每一步的结果摘要（"5 题对 3"）
 * - 「先做这一件」的推荐：只用学生能核对的事实（标记时刻、难点、上一步的结果），
 *   说得出"为什么是它"；不推断学习风格，不替用户做决定（一个默认动作 + 全部可选）
 * - 结果 → 下一步的困惑上下文（测验错的点作为合成锚点进闪卡 / 讲给同桌听的 prompt）
 *
 * 全部纯函数，可单测；视觉与状态机在 WorkshopYellowPage / WorkshopAppCard。
 */

import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { conceptLabel } from '@/lib/utils/concept-label';
import type { Anchor, TranscriptSegment } from '@/types';
import type { LearningAssessmentDraft, LearningAssessmentItem } from '@/types/learning-event';
import { COPY } from '@/lib/ui/copy';

/** 路径顺序即学习顺序：先暴露问题，再巩固，再输出，最后带走。 */
export const LEARNING_PATH: readonly WorkshopAppKey[] = ['quiz', 'flashcards', 'teach-back', 'infographic'];

export function isPathApp(key: WorkshopAppKey): boolean {
  return LEARNING_PATH.includes(key);
}

export interface QuizOutcome {
  kind: 'quiz';
  total: number;
  correct: number;
  wrongConcepts: LearningAssessmentItem[];
}
export interface FlashcardsOutcome {
  kind: 'flashcards';
  total: number;
  got: number;
  missedConcepts: LearningAssessmentItem[];
}
export interface TeachBackOutcome {
  kind: 'teach-back';
  total: number;
  mastery: number;
  blindSpot: number;
  gap: number;
  weakConcepts: LearningAssessmentItem[];
}
export type AppOutcome = QuizOutcome | FlashcardsOutcome | TeachBackOutcome;

export interface SessionOutcomeSummary {
  quiz?: QuizOutcome;
  flashcards?: FlashcardsOutcome;
  teachBack?: TeachBackOutcome;
}

/** 每个应用取最近一次结果。 */
export function summarizeSessionOutcomes(assessments: readonly LearningAssessmentDraft[]): SessionOutcomeSummary {
  const latest = new Map<string, LearningAssessmentDraft>();
  for (const draft of assessments) latest.set(draft.appKey, draft);
  const summary: SessionOutcomeSummary = {};

  const quiz = latest.get('quiz');
  if (quiz) {
    summary.quiz = {
      kind: 'quiz',
      total: quiz.items.length,
      correct: quiz.items.filter((item) => item.outcome === 'correct').length,
      wrongConcepts: quiz.items.filter((item) => item.outcome === 'wrong'),
    };
  }
  const flashcards = latest.get('flashcards');
  if (flashcards) {
    summary.flashcards = {
      kind: 'flashcards',
      total: flashcards.items.length,
      got: flashcards.items.filter((item) => item.outcome === 'got').length,
      missedConcepts: flashcards.items.filter((item) => item.outcome === 'missed'),
    };
  }
  const teachBack = latest.get('teach-back');
  if (teachBack) {
    summary.teachBack = {
      kind: 'teach-back',
      total: teachBack.items.length,
      mastery: teachBack.items.filter((item) => item.outcome === 'mastery').length,
      blindSpot: teachBack.items.filter((item) => item.outcome === 'blind-spot').length,
      gap: teachBack.items.filter((item) => item.outcome === 'aware-gap').length,
      weakConcepts: teachBack.items.filter((item) => item.outcome === 'blind-spot' || item.outcome === 'aware-gap'),
    };
  }
  return summary;
}

/** 路径卡上的一行结果摘要；没有结果返回 undefined（卡片显示状态词）。 */
export function formatOutcomeLine(appKey: WorkshopAppKey, summary: SessionOutcomeSummary): string | undefined {
  const copy = COPY.apps.path.outcome;
  if (appKey === 'quiz' && summary.quiz) return copy.quiz(summary.quiz.total, summary.quiz.correct);
  if (appKey === 'flashcards' && summary.flashcards) return copy.flashcards(summary.flashcards.total, summary.flashcards.got);
  if (appKey === 'teach-back' && summary.teachBack) {
    return copy.teachBack(summary.teachBack.mastery, summary.teachBack.blindSpot + summary.teachBack.gap);
  }
  return undefined;
}

export interface NextStepRecommendation {
  key: WorkshopAppKey | null;
  /** 学生能核对的理由 */
  reason: string;
  /** 全部路径走完 */
  completed: boolean;
  /**
   * 理由是否落在具体事实上（标记时刻 / 难点 / 上一步结果 / 时长）。
   * false = 兜底的"先从这里开始"——此时才轮到模型按内容给的首选。
   */
  grounded: boolean;
}

export interface NextStepSignals {
  anchors: readonly Anchor[];
  keyDifficulties?: readonly string[];
  transcript: readonly TranscriptSegment[];
  outcomes: SessionOutcomeSummary;
  /** 已做好（有产物）的应用 */
  generated: ReadonlySet<WorkshopAppKey>;
  /** 当前层允许的应用；不在其中的不推荐 */
  allowed: ReadonlySet<WorkshopAppKey>;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 概念名：引号里的术语优先（"“up in the air” 在这段…" → up in the air），否则截断——与掌握轨迹、书桌同一规则
const shortConcept = (text: string): string => conceptLabel(text, 14);

/**
 * 「先做这一件」——按顺序看事实：
 * 1. 上一步的结果决定下一步（测验错了 → 记住；闪卡没记住 → 讲出来；讲透了 → 带走）
 * 2. 没做过任何一步：有标记 → 先检验那几处；有难点 → 先记住；内容长 → 先看结构（不在路径内也推荐）
 * 3. 四步都做完 → completed
 */
export function recommendNextStep(signals: NextStepSignals): NextStepRecommendation {
  const copy = COPY.apps.path.reason;
  const { outcomes, generated, allowed } = signals;
  const can = (key: WorkshopAppKey) => allowed.has(key);
  const pathDone = LEARNING_PATH.every((key) => generated.has(key) || !allowed.has(key));

  // "做过"看结果不看产物：闪卡可能早就生成好了（示例课预置），只要还没练过，测验错了就该去练它
  if (outcomes.quiz && outcomes.quiz.wrongConcepts.length > 0 && !outcomes.flashcards && can('flashcards')) {
    const names = outcomes.quiz.wrongConcepts.slice(0, 2).map((item) => shortConcept(item.concept));
    return { key: 'flashcards', reason: copy.afterQuizWrong(outcomes.quiz.wrongConcepts.length, names), completed: false, grounded: true };
  }
  if (outcomes.flashcards && outcomes.flashcards.missedConcepts.length > 0 && !outcomes.teachBack && can('teach-back')) {
    return { key: 'teach-back', reason: copy.afterFlashcardsMissed(outcomes.flashcards.missedConcepts.length), completed: false, grounded: true };
  }
  if (outcomes.quiz && outcomes.quiz.wrongConcepts.length === 0 && outcomes.quiz.total > 0 && !outcomes.teachBack && can('teach-back')) {
    return { key: 'teach-back', reason: copy.afterQuizPerfect(outcomes.quiz.total), completed: false, grounded: true };
  }
  if (outcomes.teachBack && !generated.has('infographic') && can('infographic')) {
    return {
      key: 'infographic',
      reason: outcomes.teachBack.blindSpot + outcomes.teachBack.gap > 0
        ? copy.afterTeachBackGaps(outcomes.teachBack.blindSpot + outcomes.teachBack.gap)
        : copy.afterTeachBackClear,
      completed: false,
      grounded: true,
    };
  }
  if (pathDone && LEARNING_PATH.some((key) => generated.has(key))) {
    return { key: null, reason: copy.completed, completed: true, grounded: true };
  }

  // 还没开始：用课堂事实排第一步
  const activeAnchors = signals.anchors.filter((anchor) => !anchor.cancelled && !anchor.resolved);
  if (activeAnchors.length > 0 && !generated.has('quiz') && can('quiz')) {
    const times = activeAnchors.slice(0, 3).map((anchor) => fmtTime(anchor.timestamp));
    return { key: 'quiz', reason: copy.fromAnchors(activeAnchors.length, times), completed: false, grounded: true };
  }
  const difficulties = (signals.keyDifficulties ?? []).filter((item) => item.trim());
  if (difficulties.length > 0 && !generated.has('flashcards') && can('flashcards')) {
    return { key: 'flashcards', reason: copy.fromDifficulties(difficulties.length, difficulties.slice(0, 2).map((d) => shortConcept(d))), completed: false, grounded: true };
  }
  const durationMs = signals.transcript.length > 0 ? signals.transcript[signals.transcript.length - 1].endMs : 0;
  if (signals.transcript.length >= 24 && !generated.has('mindmap') && can('mindmap')) {
    return { key: 'mindmap', reason: copy.fromLength(Math.max(1, Math.round(durationMs / 60000))), completed: false, grounded: true };
  }
  // 兜底：路径第一步里第一个还没做的
  const first = LEARNING_PATH.find((key) => !generated.has(key) && can(key));
  if (first) return { key: first, reason: copy.defaultStart, completed: false, grounded: false };
  return { key: null, reason: '', completed: false, grounded: false };
}

/**
 * 会话内结果 → 合成困惑锚点，喂给下一步应用的 prompt（"他听课时的困惑点…值得多覆盖"）。
 * 只给闪卡 / 讲给同桌听 / 测验重做；来源写进 note，模型和用户都看得懂。
 */
export function buildOutcomeAnchors(
  sessionId: string,
  targetApp: WorkshopAppKey,
  summary: SessionOutcomeSummary,
): Anchor[] {
  if (targetApp !== 'flashcards' && targetApp !== 'teach-back' && targetApp !== 'quiz') return [];
  const now = new Date().toISOString();
  const items: Array<{ prefix: string; item: LearningAssessmentItem }> = [];
  if (summary.quiz && targetApp !== 'quiz') {
    summary.quiz.wrongConcepts.forEach((item) => items.push({ prefix: COPY.apps.path.anchorPrefix.quizWrong, item }));
  }
  if (summary.flashcards && targetApp !== 'flashcards') {
    summary.flashcards.missedConcepts.forEach((item) => items.push({ prefix: COPY.apps.path.anchorPrefix.flashcardsMissed, item }));
  }
  if (summary.teachBack && targetApp !== 'teach-back') {
    summary.teachBack.weakConcepts.forEach((item) => items.push({ prefix: COPY.apps.path.anchorPrefix.teachBackWeak, item }));
  }
  return items.slice(0, 8).map(({ prefix, item }, index) => ({
    id: `outcome-${targetApp}-${index}`,
    sessionId,
    studentId: 'self',
    timestamp: item.evidence?.startMs ?? 0,
    type: 'confusion' as const,
    cancelled: false,
    resolved: false,
    createdAt: now,
    note: `${prefix}${item.concept}`,
  }));
}

/** 课头的一行元信息：时长 · 标记 · 难点（只写有的）。 */
export function formatLessonMeta(transcript: readonly TranscriptSegment[], anchors: readonly Anchor[], difficulties: number): string {
  const durationMs = transcript.length > 0 ? transcript[transcript.length - 1].endMs : 0;
  const minutes = Math.max(1, Math.round(durationMs / 60000));
  const activeAnchors = anchors.filter((anchor) => !anchor.cancelled).length;
  return COPY.apps.path.lessonMeta(minutes, activeAnchors, difficulties);
}
