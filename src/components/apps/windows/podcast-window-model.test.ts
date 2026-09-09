import { describe, expect, it } from 'vitest';
import { isInternalPodcastFailureSection, splitPodcastSections } from './podcast-window-model';

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

describe('splitPodcastSections', () => {
  it('lifts the studio overview out and drops per-round duplicates of the script', () => {
    const { overview, chapters } = splitPodcastSections([
      { id: 'studio-overview', title: '课堂播客', body: '今天聊映射。' },
      { id: 'studio-podcast-round-1', title: '第 1 轮 · Host A', body: '我们直接进入正题。' },
      { title: '第 2 轮 · Host B', body: '核心规则其实就一条。' },
      { id: 'c1', title: '单值性', body: '一个 x 只能对应一个 y。' },
      { title: '播客音频未生成', body: '403 Forbidden' },
    ]);
    expect(overview?.id).toBe('studio-overview');
    expect(chapters.map((c) => c.title)).toEqual(['单值性']);
  });
});
