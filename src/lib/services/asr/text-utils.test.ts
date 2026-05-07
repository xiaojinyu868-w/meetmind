import { describe, it, expect } from 'vitest';
import {
  toChars,
  normalizeForCompare,
  longestCommonSubstringRatio,
  findOverlapLength,
  stitchSegments,
  stitchSegmentsWithOverlap,
  fullJitterDelay,
} from './text-utils';

describe('toChars', () => {
  it('handles cjk correctly', () => {
    expect(toChars('你好')).toEqual(['你', '好']);
    expect(toChars('ab你好').length).toBe(4);
  });
});

describe('normalizeForCompare', () => {
  it('strips punctuation + lowercase', () => {
    expect(normalizeForCompare('你好，World!')).toBe('你好world');
  });
});

describe('longestCommonSubstringRatio', () => {
  it('matches identical', () => {
    expect(longestCommonSubstringRatio('abc', 'abc')).toBe(1);
  });
  it('partial overlap', () => {
    // "abcd" vs "xbcz" -> lcs "bc" len 2, shorter len 4
    expect(longestCommonSubstringRatio('abcd', 'xbcz')).toBeCloseTo(0.5, 3);
  });
  it('no overlap', () => {
    expect(longestCommonSubstringRatio('abc', 'xyz')).toBe(0);
  });
});

describe('findOverlapLength', () => {
  it('finds perfect overlap at boundary', () => {
    // a 末尾 "xyz"  b 开头 "xyz" -> overlap 3
    const a = toChars('abcxyz');
    const b = toChars('xyzdef');
    expect(findOverlapLength(a, b)).toBe(3);
  });
  it('returns 0 when no overlap', () => {
    expect(findOverlapLength(toChars('abc'), toChars('xyz'))).toBe(0);
  });
  it('finds partial overlap in Chinese', () => {
    const a = toChars('机器学习的基础');
    const b = toChars('的基础是数学');
    expect(findOverlapLength(a, b)).toBe(3); // "的基础"
  });
  it('handles case-insensitive overlap', () => {
    const a = toChars('hello WORLD');
    const b = toChars('world is fun');
    expect(findOverlapLength(a, b)).toBe(5);
  });
});

describe('stitchSegments', () => {
  it('handles all-success case', () => {
    const r = stitchSegments(
      [
        { success: true, sentences: [{ text: 'A', begin_time: 0, end_time: 500 }] },
        { success: true, sentences: [{ text: 'B', begin_time: 0, end_time: 500 }] },
      ],
      [1000, 1000],
    );
    expect(r.allSentences).toHaveLength(2);
    expect(r.allSentences[0].begin_time).toBe(0);
    expect(r.allSentences[0].end_time).toBe(500);
    expect(r.allSentences[1].begin_time).toBe(1000);
    expect(r.allSentences[1].end_time).toBe(1500);
    expect(r.failedIndices).toEqual([]);
    expect(r.totalDurationMs).toBe(2000);
  });

  it('preserves timeOffset across failed blocks', () => {
    // 第 1 块失败，第 2 块成功 —— 第 2 块的时间应对齐到真实音频位置（1000ms）
    const r = stitchSegments(
      [
        { success: false, sentences: [] },
        { success: true, sentences: [{ text: 'ok', begin_time: 0, end_time: 300 }] },
      ],
      [1000, 1000],
    );
    expect(r.failedIndices).toEqual([0]);
    expect(r.allSentences).toHaveLength(1);
    expect(r.allSentences[0].begin_time).toBe(1000);
    expect(r.allSentences[0].end_time).toBe(1300);
    expect(r.totalDurationMs).toBe(2000);
  });

  it('reports multiple failed indices', () => {
    const r = stitchSegments(
      [
        { success: false, sentences: [] },
        { success: true, sentences: [{ text: 'a', begin_time: 0, end_time: 100 }] },
        { success: false, sentences: [] },
        { success: true, sentences: [{ text: 'b', begin_time: 0, end_time: 100 }] },
      ],
      [1000, 1000, 1000, 1000],
    );
    expect(r.failedIndices).toEqual([0, 2]);
    expect(r.allSentences).toHaveLength(2);
    expect(r.allSentences[0].begin_time).toBe(1000);
    expect(r.allSentences[1].begin_time).toBe(3000);
  });
});

describe('fullJitterDelay', () => {
  it('bounded by cap', () => {
    for (let i = 0; i < 100; i++) {
      const d = fullJitterDelay(20, 500, 5000);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(5000);
    }
  });

  it('grows with attempt', () => {
    const d0 = fullJitterDelay(0, 500, 30000);
    expect(d0).toBeGreaterThanOrEqual(0);
    expect(d0).toBeLessThanOrEqual(500);

    const d10 = fullJitterDelay(10, 500, 30000);
    expect(d10).toBeLessThanOrEqual(30000);
  });
});

describe('stitchSegmentsWithOverlap', () => {
  it('drops sentences entirely within overlap lead of non-first segment', () => {
    const r = stitchSegmentsWithOverlap(
      [
        {
          success: true,
          sentences: [{ text: '第一段结尾的内容', begin_time: 58000, end_time: 60000 }],
        },
        {
          success: true,
          // 这段的 overlapLead = 2000ms，其中句子 begin=0/end=1500 完全在 overlap 里 → 丢弃
          sentences: [
            { text: '第一段结尾的内容', begin_time: 0, end_time: 1500 },
            { text: '第二段实际内容', begin_time: 2100, end_time: 5000 },
          ],
        },
      ],
      [
        { startMs: 0, endMs: 60000, overlapLeadMs: 0 },
        { startMs: 58000, endMs: 118000, overlapLeadMs: 2000 },
      ],
    );

    expect(r.failedIndices).toEqual([]);
    // 3 条原始数据，中间那条被 overlap 丢弃，剩两条
    // 再考虑文本相似去重（两段里"第一段结尾的内容"相同，但第二段那条已在 overlap 内丢，不会走到 LCS）
    expect(r.allSentences).toHaveLength(2);
    expect(r.allSentences[0].text).toBe('第一段结尾的内容');
    expect(r.allSentences[0].begin_time).toBe(58000);
    expect(r.allSentences[1].text).toBe('第二段实际内容');
    expect(r.allSentences[1].begin_time).toBe(60100); // 58000 + 2100
  });

  it('dedupes adjacent near-identical sentences across segment boundary', () => {
    // 即使 overlap 内某句 begin > overlapLeadMs（跨边界），还能被后端 LCS 兜底去重
    const r = stitchSegmentsWithOverlap(
      [
        {
          success: true,
          sentences: [{ text: '机器学习的核心是梯度下降', begin_time: 59000, end_time: 61500 }],
        },
        {
          success: true,
          sentences: [
            // 这句 begin=2100 > overlapLeadMs=2000，但内容跟前段最后一句相似
            { text: '机器学习的核心是梯度下降', begin_time: 2100, end_time: 4500 },
            { text: '接下来讲反向传播', begin_time: 5000, end_time: 8000 },
          ],
        },
      ],
      [
        { startMs: 0, endMs: 61000, overlapLeadMs: 0 },
        { startMs: 59000, endMs: 120000, overlapLeadMs: 2000 },
      ],
    );

    // 应该识别到两段里的"机器学习..."是重复，去掉一条
    expect(r.failedIndices).toEqual([]);
    expect(r.allSentences).toHaveLength(2);
    expect(r.allSentences[0].text).toBe('机器学习的核心是梯度下降');
    expect(r.allSentences[1].text).toBe('接下来讲反向传播');
  });

  it('propagates failedIndices and preserves order', () => {
    const r = stitchSegmentsWithOverlap(
      [
        { success: true, sentences: [{ text: 'A', begin_time: 100, end_time: 500 }] },
        { success: false, sentences: [] },
        { success: true, sentences: [{ text: 'B', begin_time: 2100, end_time: 2500 }] },
      ],
      [
        { startMs: 0, endMs: 10000, overlapLeadMs: 0 },
        { startMs: 8000, endMs: 20000, overlapLeadMs: 2000 },
        { startMs: 18000, endMs: 30000, overlapLeadMs: 2000 },
      ],
    );
    expect(r.failedIndices).toEqual([1]);
    expect(r.allSentences).toHaveLength(2);
    expect(r.allSentences[0].text).toBe('A');
    expect(r.allSentences[1].text).toBe('B');
    expect(r.allSentences[0].begin_time).toBe(100);
    expect(r.allSentences[1].begin_time).toBe(20100);
    expect(r.totalDurationMs).toBe(30000);
  });
});
