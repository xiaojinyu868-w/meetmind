import { describe, expect, it } from 'vitest';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { buildAppResultActivityDetail } from './app-learning-activity';

function createResult(patch: Partial<AppExecutionResult> = {}): AppExecutionResult {
  return {
    pluginId: 'flashcards',
    version: '1',
    cards: [],
    tasks: [],
    trace: [],
    ...patch,
  };
}

describe('buildAppResultActivityDetail', () => {
  it('prefers a rendered result description', () => {
    const result = createResult({
      render: { mode: 'flashcards', description: '  已生成一组核心概念闪卡  ', payload: {} },
      cards: [{ id: 'c1', type: 'flashcard', title: '机会成本', body: '最高价值替代项' }],
    });

    expect(buildAppResultActivityDetail(result, () => 'fallback')).toBe('已生成一组核心概念闪卡');
  });

  it('falls back to the first card, then the card count summary', () => {
    const withCard = createResult({
      cards: [{ id: 'c1', type: 'quiz', title: '第一题', body: '判断稀缺资源' }],
    });
    const withoutCard = createResult();

    expect(buildAppResultActivityDetail(withCard, () => 'fallback')).toBe('第一题：判断稀缺资源');
    expect(buildAppResultActivityDetail(withoutCard, (count) => `生成 ${count} 张卡片`)).toBe('生成 0 张卡片');
  });
});
