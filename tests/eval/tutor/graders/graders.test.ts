import { describe, it, expect } from 'vitest';
import { extractCitations, gradeTimestampCitation } from './timestamp-citation';
import { gradeToolSelection } from './tool-selection';
import { gradeLearningRubric } from './learning-rubric';

describe('extractCitations', () => {
  it('parses MM:SS patterns', () => {
    expect(extractCitations('看第 [t=03:15] 和 [t=12:40] 两段')).toEqual([195, 760]);
  });

  it('returns empty when no citation', () => {
    expect(extractCitations('this answer has no citation')).toEqual([]);
  });

  it('ignores seconds >= 60', () => {
    expect(extractCitations('[t=01:99]')).toEqual([]);
  });
});

describe('gradeTimestampCitation', () => {
  it('passes when all citations within window', () => {
    const r = gradeTimestampCitation('请看 [t=03:00]', {
      id: 'c1',
      question: 'q',
      expectedWindow: { start: 120, end: 240 },
    });
    expect(r.pass).toBe(true);
    expect(r.score).toBe(1);
  });

  it('fails when citation outside window', () => {
    const r = gradeTimestampCitation('请看 [t=10:00]', {
      id: 'c2',
      question: 'q',
      expectedWindow: { start: 0, end: 300 },
    });
    expect(r.pass).toBe(false);
  });

  it('fails when no citation but required', () => {
    const r = gradeTimestampCitation('纯文字回答', {
      id: 'c3',
      question: 'q',
      expectedWindow: { start: 0, end: 60 },
    });
    expect(r.pass).toBe(false);
  });

  it('passes when no citation and not required', () => {
    const r = gradeTimestampCitation('纯文字回答', {
      id: 'c4',
      question: 'q',
      expectedWindow: { start: 0, end: 60 },
      requireAtLeastOne: false,
    });
    expect(r.pass).toBe(true);
  });
});

describe('gradeToolSelection', () => {
  it('exact mode: first tool correct', () => {
    const r = gradeToolSelection(
      [{ toolName: 'makeFlashcards' }, { toolName: 'lookupTranscript' }],
      { id: 'c1', question: 'q', expectedTool: 'makeFlashcards' },
    );
    expect(r.pass).toBe(true);
  });

  it('exact mode: first tool wrong', () => {
    const r = gradeToolSelection(
      [{ toolName: 'lookupTranscript' }],
      { id: 'c2', question: 'q', expectedTool: 'makeFlashcards' },
    );
    expect(r.pass).toBe(false);
  });

  it('contains mode: tool called at any step', () => {
    const r = gradeToolSelection(
      [{ toolName: 'lookupTranscript' }, { toolName: 'makeQuiz' }],
      { id: 'c3', question: 'q', expectedTool: 'makeQuiz', mode: 'contains' },
    );
    expect(r.pass).toBe(true);
  });

  it('none mode: passes when no tool called', () => {
    const r = gradeToolSelection([], { id: 'c4', question: 'q', mode: 'none' });
    expect(r.pass).toBe(true);
  });

  it('none mode: fails when tool called', () => {
    const r = gradeToolSelection([{ toolName: 'makeFlashcards' }], {
      id: 'c5', question: 'q', mode: 'none',
    });
    expect(r.pass).toBe(false);
  });
});

describe('gradeLearningRubric', () => {
  it('passes with stub judge returning 4/5', async () => {
    const r = await gradeLearningRubric(
      'The rank of a matrix equals its dimension of column space.',
      { id: 'c1', question: 'what is matrix rank', rubric: 'should mention column space or row space' },
      async () => ({ score: 4, reason: 'mentions column space' }),
    );
    expect(r.pass).toBe(true);
    expect(r.score).toBe(4 / 5);
  });

  it('fails with stub judge returning 2/5', async () => {
    const r = await gradeLearningRubric(
      'I do not know.',
      { id: 'c2', question: 'q', rubric: 'rubric' },
      async () => ({ score: 2, reason: 'off-topic' }),
    );
    expect(r.pass).toBe(false);
  });

  it('skips (pass+score=0) when judge unavailable', async () => {
    const r = await gradeLearningRubric(
      'any answer',
      { id: 'c3', question: 'q', rubric: 'any' },
      async () => null,
    );
    expect(r.pass).toBe(true); // skip = soft pass (不卡 CI)
    expect(r.score).toBe(0);
    expect(r.details?.skipped).toBe(true);
  });
});
