import { describe, expect, it } from 'vitest';
import type { WorkspaceCaptureMessage } from '@/types/page-types';
import type { LearnerProfile, LearningContextState } from '@/types/user';
import { buildImmediateFeedPreview } from './useFeedStream';

const captures: WorkspaceCaptureMessage[] = [{
  id: 'capture-1',
  sourceKey: 'local:capture-1',
  sourceType: 'text',
  role: 'student',
  contentType: 'text',
  title: '因果推断课堂',
  previewText: '老师先区分了相关性和因果关系。',
  normalizedText: '老师先区分了相关性和因果关系，然后解释了潜在结果框架。',
  createdAt: '2026-07-16T10:00:00.000Z',
}];

describe('buildImmediateFeedPreview', () => {
  it('优先恢复当前学习线，不等待完整情报生成', () => {
    const learningContext: LearningContextState = {
      memories: [],
      recentActivities: [],
      activeThread: {
        id: 'thread-1',
        title: '补齐因果推断的统计基础',
        intent: '先理解随机变量与条件期望。',
        lastSummary: '已经区分总体、样本和估计量。',
        nextStep: '接着理解条件期望。',
        depth: 'deep',
        status: 'active',
        createdAt: '2026-07-15T10:00:00.000Z',
        updatedAt: '2026-07-16T09:00:00.000Z',
      },
    };

    expect(buildImmediateFeedPreview(captures, null, learningContext)).toEqual([expect.objectContaining({
      type: 'summary',
      title: '补齐因果推断的统计基础',
      body: '已经区分总体、样本和估计量。',
      whyForYou: '接着理解条件期望。',
    })]);
  });

  it('没有学习线时使用用户明确目标，不编造新结论', () => {
    const profile: LearnerProfile = {
      stage: 'unknown',
      goals: [{
        id: 'goal-1',
        title: '读懂经济学论文',
        summary: '先补齐统计学和计量经济学基础。',
        createdAt: '2026-07-15T10:00:00.000Z',
        updatedAt: '2026-07-16T09:00:00.000Z',
      }],
    };

    expect(buildImmediateFeedPreview([], profile, { memories: [], recentActivities: [] })[0]).toMatchObject({
      title: '读懂经济学论文',
      body: '先补齐统计学和计量经济学基础。',
      goalLabel: '读懂经济学论文',
    });
  });

  it('没有目标时只展示最近材料中的真实文字', () => {
    expect(buildImmediateFeedPreview(captures, null, { memories: [], recentActivities: [] })[0]).toMatchObject({
      title: '因果推断课堂',
      body: '老师先区分了相关性和因果关系，然后解释了潜在结果框架。',
      sourceCaptureIds: ['capture-1'],
    });
  });
});
