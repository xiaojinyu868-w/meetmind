import { describe, expect, it } from 'vitest';
import {
  advanceLearningThreadFromActivity,
  advanceLearningThreadFromAppInteraction,
  attachLearningThreadActivityEvidence,
  createEmptyLearningContext,
  formatLearningContextForTutor,
  mergeLearningThreadHistory,
  mergeLearningActivity,
  mergeLearningMemory,
  summarizeLearningContext,
  toLearningActivityPreview,
  updateLearningThread,
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

  it('advances a thread only from a real app interaction in the same lesson', () => {
    const state = updateLearningThread(createEmptyLearningContext(), {
      id: 'thread-1',
      title: '分清相关与因果',
      intent: '我想真正理解两者区别',
      depth: 'deep',
      status: 'active',
      sessionId: 'lesson-1',
      lastSummary: '已经讨论相关不等于因果',
      nextStep: '用反例检验共同原因',
      createdAt: '2026-08-05T08:00:00.000Z',
      updatedAt: '2026-08-05T08:00:00.000Z',
    });
    const interaction = {
      id: 'activity-1',
      kind: 'app' as const,
      title: '课堂测验',
      detail: '课堂测验完成：5 题答对 4 题，正确率 80%。',
      sessionId: 'lesson-1',
      appKey: 'quiz',
      sourceId: 'app-interaction:lesson-1:quiz:complete',
      occurredAt: '2026-08-05T09:00:00.000Z',
    };

    const advanced = advanceLearningThreadFromAppInteraction(state, interaction);
    expect(advanced.activeThread).toMatchObject({
      id: 'thread-1',
      lastSummary: '已经讨论相关不等于因果；课堂测验完成：5 题答对 4 题，正确率 80%。',
      nextStep: '用反例检验共同原因',
      updatedAt: '2026-08-05T09:00:00.000Z',
      relatedSessionIds: ['lesson-1'],
      relatedActivityIds: ['activity-1'],
    });
    expect(advanced.memories).toEqual([]);

    expect(advanceLearningThreadFromAppInteraction(state, {
      ...interaction,
      sessionId: 'lesson-2',
    })).toBe(state);
    expect(advanceLearningThreadFromAppInteraction(state, {
      ...interaction,
      sourceId: 'app-result:lesson-1:quiz:1',
    })).toBe(state);
  });

  it('records distinct evidence even when two interactions have the same summary', () => {
    const state = updateLearningThread(createEmptyLearningContext(), {
      id: 'thread-1',
      title: '分清�