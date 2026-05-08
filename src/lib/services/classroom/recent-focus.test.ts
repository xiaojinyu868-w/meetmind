import { describe, expect, it } from 'vitest';
import { extractRecentFocus } from './recent-focus';

describe('extractRecentFocus', () => {
  it('returns empty string for no segments', () => {
    expect(extractRecentFocus([])).toBe('');
  });

  it('returns empty string when latest segment has no endMs', () => {
    // 没有 endMs 意味着还没有 final segment——不要做聚焦（会给错的参照系）
    expect(extractRecentFocus([{ startMs: 0, text: 'hello' }])).toBe('');
  });

  it('picks up only the last 30s by default', () => {
    const segs = [
      { startMs: 0, endMs: 5_000, text: 'earlier topic' },
      { startMs: 10_000, endMs: 20_000, text: 'middle topic' },
      { startMs: 60_000, endMs: 65_000, text: 'recent a' }, // within 30s of 90s
      { startMs: 80_000, endMs: 90_000, text: 'recent b' },
    ];
    const out = extractRecentFocus(segs);
    expect(out).toContain('recent a');
    expect(out).toContain('recent b');
    expect(out).not.toContain('earlier topic');
    expect(out).not.toContain('middle topic');
  });

  it('respects custom windowMs', () => {
    const segs = [
      { startMs: 0, endMs: 10_000, text: 'old' },
      { startMs: 50_000, endMs: 60_000, text: 'fresh' },
    ];
    expect(extractRecentFocus(segs, { windowMs: 5_000 })).toBe('fresh');
    expect(extractRecentFocus(segs, { windowMs: 60_000 })).toContain('old');
  });

  it('truncates to maxChars keeping the tail', () => {
    const longText = 'a'.repeat(200) + 'TAIL';
    const segs = [{ startMs: 0, endMs: 5_000, text: longText }];
    const out = extractRecentFocus(segs, { maxChars: 50 });
    expect(out).toHaveLength(50);
    // 尾部必须保留，因为"尾部"是学生问话那一刻刚说完的内容
    expect(out.endsWith('TAIL')).toBe(true);
  });

  it('joins multiple recent segments with spaces and trims whitespace', () => {
    const segs = [
      { startMs: 0, endMs: 5_000, text: '  foo  ' },
      { startMs: 6_000, endMs: 8_000, text: ' bar' },
    ];
    expect(extractRecentFocus(segs)).toBe('foo bar');
  });

  it('skips empty-text segments', () => {
    const segs = [
      { startMs: 0, endMs: 5_000, text: 'a' },
      { startMs: 6_000, endMs: 7_000, text: '' },
      { startMs: 8_000, endMs: 10_000, text: 'b' },
    ];
    expect(extractRecentFocus(segs)).toBe('a b');
  });
});
