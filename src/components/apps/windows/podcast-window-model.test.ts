import { describe, expect, it } from 'vitest';
import { isInternalPodcastFailureSection } from './podcast-window-model';

describe('isInternalPodcastFailureSection', () => {
  it('hides provider and transport failures from the learner-facing chapter list', () => {
    expect(isInternalPodcastFailureSection({
      title: '播客音频未生成',
      body: '建连失败：403 Forbidden',
    })).toBe(true);
  });

  it('keeps legitimate lesson sections even when they discuss an ordinary failure', () => {
    expect(isInternalPodcastFailureSection({
      title: '识别实验失败的原因',
      body: '检查变量控制和样本量。',
    })).toBe(false);
  });
});
