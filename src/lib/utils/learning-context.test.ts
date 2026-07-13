import { describe, expect, it } from 'vitest';
import {
  createEmptyLearningContext,
  formatLearningContextForTutor,
  mergeLearningActivity,
  mergeLearningMemory,
} from './learning-context';

describe('learning context', () => {
  it('deduplicates memories by source id', () => {
    const base = createEmptyLearningContext();
    const first = mergeLearningMemory(base, {
      id: 'm1',
      kind: 'progress',
      title: '先理解反向传播',
      status: 'active',
      source: 'confirmed-ai',
      sourceId: 'thread-1',
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z',
    });
    const next = mergeLearningMemory(first, {
      ...first.memories[0],
      id: 'm2',
      title: '已经能解释反向传播',
      updatedAt: '2026-07-14T01:00:00.000Z',
    });
    expect(next.memories).toHaveLength(1);
    expect(next.memories[0].title).toBe('已经能解释反向传播');
  });

  it('keeps app activity separate from confirmed memory', () => {
    const state = mergeLearningActivity(createEmptyLearningContext(), {
      id: 'a1',
      kind: 'app',
      title: '完成了一组闪卡',
      occurredAt: '2026-07-14T00:00:00.000Z',
    });
    expect(state.memories).toEqual([]);
    expect(state.recentActivities).toHaveLength(1);
  });

  it('only injects active memories and goals', () => {
    const state = {
      ...createEmptyLearningContext(),
      memories: [
        { id: 'm1', kind: 'topic' as const, title: '概率论', status: 'active' as const, source: 'user' as const, createdAt: '', updatedAt: '' },
        { id: 'm2', kind: 'topic' as const, title: '已暂停', status: 'paused' as const, source: 'user' as const, createdAt: '', updatedAt: '' },
      ],
    };
    const formatted = formatLearningContextForTutor(state, {
      stage: 'unknown',
      goals: [
        { id: 'g1', title: '通过考试', status: 'active', createdAt: '', updatedAt: '' },
        { id: 'g2', title: '以后再说', status: 'paused', createdAt: '', updatedAt: '' },
      ],
    });
    expect(formatted.memories.map((item) => item.title)).toEqual(['概率论']);
    expect(formatted.goals.map((item) => item.title)).toEqual(['通过考试']);
  });
});
