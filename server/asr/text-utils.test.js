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
  it('returns single segment if text short', () => {
    const r = splitLongTranscript('你好世界', 0, 1000);
    expect(r).toHaveLength(1);
    expect(r[0].text).toBe('你好世界');
  });

  it('splits long text on punctuation', () => {
    // 需要 >80 字才触发切分
    const long = '今天我们学习了机器学习的基础知识和一些常见算法的使用场景。接下来我们讨论一下监督学习方法的具体案例。然后再看一下无监督学习里面聚类算法的例子。最后我们会简要介绍一下强化学习的基本原理和应用前景。';
    expect(long.length).toBeGreaterThan(80);
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
});
