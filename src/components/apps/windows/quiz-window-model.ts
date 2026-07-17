import type { AppExecutionResult } from '@/lib/ai-native/types';

export interface QuizQuestion {
  id: string;
  title?: string;
  stem: string;
  /** single | judge | fill | short。空选项即主观题。 */
  type: string;
  options: string[];
  answer: string;
  explanation?: string;
  evidence?: {
    startMs: number;
    snippet?: string;
  };
}

export const QUIZ_SELF_CORRECT = '__self_correct__';
export const QUIZ_SELF_WRONG = '__self_wrong__';

export function isSubjectiveQuizQuestion(question: QuizQuestion): boolean {
  return question.options.length < 2;
}

/**
 * 旧结果偶尔会把生成阶段的片段编号直接写进解析（如“段002中”）。
 * 这些编号不是用户可理解的证据入口：真正的证据由 citation 按钮承接。
 */
export function sanitizeQuizExplanation(explanation: string): string {
  return explanation
    .trim()
    .replace(
      /(?:转录)?(?:片段|段落?|段)\s*[#：:]?\s*0*\d+\s*(?:中|里)?/g,
      (match) => /(?:中|里)\s*$/.test(match) ? '课堂原文中' : '课堂原文',
    )
    .replace(/结合课堂原文中/g, '结合原文里')
    .replace(/以及课堂原文中/g, '原文中')
    .replace(/课堂原文\s*课堂原文/g, '课堂原文');
}

export function normalizeQuizQuestions(result: AppExecutionResult | null): QuizQuestion[] {
  if (!result) return [];
  const isRenderable = (question: QuizQuestion) => Boolean(question.stem)
    && (question.options.length >= 2 || question.type === 'short' || question.type === 'fill');

  const payload = result.render?.payload as { questions?: Array<Record<string, unknown>> } | undefined;
  const payloadQuestions = Array.isArray(payload?.questions)
    ? payload.questions
        .map((item, index) => {
          const id = typeof item.id === 'string' ? item.id : `quiz-${index + 1}`;
          const citation = result.cards.find((card) => card.id === id)?.citations?.[0];
          return {
            id,
            title: typeof item.title === 'string' ? item.title : undefined,
            stem: typeof item.stem === 'string' ? item.stem : '',
            type: typeof item.type === 'string' ? item.type : 'single',
            options: Array.isArray(item.options)
              ? item.options.map((option) => (typeof option === 'string' ? option : '')).filter(Boolean)
              : [],
            answer: typeof item.answer === 'string' ? item.answer : '',
            explanation: typeof item.explanation === 'string'
              ? sanitizeQuizExplanation(item.explanation)
              : '',
            evidence: citation ? { startMs: citation.startMs, snippet: citation.snippet } : undefined,
          };
        })
        .filter(isRenderable)
    : [];

  if (payloadQuestions.length > 0) return payloadQuestions;

  return result.cards
    .filter((card) => card.meta?.cardKind === 'quiz')
    .map((card) => ({
      id: card.id,
      title: card.title || undefined,
      stem: typeof card.meta?.stem === 'string' ? card.meta.stem : card.body,
      type: typeof card.meta?.type === 'string' ? card.meta.type : 'single',
      options: Array.isArray(card.meta?.options)
        ? card.meta.options.map((option) => (typeof option === 'string' ? option : '')).filter(Boolean)
        : [],
      answer: typeof card.meta?.answer === 'string' ? card.meta.answer : '',
      explanation: typeof card.meta?.explanation === 'string'
        ? sanitizeQuizExplanation(card.meta.explanation)
        : '',
      evidence: card.citations?.[0]
        ? { startMs: card.citations[0].startMs, snippet: card.citations[0].snippet }
        : undefined,
    }))
    .filter(isRenderable);
}

export function normalizeQuizAnswer(answer: string, options: string[]): string {
  const trimmed = answer.trim();
  if (!trimmed) return '';

  const letterMatch = trimmed.match(/^([A-Za-z])[.、)\s]*$/);
  if (letterMatch) {
    const letterIndex = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (letterIndex >= 0 && letterIndex < options.length) return options[letterIndex];
  }

  const exact = options.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const prefixedMatch = trimmed.match(/^[A-Za-z][.、)\s]+(.+)/);
  if (prefixedMatch) {
    const content = prefixedMatch[1].trim().toLowerCase();
    const found = options.find((option) => stripQuizOptionPrefix(option).toLowerCase() === content);
    if (found) return found;
  }

  const fuzzy = options.find((option) => {
    const stripped = stripQuizOptionPrefix(option).toLowerCase();
    const candidate = trimmed.toLowerCase();
    return stripped === candidate || stripped.includes(candidate) || candidate.includes(stripped);
  });
  return fuzzy ?? trimmed;
}

export function isQuizAnswerCorrect(question: QuizQuestion, selectedValue: string | undefined): boolean {
  if (!selectedValue) return false;
  if (isSubjectiveQuizQuestion(question)) return selectedValue === QUIZ_SELF_CORRECT;
  return selectedValue === normalizeQuizAnswer(question.answer, question.options);
}

export function stripQuizOptionPrefix(text: string): string {
  return text.replace(/^[A-Za-z][.、)\s]+/, '').trim() || text;
}

export function formatQuizEvidenceTime(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
