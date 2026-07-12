import { describe, expect, it } from 'vitest';
import {
  filterValidCaptureIds,
  filterValidGoalLabel,
  containsUnsupportedPsychology,
  isAcceptableExternalResult,
  scoreExternalResult,
} from './feed-service';

describe('feed recommendation quality guardrails', () => {
  it('rejects malformed URLs and known low-quality aggregators', () => {
    expect(isAcceptableExternalResult('not-a-url')).toBe(false);
    expect(isAcceptableExternalResult('https://baijiahao.baidu.com/s?id=1')).toBe(false);
    expect(isAcceptableExternalResult('https://blog.csdn.net/example/article/details/1')).toBe(false);
    expect(isAcceptableExternalResult('https://arxiv.org/abs/2401.00001')).toBe(true);
  });

  it('ranks authoritative sources above an unrecognized commercial domain', () => {
    expect(scoreExternalResult('https://arxiv.org/abs/2401.00001'))
      .toBeGreaterThan(scoreExternalResult('https://example.com/post'));
    expect(scoreExternalResult('https://history.example.edu/archive'))
      .toBeGreaterThan(scoreExternalResult('https://example.com/post'));
  });

  it('keeps only real source capture ids and removes duplicates', () => {
    const captures = [
      { id: 'capture-a', title: 'A' },
      { id: 'capture-b', title: 'B' },
    ];
    expect(filterValidCaptureIds(['capture-a', 'made-up', 'capture-a', 'capture-b'], captures))
      .toEqual(['capture-a', 'capture-b']);
  });

  it('never displays a goal label that is absent from the learner context', () => {
    const goals = [{ title: '完成毕业论文' }];
    expect(filterValidGoalLabel('完成毕业论文', goals)).toBe('完成毕业论文');
    expect(filterValidGoalLabel('成为物理学家', goals)).toBeUndefined();
  });

  it('blocks unsupported psychological interpretations', () => {
    expect(containsUnsupportedPsychology('这反映了你对知识盲区的零容忍心态')).toBe(true);
    expect(containsUnsupportedPsychology('你收藏了三篇关于快速排序的文章')).toBe(false);
  });
});
