import type {
  LearningIntentAnswer,
  LearningIntentQuestion,
} from '@/types/learning-intent';

export type LearningIntentAnswerMap = Record<string, string[]>;

export function updateLearningIntentSelection(
  answers: LearningIntentAnswerMap,
  question: LearningIntentQuestion,
  optionId: string,
): LearningIntentAnswerMap {
  if (question.kind === 'single') {
    return { ...answers, [question.id]: [optionId] };
  }

  const selected = answers[question.id] ?? [];
  return {
    ...answers,
    [question.id]: selected.includes(optionId)
      ? selected.filter((id) => id !== optionId)
      : [...selected, optionId],
  };
}

export function hasLearningIntentAnswer(
  answers: LearningIntentAnswerMap,
  question: LearningIntentQuestion,
): boolean {
  return (answers[question.id]?.length ?? 0) > 0;
}

export function buildLearningIntentAnswers(
  questions: LearningIntentQuestion[],
  answers: LearningIntentAnswerMap,
): LearningIntentAnswer[] {
  return questions.map((question) => {
    const optionIds = answers[question.id] ?? [];
    return {
      questionId: question.id,
      question: question.prompt,
      optionIds,
      optionLabels: question.options
        .filter((option) => optionIds.includes(option.id))
        .map((option) => option.label),
    };
  });
}
