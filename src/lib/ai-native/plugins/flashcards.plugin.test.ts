import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { resolveFlashcardEvidenceSegment } from './flashcards.plugin';

const segments: TranscriptSegment[] = [
  {
    id: 1,
    sessionId: 's1',
    userId: 'u1',
    text: '主动回忆是在没有答案提示时尝试从记忆中提取信息，失败后的即时反馈能帮助修正记忆。',
    startMs: 0,
    endMs: 12_000,
    confidence: 1,
    isFinal: true,
  },
  {
    id: 2,
    sessionId: 's1',
    userId: 'u1',
    text: '迁移学习要区分近迁移和远迁移，后者把原理应用到表面不同的新问题。',
    startMs: 12_000,
    endMs: 26_000,
    confidence: 1,
    isFinal: true,
  },
];

describe('resolveFlashcardEvidenceSegment', () => {
  it('语义证据优先于模型给错的顺序时间戳', () => {
    const result = resolveFlashcardEvidenceSegment({
      question: '主动回忆失败后，什么能帮助修正记忆？',
      answer: '即时反馈。',
      startMs: 16,
      endMs: 25,
    }, segments, 1);
    expect(result?.id).toBe(1);
  });

  it('迁移题会落回迁移原文，而不是按卡片序号轮转', () => {
    const result = resolveFlashcardEvidenceSegment({
      question: '远迁移有什么特点？',
      answer: '把原理应用到表面不同的新问题。',
      startMs: 0,
      endMs: 10,
    }, segments, 0);
    expect(result?.id).toBe(2);
  });

  it('没有语义重合时，把秒制数字规范为毫秒后匹配真实片段', () => {
    const result = resolveFlashcardEvidenceSegment({
      question: '请解释这个概念',
      answer: '参考课堂原文',
      startMs: 18,
      endMs: 20,
    }, segments, 0);
    expect(result?.id).toBe(2);
  });
});
