import type { LearningObservationContent } from '@/types/learning-event';
import { isQuizAnswerCorrect, isSubjectiveQuizQuestion, normalizeQuizAnswer, type QuizQuestion } from './quiz-window-model';

/** Preserve UI evidence; self-rating after reference is not an observed answer. */
export function buildQuizAttemptObservation(input: {
  question: QuizQuestion;
  picked: string;
  selfAssessment?: 'correct' | 'incorrect';
  referencePreviouslySeen: boolean;
}): LearningObservationContent {
  const { question } = input;
  const subjective = isSubjectiveQuizQuestion(question);
  return {
    type: 'practice.attempt', locator: `question:${encodeURIComponent(question.id)}`,
    content: JSON.stringify({
      question: { id: question.id, type: question.type, stem: question.stem, options: question.options },
      response: subjective
        ? { kind: 'self_assessment', rating: input.selfAssessment ?? null, submittedAnswer: null }
        : { kind: 'selected_option', submittedAnswer: input.picked },
      reference: {
        answer: question.answer, normalizedAnswer: normalizeQuizAnswer(question.answer, question.options),
        explanation: question.explanation, origin: 'generated_quiz',
      },
      conditions: {
        referenceSeenInCurrentViewBeforeSubmission: subjective || input.referencePreviouslySeen,
        referenceExposureInOtherSessions: 'unknown', otherAssistance: 'not_observed',
      },
      grading: {
        basis: subjective ? 'learner_self_report' : 'application_answer_match',
        correct: subjective ? input.selfAssessment === 'correct' : isQuizAnswerCorrect(question, input.picked),
      },
      classroomEvidence: question.evidence,
    }),
  };
}
