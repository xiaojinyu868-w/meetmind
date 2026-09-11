import { describe, expect, it } from 'vitest';
import { latexToSpeech, looksLikeMath, speakableText, splitMathText } from './math-text';

describe('splitMathText', () => {
  it('splits delimited math and keeps currency as text', () => {
    expect(splitMathText('面积是 $a^2$，价格 $5 和 $10 无关')).toEqual([
      { kind: 'text', value: '面积是 ' },
      { kind: 'inline', value: 'a^2' },
      { kind: 'text', value: '，价格 $5 和 $10 无关' },
    ]);
  });
  it('recognises bare LaTeX runs and stops at Chinese / plain English words', () => {
    expect(splitMathText('那对流项 \\mathbf{u}\\cdot\\nabla\\mathbf{u} 会不会等于零')).toEqual([
      { kind: 'text', value: '那对流项 ' },
      { kind: 'inline', value: '\\mathbf{u}\\cdot\\nabla\\mathbf{u}' },
      { kind: 'text', value: ' 会不会等于零' },
    ]);
    const segs = splitMathText('so \\frac{1}{2}mv^2 is kinetic energy');
    expect(segs[1]).toEqual({ kind: 'inline', value: '\\frac{1}{2}mv^2' });
    expect(segs[2].value).toBe(' is kinetic energy');
  });
  it('looksLikeMath', () => {
    expect(looksLikeMath('x^2')).toBe(true);
    expect(looksLikeMath('PA')).toBe(true);
    expect(looksLikeMath('5 和 ')).toBe(false);
  });
});

describe('latexToSpeech（老师念得出口）', () => {
  const cases: Array<[string, string]> = [
    ['\\mathbf{u}\\cdot\\nabla\\mathbf{u}', 'u 点乘 纳布拉 u'],
    ['a^2 + b^2 = c^2', 'a 的平方 加 b 的平方 等于 c 的平方'],
    ['\\frac{1}{2}mv^2', '2 分之 1 m v 的平方'],
    ['\\sqrt{3^2+4^2}', '根号 3 的平方 加 4 的平方'],
    ['x_1 + x_2', 'x1 加 x2'],
    ['\\theta = 30^\\circ', '西塔 等于 30 度'],
    ['\\vec{F} = m\\vec{a}', '向量 F 等于 m 向量 a'],
    ['\\int_0^1 x^2 \\, dx', '积分 从 0 到 1 x 的平方 d x'],
    ['\\sum_{i=1}^{n} i', '求和 从 i 等于 1 到 n i'],
    ["f'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}", 'f 一撇 x 等于 极限 h 趋于 0 h 分之 f x 加 h 减 f x'],
    ['|x - 1| < 2', 'x 减 1 的绝对值 小于 2'],
    ['-x', '负 x'],
    ['\\frac{|PA|}{|PB|} = k', 'PB 的绝对值 分之 PA 的绝对值 等于 k'],
  ];
  for (const [tex, spoken] of cases) {
    it(tex, () => expect(latexToSpeech(tex)).toBe(spoken));
  }
  it('speakableText replaces formulas inside a sentence', () => {
    expect(speakableText('那对流项 $\\mathbf{u}\\cdot\\nabla\\mathbf{u}$ 会不会等于零？')).toBe('那对流项 u 点乘 纳布拉 u 会不会等于零？');
    expect(speakableText('没有公式的一句话。')).toBe('没有公式的一句话。');
  });
});
