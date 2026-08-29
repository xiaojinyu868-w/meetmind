import { describe, expect, it } from 'vitest';
import { normalizeNarrationMarks } from './normalize-narration-marks';

describe('normalizeNarrationMarks（teach narration ==高亮== 归一）', () => {
  it('成对 == 转加粗', () => {
    expect(normalizeNarrationMarks('注意==平方差公式==这里')).toBe('注意**平方差公式**这里');
    expect(normalizeNarrationMarks('==a== 和 ==b==')).toBe('**a** 和 **b**');
  });

  it('单个 == 或空对原样保留', () => {
    expect(normalizeNarrationMarks('比较 a==b')).toBe('比较 a==b');
    expect(normalizeNarrationMarks('====')).toBe('====');
    expect(normalizeNarrationMarks('没有标记')).toBe('没有标记');
  });

  it('跨行不配对', () => {
    expect(normalizeNarrationMarks('==头\n尾==')).toBe('==头\n尾==');
  });
});
