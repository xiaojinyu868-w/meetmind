import { describe, expect, it } from 'vitest';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import {
  formatFlashcardEvidenceTime,
  getFlashcardsFallbackMessage,
  normalizeFlashcards,
} from './flashcards-window-model';

function createResult(overrides: Partial<AppExecutionResult> = {}): AppExecutionResult {
  return {
    pluginId: 'flashcards',
    version: '1',
    cards: [],
    tasks: [],
    trace: [],
    ...overrides,
  };
}

describe('flashcards window model', () => {
  it('keeps the source citation when render payload provides the visible card', () => {
    const result = createResult({
      cards: [{
        id: 'card-1',
        type: 'flashcard',
        title: '概念',
        body: '背面',
        citations: [{ startMs: 62_400, endMs: 65_000, snippet: '课堂原话' }],
      }],
      render: {
        mode: 'flashcards',
        payload: { cards: [{ id: 'card-1', front: '什么是工作记忆？', back: '短时保持并加工信息的系统。' }] },
      },
    });

    expect(normalizeFlashcards(result)).toEqual([expect.objectContaining({
      id: 'card-1',
      front: '什么是工作记忆？',
      back: '短时保持并加工信息的系统。',
      evidence: { startMs: 62_400, snippet: '课堂原话' },
    })]);
  });

  it('falls back to structured result cards and drops incomplete cards', () => {
    const result = createResult({
      cards: [
        {
          id: 'valid',
          type: 'flashcard',
          title: '有效',
          body: '默认正面',
          meta: { cardKind: 'flashcard', front: '正面', back: '背面', hint: '提示' },
        },
        {
          id: 'missing-answer',
          type: 'flashcard',
          title: '无效',
          body: '只有问题',
          meta: { cardKind: 'flashcard', front: '问题' },
        },
      ],
    });

    expect(normalizeFlashcards(result)).toEqual([expect.objectContaining({
      id: 'valid',
      front: '正面',
      back: '背面',
      hint: '提示',
    })]);
  });

  it('returns a trimmed fallback message and formats evidence time', () => {
    const result = createResult({
      render: { mode: 'flashcards', payload: { message: '  这份材料还不适合做闪卡。  ' } },
    });

    expect(getFlashcardsFallbackMessage(result)).toBe('这份材料还不适合做闪卡。');
    expect(formatFlashcardEvidenceTime(62_400)).toBe('1:02');
    expect(formatFlashcardEvidenceTime(-10)).toBe('0:00');
  });
});
