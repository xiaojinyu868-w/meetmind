import { describe, it, expect } from 'vitest';
import { computeCer, normalize, toChars } from './cer';

describe('CER normalize', () => {
  it('strips whitespace and punctuation by default', () => {
    expect(normalize('你好，世界！')).toBe('你好世界');
    expect(normalize('Hello, World!')).toBe('helloworld');
  });

  it('converts full-width to half-width', () => {
    expect(normalize('２０２６年')).toBe('2026年');
  });

  it('preserves CJK characters while lowercasing latin', () => {
    expect(normalize('Python 课程 第1章')).toBe('python课程第1章');
  });
});

describe('toChars', () => {
  it('splits by unicode code points, not by utf-16 units', () => {
    expect(toChars('你好').length).toBe(2);
    expect(toChars('ab你好').length).toBe(4);
  });
});

describe('computeCer', () => {
  it('returns 0 for identical strings', () => {
    const r = computeCer('你好世界', '你好世界');
    expect(r.cer).toBe(0);
    expect(r.editDistance).toBe(0);
  });

  it('counts substitutions correctly', () => {
    // 你好世界 → 你好时界  (1 substitution: 世→时)
    const r = computeCer('你好世界', '你好时界');
    expect(r.substitutions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.insertions).toBe(0);
    expect(r.cer).toBeCloseTo(1 / 4, 5);
  });

  it('counts deletions correctly', () => {
    // reference "abcd" -> hyp "abd" : delete 'c'
    const r = computeCer('abcd', 'abd');
    expect(r.deletions).toBe(1);
    expect(r.substitutions).toBe(0);
    expect(r.insertions).toBe(0);
    expect(r.cer).toBeCloseTo(1 / 4, 5);
  });

  it('counts insertions correctly', () => {
    // reference "abc" -> hyp "abdc" : insert 'd'
    const r = computeCer('abc', 'abdc');
    expect(r.insertions).toBe(1);
    expect(r.cer).toBeCloseTo(1 / 3, 5);
  });

  it('handles empty reference as CER=1 if hyp non-empty', () => {
    const r = computeCer('', 'xyz');
    expect(r.cer).toBe(1);
    expect(r.referenceLength).toBe(0);
    expect(r.insertions).toBe(3);
  });

  it('handles empty reference with empty hyp as CER=0', () => {
    const r = computeCer('', '');
    expect(r.cer).toBe(0);
  });

  it('normalizes before comparing by default', () => {
    const r = computeCer('你好，世界！', '你好 世界');
    expect(r.cer).toBe(0);
  });

  it('allows skipping normalization with false', () => {
    const r = computeCer('你好，世界！', '你好 世界', false);
    expect(r.cer).toBeGreaterThan(0);
  });

  it('combined edit types', () => {
    // "kitten" -> "sitting": k->s, e->i, ins g at end = 3 edits over 6 chars
    const r = computeCer('kitten', 'sitting', false);
    expect(r.editDistance).toBe(3);
    expect(r.cer).toBeCloseTo(3 / 6, 5);
  });

  it('中文会议转写典型场景', () => {
    const reference = '机器学习的核心是梯度下降算法';
    const hyp = '机器学习的核心是梯度下降算发'; // 法→发 1 sub
    const r = computeCer(reference, hyp);
    expect(r.substitutions).toBe(1);
    expect(r.referenceLength).toBe(14);
    expect(r.cer).toBeCloseTo(1 / 14, 4);
  });
});
