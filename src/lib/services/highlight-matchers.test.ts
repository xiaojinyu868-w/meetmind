import { describe, it, expect } from 'vitest';
import {
  findSubstringPosition,
  hasTimeOverlap,
  calculatePreciseTime,
  inferImportance,
  dedupeCandidates,
} from './highlight-matchers';

// ── findSubstringPosition ──────────────────────────────────────────

describe('findSubstringPosition', () => {
  it('精确匹配：返回正确的起止位置', () => {
    // cleanText 去掉非字母数字字符：'hello world' → 'helloworld'
    const result = findSubstringPosition('hello world', 'world');
    expect(result).not.toBeNull();
    expect(result!.startIdx).toBe(5); // 'helloworld' 中 'world' 从 index 5 开始
    expect(result!.endIdx).toBe(10);
    expect(result!.matchedText).toBe('world');
  });

  it('精确匹配：中文文本', () => {
    const result = findSubstringPosition('今天天气真好', '天气真好');
    expect(result).not.toBeNull();
    expect(result!.matchedText).toBe('天气真好');
  });

  it('空输入返回 null', () => {
    expect(findSubstringPosition('', 'test')).toBeNull();
    expect(findSubstringPosition('test', '')).toBeNull();
    expect(findSubstringPosition('', '')).toBeNull();
  });

  it('无匹配返回 null', () => {
    const result = findSubstringPosition('hello world', 'xyz完全不同的文本');
    expect(result).toBeNull();
  });

  it('模糊匹配：最长公共子串', () => {
    // searchText 的前半部分在 fullText 中存在
    const result = findSubstringPosition(
      '机器学习是人工智能的一个分支',
      '机器学习是一种方法', // 前 5 个字匹配
      0.4
    );
    expect(result).not.toBeNull();
    expect(result!.matchedText).toContain('机器学习');
  });
});

// ── hasTimeOverlap ─────────────────────────────────────────────────

describe('hasTimeOverlap', () => {
  it('完全重叠', () => {
    expect(hasTimeOverlap(
      { startMs: 1000, endMs: 5000 },
      { startMs: 2000, endMs: 4000 },
      0
    )).toBe(true);
  });

  it('部分重叠', () => {
    expect(hasTimeOverlap(
      { startMs: 1000, endMs: 3000 },
      { startMs: 2000, endMs: 5000 },
      0
    )).toBe(true);
  });

  it('不重叠', () => {
    expect(hasTimeOverlap(
      { startMs: 1000, endMs: 2000 },
      { startMs: 3000, endMs: 5000 },
      0
    )).toBe(false);
  });

  it('带容差的重叠', () => {
    // seg 在 2000 结束，range 在 3000 开始，容差 1500ms → 应该重叠
    expect(hasTimeOverlap(
      { startMs: 1000, endMs: 2000 },
      { startMs: 3000, endMs: 5000 },
      1500
    )).toBe(true);
  });

  it('边界刚好相切', () => {
    expect(hasTimeOverlap(
      { startMs: 1000, endMs: 3000 },
      { startMs: 3000, endMs: 5000 },
      0
    )).toBe(true);
  });
});

// ── calculatePreciseTime ───────────────────────────────────────────

describe('calculatePreciseTime', () => {
  const segment = {
    id: '1',
    text: 'hello world',  // 11 chars
    startMs: 0,
    endMs: 11000,
    confidence: 1.0,
    isFinal: true,
  };

  it('整段返回原始时间', () => {
    // cleanText('hello world') → 'helloworld' (10 chars)
    // msPerChar = 11000 / 10 = 1100
    // endMs = 0 + 10 * 1100 = 11000
    const result = calculatePreciseTime(segment as any, 0, 10);
    expect(result.startMs).toBe(0);
    expect(result.endMs).toBe(11000);
  });

  it('前半段', () => {
    // cleanText('hello world') → 'helloworld' (10 chars)
    // msPerChar = 11000 / 10 = 1100
    // endMs = 0 + 5 * 1100 = 5500
    const result = calculatePreciseTime(segment as any, 0, 5);
    expect(result.startMs).toBe(0);
    expect(result.endMs).toBe(5500);
  });

  it('空文本回退到原始时间', () => {
    const emptySeg = { ...segment, text: '   ' };
    const result = calculatePreciseTime(emptySeg as any, 0, 0);
    expect(result.startMs).toBe(0);
    expect(result.endMs).toBe(11000);
  });
});

// ── inferImportance ────────────────────────────────────────────────

describe('inferImportance', () => {
  it('空 segments 返回 medium', () => {
    expect(inferImportance([], 600000)).toBe('medium');
  });

  it('长片段（> 60s）→ high', () => {
    const segments = [{ start: 10000, end: 80000, text: 'x', startSegmentIdx: 0, endSegmentIdx: 0, confidence: 1 }];
    expect(inferImportance(segments, 600000)).toBe('high');
  });

  it('开头位置（< 10%）→ high', () => {
    const segments = [{ start: 5000, end: 10000, text: 'x', startSegmentIdx: 0, endSegmentIdx: 0, confidence: 1 }];
    expect(inferImportance(segments, 600000)).toBe('high');
  });

  it('结尾位置（> 85%）→ high', () => {
    const segments = [{ start: 550000, end: 560000, text: 'x', startSegmentIdx: 0, endSegmentIdx: 0, confidence: 1 }];
    expect(inferImportance(segments, 600000)).toBe('high');
  });

  it('中间位置短片段 → medium', () => {
    const segments = [{ start: 300000, end: 310000, text: 'x', startSegmentIdx: 0, endSegmentIdx: 0, confidence: 1 }];
    expect(inferImportance(segments, 600000)).toBe('medium');
  });
});

// ── dedupeCandidates ───────────────────────────────────────────────

describe('dedupeCandidates', () => {
  it('去除重复候选', () => {
    const candidates = [
      { title: '机器学习的定义和核心概念', quote: { timestamp: '1:30-2:00', text: '...' } },
      { title: '机器学习的定义和核心概念', quote: { timestamp: '1:30-2:00', text: '...' } },
      { title: '不同的话题完全不同', quote: { timestamp: '5:00-6:00', text: '...' } },
    ] as any[];
    const result = dedupeCandidates(candidates);
    expect(result).toHaveLength(2);
  });

  it('空数组', () => {
    expect(dedupeCandidates([])).toHaveLength(0);
  });

  it('无重复则全部保留', () => {
    const candidates = [
      { title: '话题A', quote: { timestamp: '1:00', text: 'a' } },
      { title: '话题B', quote: { timestamp: '2:00', text: 'b' } },
    ] as any[];
    expect(dedupeCandidates(candidates)).toHaveLength(2);
  });
});
