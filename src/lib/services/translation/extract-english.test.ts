import { describe, it, expect } from 'vitest';
import { extractChineseRuns, extractEnglishRuns, hasTranslatableEnglish } from './extract-english';

describe('extractEnglishRuns', () => {
  it('extracts multi-word English', () => {
    expect(extractEnglishRuns('看这里的 gradient descent 是什么')).toEqual(['gradient descent']);
  });

  it('drops single words', () => {
    expect(extractEnglishRuns('这是 I 说的')).toEqual([]);
  });

  it('drops very short runs', () => {
    expect(extractEnglishRuns('是 I am 说的')).toEqual([]);
  });

  it('handles punctuation inside runs', () => {
    const out = extractEnglishRuns('this is a so-called "neural network" model');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain('neural network');
  });

  it('dedupes case-insensitively', () => {
    const out = extractEnglishRuns(
      'deep learning is good, Deep Learning is better, DEEP LEARNING wins',
    );
    expect(out).toHaveLength(1);
  });

  it('handles pure Chinese', () => {
    expect(extractEnglishRuns('这段话全是中文没有英文')).toEqual([]);
  });

  it('handles multiple runs in one sentence', () => {
    const out = extractEnglishRuns(
      '今天讲 back propagation 和 stochastic gradient descent 两个概念',
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});

describe('extractChineseRuns', () => {
  it('extracts a compact Chinese sentence for zh-en translation', () => {
    expect(extractChineseRuns('所以你是从小。')).toEqual(['所以你是从小。']);
  });

  it('ignores text without Chinese characters', () => {
    expect(extractChineseRuns('DingTalk A One')).toEqual([]);
  });
});

describe('hasTranslatableEnglish', () => {
  it('returns true when multi-word English present', () => {
    expect(hasTranslatableEnglish('看这 neural network')).toBe(true);
  });
  it('returns false for pure Chinese', () => {
    expect(hasTranslatableEnglish('都是中文')).toBe(false);
  });
  it('returns false for single English word', () => {
    expect(hasTranslatableEnglish('单词 the 不算')).toBe(false);
  });
});
