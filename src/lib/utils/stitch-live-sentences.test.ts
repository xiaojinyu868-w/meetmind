import { describe, it, expect } from 'vitest';
import { stitchLiveSentences, type LiveSentenceInput } from './stitch-live-sentences';

const make = (
  partial: Partial<LiveSentenceInput> & Pick<LiveSentenceInput, 'id' | 'text'>,
): LiveSentenceInput => ({
  startMs: 0,
  isInterim: false,
  ...partial,
});

describe('stitchLiveSentences', () => {
  it('愈合英文词中切：look + s and appearances → looks and appearances', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: 'See through popular culture, it is no longer only about look', startMs: 17000 }),
      make({ id: 's2', text: 's and appearances.', startMs: 19000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('looks and appearances');
    expect(out[0].text).not.toContain('look s and');
    expect(out[0].startMs).toBe(17000);
  });

  it('愈合 a + bility → ability', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: 'and the freedom of a', startMs: 21000 }),
      make({ id: 's2', text: 'bility.', startMs: 22000 }),
    ]);
    expect(out[0].text).toContain('ability');
    expect(out[0].text).not.toContain('a bility');
  });

  it('中文不加空格', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: '今天讲快排', startMs: 1000 }),
      make({ id: 's2', text: '核心是分治。', startMs: 3000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('今天讲快排核心是分治。');
  });

  it('两个完整英文句子（句尾 . 后）拆分', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: 'I am happy.', startMs: 1000 }),
      make({ id: 's2', text: 'Yeah I think so.', startMs: 4000 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe('I am happy.');
    expect(out[1].text).toBe('Yeah I think so.');
  });

  it('interim 单独成句并标 isInterim=true', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: 'Settled.', startMs: 1000 }),
      make({ id: 'live-interim', text: '后面继续说', startMs: 5000, isInterim: true }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].isInterim).toBe(true);
    expect(out[1].text).toBe('后面继续说');
  });

  it('翻译合并去重，多 row 翻译用 / 拼接', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: 'Hello there', startMs: 1000, translation: '你好' }),
      make({ id: 's2', text: ', friend.', startMs: 2000, translation: '朋友' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].translation).toBe('你好 / 朋友');
  });

  it('翻译相同时只保留一份', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: 'Hello', startMs: 1000, translation: '你好' }),
      make({ id: 's2', text: ' world.', startMs: 2000, translation: '你好' }),
    ]);
    expect(out[0].translation).toBe('你好');
  });

  it('无句尾符 + 累积超长 + 遇逗号 → flush 分段', () => {
    // 构造：第一片 80 字 + 逗号；第二片再 50 字 + 逗号；第三片继续
    // 第二片拼接后超 110 阈值且以 , 结尾 → 触发软标点 flush
    const a = 'word '.repeat(16).trim() + ','; // ~80 chars
    const b = 'cont '.repeat(11).trim() + ','; // ~54 chars
    const out = stitchLiveSentences([
      make({ id: 's1', text: a, startMs: 1000 }),
      make({ id: 's2', text: b, startMs: 2000 }),
      make({ id: 's3', text: 'and end.', startMs: 3000 }),
    ]);
    // 第二片合并后 buf > 110 + 末尾是 , → 软标点 flush（前 2 片成 1 句）
    // 第三片以 . 收尾 → 句尾 flush（独立成 1 句）
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('rowIds 拼接为 id，便于 React key 稳定', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: 'Hello' }),
      make({ id: 's2', text: ' world.' }),
    ]);
    expect(out[0].id).toBe('s1+s2');
  });

  it('过滤纯空白', () => {
    const out = stitchLiveSentences([make({ id: 's1', text: '   ' })]);
    expect(out).toEqual([]);
  });

  it('上片以标点结尾时，下片直接拼不重复加空格', () => {
    const out = stitchLiveSentences([
      make({ id: 's1', text: '今天，' }),
      make({ id: 's2', text: '我们继续。' }),
    ]);
    expect(out[0].text).toBe('今天，我们继续。');
  });
});
