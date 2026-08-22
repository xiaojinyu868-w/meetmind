import { describe, expect, it } from 'vitest';
import { tokenizeBoardText, estimateWriteMs } from './board-model';

describe('行内记法解析（v31：手写模拟结构 token 退役，公式走 formula role + KaTeX）', () => {
  it('==高亮== 解析为 hl token（马克笔横扫）', () => {
    const tokens = tokenizeBoardText('关键是 ==先算 Δ== 再套公式');
    expect(tokens.find((t) => t.kind === 'hl')).toMatchObject({ text: '先算 Δ' });
  });

  it('== 不配对不崩：退化为普通字符', () => {
    const tokens = tokenizeBoardText('只有开 ==没有合');
    expect(tokens.some((t) => t.kind === 'hl')).toBe(false);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('LaTeX 符号命令转 unicode；后随字母不误吃', () => {
    const tokens = tokenizeBoardText('a \\pm b \\times 2');
    const texts = tokens.map((t) => t.text);
    expect(texts).toContain('±');
    expect(texts).toContain('×');
    const delta = tokenizeBoardText('\\Delta \\geq 0');
    expect(delta.map((t) => t.text)).toContain('Δ');
    expect(delta.map((t) => t.text)).toContain('≥');
  });

  it('v30 记法不再解析：\\frac 等按普通字符处理（公式必须走 formula role）', () => {
    const tokens = tokenizeBoardText('\\frac{a}{b}');
    expect(tokens.some((t) => t.kind !== 'word' && t.kind !== 'punct' && t.kind !== 'cjk')).toBe(false);
  });

  it('节奏估算不含记法符号（==重点== 只算 重点 两字 + 横扫附加）', () => {
    const withMarkup = estimateWriteMs('==ab==', 'step');
    const plain = estimateWriteMs('ab', 'step');
    // 高亮 = ab 的书写 + 120ms 横扫 + 抖动差异（同 seed 不同文本抖动不同，只断言量级）
    expect(withMarkup).toBeGreaterThan(plain);
    expect(withMarkup).toBeLessThan(plain + 400);
  });
});
