import { describe, expect, it } from 'vitest';
import { buildQuizAttemptObservation } from './quiz-observation';

const question = {
  id: 'question-1', type: 'single', stem: 'Full original question '.repeat(40),
  options: ['A. Joint probability', 'B. Conditional probability'], answer: 'B',
  explanation: 'Original explanation', evidence: { startMs: 93_000, snippet: 'Teacher source' },
};

describe('quiz observation evidence', () => {
  it('preserves the full question, actual selected option, source and grading provenance', () => {
    const observation = buildQuizAttemptObservation({ question, picked: question.options[1], referencePreviouslySeen: false });
    const content = JSON.parse(observation.content);
    expect(content.question.stem).toBe(question.stem);
    expect(content.response).toEqual({ kind: 'selected_option', submittedAnswer: question.options[1] });
    expect(content.classroomEvidence).toEqual(question.evidence);
    expect(content.grading).toEqual({ basis: 'application_answer_match', correct: true });
    expect(content.reference.origin).toBe('generated_quiz');
    expect(content.conditions.referenceExposureInOtherSessions).toBe('unknown');
  });
  it('does not invent a submitted answer from self-assessment after seeing the reference', () => {
    const observation = buildQuizAttemptObservation({ question: { ...question, type: 'short', options: [] }, picked: 'I got it', selfAssessment: 'correct', referencePreviouslySeen: false });
    const content = JSON.parse(observation.content);
    expect(content.response).toEqual({ kind: 'self_assessment', rating: 'correct', submittedAnswer: null });
    expect(content.conditions.referenceSeenInCurrentViewBeforeSubmission).toBe(true);
    expect(content.grading.basis).toBe('learner_self_report');
  });
  it('retains reference exposure when an objective question is practiced again', () => {
    const observation = buildQuizAttemptObservation({ question, picked: question.options[0], referencePreviouslySeen: true });
    expect(JSON.parse(observation.content).conditions.referenceSeenInCurrentViewBeforeSubmission).toBe(true);
  });
});
