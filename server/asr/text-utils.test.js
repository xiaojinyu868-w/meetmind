/**
 * server/asr/text-utils.test.js
 *
 * Vitest 要求 ESM import。target 模块是 CommonJS（require export）
 * 所以用 `import` 直接拉取 module.exports。
 *
 * 运行: npx vitest run --config vitest.server.config.ts
 */
import { describe, it, expect } from 'vitest';
import utils from './text-utils.js';

const {
  normalizeCompareText,
  longestCommonSubstringRatio,
  shouldDedupSegment,
  splitLongTranscript,
  extractItemId,
  extractFinalText,
  extractServerTimestamp,
  extractInterimPayload,
  isIgnorableCommitError,
  isIgnorableSessionUpdateError,
  isLikelyHallucination,
} = utils;

describe('normalizeCompareText', () => {
  it('strips whitespace and punctuation', () => {
    expect(normalizeCompareText('你好，世界！')).toBe('你好世界');
    expect(normalizeCompareText('Hello, World!')).toBe('helloworld');
  });
});

describe('longestCommonSubstringRatio', () => {
  it('returns 1 for identical normalized strings', () => {
    expect(longestCommonSubstringRatio('你好', '你好！')).toBe(1);
  });
  it('returns 0 for disjoint strings', () => {
    expect(longestCommonSubstringRatio('abc', 'xyz')).toBe(0);
  });
  it('computes partial overlap ratio', () => {
    // "abcd" vs "xbcz" -> LCS "bc" length 2, shorter len 4 -> 0.5
    expect(longestCommonSubstringRatio('abcd', 'xbcz')).toBeCloseTo(0.5, 3);
  });
});

describe('shouldDedupSegment', () => {
  const last = { text: '机器学习', beginTime: 1000, endTime: 2000 };

  it('dedups when similar and overlapping', () => {
    const next = { text: '机器学习', beginTime: 1500, endTime: 2500 };
    expect(shouldDedupSegment(last, next, 0.95, 500)).toBe(true);
  });

  it('does not dedup when similar but gap too large', () => {
    const next = { text: '机器学习', beginTime: 5000, endTime: 6000 };
    expect(shouldDedupSegment(last, next, 0.95, 500)).toBe(false);
  });

  it('does not dedup when dissimilar', () => {
    const next = { text: '完全无关', beginTime: 1500, endTime: 2500 };
    expect(shouldDedupSegment(last, next, 0.95, 500)).toBe(false);
  });
});

describe('splitLongTranscript', () => {
  it('短句（≤ 200 字）原样返回，不切（绝大多数自然句）', () => {
    const r = splitLongTranscript('你好世界', 0, 1000);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('你好世界');
  });

  it('100 字中文句不切（之前 80 字阈值会切，现在保留）', () => {
    // 拼到约 70-90 字之间——之前阈值 80 会触发切，现在阈值 200 不会
    const text =
      '今天我们学习了机器学习的基础知识和一些常见算法的使用场景，' +
      '包括监督学习的核心思想以及如何评估模型表现。' +
      '接下来我们讨论了一下监督学习方法的具体案例。';
    expect(text.length).toBeGreaterThan(60);
    expect(text.length).toBeLessThan(200);
    const r = splitLongTranscript(text, 0, 10000);
    // 200 字以内不切（200 字以下，含逗号、句号都不该被分段）
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe(text);
  });

  it('250+ 字超长中文按句号切，时间戳递增', () => {
    const long =
      '今天我们学习了机器学习的基础知识和一些常见算法的使用场景，包括监督学习的核心思想以及如何评估模型表现，模型评估常用的指标有准确率召回率F1分数等。' +
      '接下来我们讨论了一下监督学习方法的具体案例，比如线性回归如何在房价预测里发挥作用，以及决策树的优劣对比和随机森林的提升思路。' +
      '然后再看一下无监督学习里面聚类算法的例子，比如 K-Means 算法和层次聚类各自适用的场景以及如何选择合适的 K 值。' +
      '最后我们简要介绍一下强化学习的基本原理和应用前景，包括 Q-learning 和策略梯度的入门概念。';
    expect(long.length).toBeGreaterThan(200);
    const r = splitLongTranscript(long, 0, 10000);
    expect(r.length).toBeGreaterThan(1);
    // 时间戳严格递增
    for (let i = 1; i < r.length; i++) {
      expect(r[i].beginTime).toBeGreaterThanOrEqual(r[i - 1].beginTime);
    }
    // 首段从 0 开始
    expect(r[0].beginTime).toBe(0);
    // 末段结束于 endTime
    expect(r[r.length - 1].endTime).toBe(10000);
    // 关键：所有非末段切点都在句号/软标点后
    for (const seg of r.slice(0, -1)) {
      const last = seg.text.replace(/\s+$/, '').slice(-1);
      expect(['。', '！', '？', '!', '?', '，', ',', '；', ';']).toContain(last);
    }
  });

  it('英文长句永不词中切（每段都以空格/标点为边界结尾）', () => {
    // 英文长 transcript（无句号，纯连续讲话），看是否会切到词中
    const long =
      'See through popular culture, it is no longer only about looks and appearances. ' +
      'The focus is shifting toward talent and ability, and the freedom to be yourself. ' +
      'That makes me happy. Yeah, and I think in every society, the standards of beauty ' +
      'are often set by others, and people end up looking the same, which is such a waste. ' +
      'I think. Yeah, and I want to say everyone is unique and we should embrace ourselves.';
    expect(long.length).toBeGreaterThan(200);
    const r = splitLongTranscript(long, 0, 10000);
    // 多段：保证每段最后一个字符不是字母（即不切词中）
    for (const seg of r.slice(0, -1)) {
      const lastChar = seg.text.replace(/\s+$/, '').slice(-1);
      const isWordChar = /[A-Za-z]/.test(lastChar);
      // 末尾应该是标点（句号/逗号/问号），不能是字母（字母 = 词中切证据）
      expect(isWordChar).toBe(false);
    }
  });

  it('词中切的 worst case 数据：之前 60 字硬切会切 "looks and appearances" 现在不再切', () => {
    // 这是一段约 80 字的英文，落在 200 阈值内 → 完全不切
    const text = 'See through popular culture, it is no longer only about looks and appearances.';
    const r = splitLongTranscript(text, 0, 5000);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe(text);
    // 强保障：完整 looks/ability/everyone 都还在
    expect(r[0].text).toContain('looks');
    expect(r[0].text).toContain('appearances');
  });
});

describe('extractItemId', () => {
  it('prefers item_id over item.id', () => {
    expect(extractItemId({ item_id: 'A', item: { id: 'B' } })).toBe('A');
  });
  it('falls back to item.id', () => {
    expect(extractItemId({ item: { id: 'B' } })).toBe('B');
  });
  it('returns null when absent', () => {
    expect(extractItemId({})).toBeNull();
  });
});

describe('extractFinalText', () => {
  it('extracts from item.content[0].text', () => {
    expect(extractFinalText({ item: { content: [{ text: 'hi' }] } })).toBe('hi');
  });
  it('falls back to transcript', () => {
    expect(extractFinalText({ transcript: 'yo' })).toBe('yo');
  });
  it('returns empty string when none', () => {
    expect(extractFinalText({})).toBe('');
  });
});

describe('extractServerTimestamp', () => {
  it('reads begin_time', () => {
    expect(extractServerTimestamp({ begin_time: 123 }, 'begin')).toBe(123);
  });
  it('reads end_time', () => {
    expect(extractServerTimestamp({ end_time: 456 }, 'end')).toBe(456);
  });
  it('returns null when absent', () => {
    expect(extractServerTimestamp({}, 'begin')).toBeNull();
  });
});

describe('extractInterimPayload', () => {
  it('composes stable + unstable', () => {
    const r = extractInterimPayload({ text: '你好', stash: '世界' });
    expect(r.stableText).toBe('你好');
    expect(r.unstableText).toBe('世界');
    expect(r.text).toBe('你好世界');
  });
  it('falls back to delta when stash missing', () => {
    const r = extractInterimPayload({ text: '你好', delta: '啊' });
    expect(r.unstableText).toBe('啊');
  });
});

describe('isIgnorableCommitError', () => {
  it('matches expected pattern', () => {
    expect(isIgnorableCommitError('Error committing input audio buffer: timeout')).toBe(true);
    expect(isIgnorableCommitError('unrelated error')).toBe(false);
    expect(isIgnorableCommitError(null)).toBe(false);
  });
});

describe('isIgnorableSessionUpdateError', () => {
  it('matches expected pattern', () => {
    expect(isIgnorableSessionUpdateError('session already started or finished or failed')).toBe(true);
    expect(isIgnorableSessionUpdateError('something else')).toBe(false);
  });

  it('treats DashScope empty user-message validation as a non-fatal session update error', () => {
    expect(
      isIgnorableSessionUpdateError(
        '<400> InternalError.Algo.InvalidParameter: The input messages do not contain elements with the role of user',
      ),
    ).toBe(true);
  });
});

describe('isLikelyHallucination', () => {
  it('flags extremely short audio with long text', () => {
    expect(isLikelyHallucination('你好世界', 200)).toBe(true);
  });
  it('flags short audio with filler token', () => {
    expect(isLikelyHallucination('嗯', 400)).toBe(true);
  });
  it('does not flag normal utterance', () => {
    expect(isLikelyHallucination('机器学习的核心', 2000)).toBe(false);
  });
  it('flags empty text', () => {
    expect(isLikelyHallucination('', 5000)).toBe(true);
  });
  it('filters short low-information utterances commonly hallucinated from classroom noise', () => {
    expect(isLikelyHallucination('Yeah.', 900)).toBe(true);
    expect(isLikelyHallucination('I see.', 1200)).toBe(true);
    expect(isLikelyHallucination('Agree.', 2600)).toBe(true);
    expect(isLikelyHallucination('啊，对。', 800)).toBe(true);
  });
  it('keeps the same words when they are part of a longer, plausible utterance', () => {
    expect(isLikelyHallucination('Yes, this is the central argument.', 2400)).toBe(false);
    expect(isLikelyHallucination('I agree with the first interpretation.', 2200)).toBe(false);
  });
  it('filters physically implausible speech rates', () => {
    expect(isLikelyHallucination('这是一段不可能在短时间说完的话', 500)).toBe(true);
    expect(isLikelyHallucination('one two three four five six', 400)).toBe(true);
  });
});
