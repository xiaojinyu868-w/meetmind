import { describe, it, expect } from 'vitest';
import {
  parseTimestamp,
  findTimestamps,
  splitByTimestamp,
  stripTimestamps,
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

describe('stripTimestamps', () => {
  it('抹掉各种形态的时间戳标记', () => {
    expect(stripTimestamps('老师在 [02:15] 提到反向传播，[03:45-04:00] 又讲了一遍')).toBe(
      '老师在 提到反向传播，又讲了一遍',
    );
    expect(stripTimestamps('看 [t=01:30:00] 这段')).toBe('看 这段');
  });

  it('保留误匹配的非时间戳括号', () => {
    expect(stripTimestamps('价格是 [99:99] 不是时间戳')).toBe('价格是 [99:99] 不是时间戳');
  });

  it('清理标记走后留下的空位', () => {
    expect(stripTimestamps('这一段 [20:01] ，讲得很细。')).toBe('这一段，讲得很细。');
    expect(stripTimestamps('开头 [01:00]  有两个空格')).toBe('开头 有两个空格');
  });

  it('没有时间戳的文本原样返回', () => {
    expect(stripTimestamps('普通的一句话。')).toBe('普通的一句话。');
  });
});
