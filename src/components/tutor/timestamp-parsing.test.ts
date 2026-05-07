import { describe, it, expect } from 'vitest';
import {
  parseTimestamp,
  findTimestamps,
  splitByTimestamp,
} from './timestamp-parsing';

describe('parseTimestamp', () => {
  it('parses MM:SS', () => {
    expect(parseTimestamp('02:15')).toBe(135_000);
  });
  it('parses HH:MM:SS', () => {
    expect(parseTimestamp('01:02:15')).toBe(3_735_000);
  });
  it('parses range by taking start', () => {
    expect(parseTimestamp('02:15-03:00')).toBe(135_000);
  });
  it('rejects out-of-range seconds', () => {
    expect(parseTimestamp('02:99')).toBeNull();
  });
  it('rejects garbage', () => {
    expect(parseTimestamp('abc')).toBeNull();
    expect(parseTimestamp('')).toBeNull();
  });
});

describe('findTimestamps', () => {
  it('finds [t=MM:SS] (prompt format)', () => {
    const r = findTimestamps('老师在 [t=02:15] 提到反向传播');
    expect(r).toHaveLength(1);
    expect(r[0].display).toBe('02:15');
    expect(r[0].startMs).toBe(135_000);
  });

  it('finds drifted [MM:SS] without t= prefix', () => {
    const r = findTimestamps('看这段 [03:45] 再想想');
    expect(r).toHaveLength(1);
    expect(r[0].startMs).toBe(225_000);
  });

  it('finds HH:MM:SS for long videos', () => {
    const r = findTimestamps('1 小时那段 [01:30:00] 开始');
    expect(r).toHaveLength(1);
    expect(r[0].startMs).toBe(5_400_000);
  });

  it('finds range format', () => {
    const r = findTimestamps('[02:15-03:00] 这段讲了');
    expect(r).toHaveLength(1);
    expect(r[0].display).toBe('02:15-03:00');
    expect(r[0].startMs).toBe(135_000);
  });

  it('finds multiple', () => {
    const r = findTimestamps('先看 [t=01:00]，再看 [02:30]');
    expect(r).toHaveLength(2);
    expect(r.map((m) => m.startMs)).toEqual([60_000, 150_000]);
  });

  it('handles no matches', () => {
    expect(findTimestamps('没有时间戳的普通文本')).toEqual([]);
  });

  it('does not match invalid seconds', () => {
    expect(findTimestamps('[t=02:99]')).toEqual([]);
  });
});

describe('splitByTimestamp', () => {
  it('splits text around timestamps', () => {
    const r = splitByTimestamp('老师在 [t=02:15] 讲反向传播');
    expect(r).toEqual([
      { kind: 'text', text: '老师在 ' },
      { kind: 'timestamp', display: '02:15', startMs: 135_000 },
      { kind: 'text', text: ' 讲反向传播' },
    ]);
  });

  it('returns single text when no match', () => {
    expect(splitByTimestamp('hello')).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  it('handles timestamp at start', () => {
    const r = splitByTimestamp('[t=01:00] 开头');
    expect(r[0].kind).toBe('timestamp');
    expect(r).toHaveLength(2);
  });

  it('handles timestamp at end', () => {
    const r = splitByTimestamp('结尾 [t=01:00]');
    expect(r[r.length - 1].kind).toBe('timestamp');
    expect(r).toHaveLength(2);
  });

  it('handles consecutive timestamps', () => {
    const r = splitByTimestamp('[01:00][02:00]');
    expect(r.filter((p) => p.kind === 'timestamp')).toHaveLength(2);
  });
});
