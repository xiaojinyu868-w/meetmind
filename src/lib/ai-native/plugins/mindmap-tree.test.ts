import { describe, expect, it } from 'vitest';
import { flattenInlineTex, markdownToTree, stripInlineMarkdown } from './mindmap-tree';

describe('flattenInlineTex', () => {
  it('把 $…$ 折成 Unicode 数学符号，SVG 节点能直接显示', () => {
    expect(flattenInlineTex('集合与法则 ($X \\to Y$)')).toBe('集合与法则 (X → Y)');
    expect(flattenInlineTex('值域 ($R_f$, $R_f \\subseteq Y$)')).toBe('值域 (R_f, R_f ⊆ Y)');
    expect(flattenInlineTex('$x_1 \\ne x_2 \\Rightarrow f(x_1) \\ne f(x_2)$')).toBe('x₁ ≠ x₂ ⇒ f(x₁) ≠ f(x₂)');
    expect(flattenInlineTex('$\\lim_{n \\to \\infty} a_n$')).toBe('limₙ → ∞ aₙ');
    expect(flattenInlineTex('$y = x^2$, $\\alpha + \\beta$')).toBe('y = x², α + β');
  });

  it('没有数学的文本原样返回', () => {
    expect(flattenInlineTex('映射的基本定义')).toBe('映射的基本定义');
  });
});

describe('stripInlineMarkdown + markdownToTree', () => {
  it('节点标题同时去 markdown 和折 TeX', () => {
    expect(stripInlineMarkdown('**定义域** ($D_f$, Domain)')).toBe('定义域 (D_f, Domain)');
    const tree = markdownToTree('# 映射\n- 满射 ($R_f = Y$)\n  - 单射 (不同$x$对应不同$y$)');
    expect(tree.children[0].title).toBe('满射 (R_f = Y)');
    expect(tree.children[0].children[0].title).toBe('单射 (不同x对应不同y)');
  });
});
