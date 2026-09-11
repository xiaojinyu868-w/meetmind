import { describe, expect, it } from 'vitest';
import { expandColorMacros } from './blocks/LiveBlockView';

describe('expandColorMacros', () => {
  it('expands nested color macros with balanced braces', () => {
    expect(expandColorMacros('\\pine{a^2} + \\blue{\\frac{1}{2}}')).toBe('\\textcolor{#2F6B55}{a^2} + \\textcolor{#3B6FB6}{\\frac{1}{2}}');
    expect(expandColorMacros('\\rose{\\pine{x}}')).toBe('\\textcolor{#C24B5A}{\\textcolor{#2F6B55}{x}}');
    expect(expandColorMacros('a^2+b^2=c^2')).toBe('a^2+b^2=c^2');
  });
});

describe('normalizeNoteMarkdown（note 里的裸 LaTeX 与色板宏）', () => {
  it('wraps bare LaTeX in $ and expands color macros; plain text untouched', async () => {
    const { normalizeNoteMarkdown } = await import('./blocks/LiveBlockView');
    const out = normalizeNoteMarkdown('两列：\\pine{e_1 \\to (1, 0)}、\\amber{e_2 \\to (k, 1)}。全看基向量去哪。');
    expect(out).toContain('$\\textcolor{#2F6B55}{e_1 \\to (1, 0)}$');
    expect(out).toContain('$\\textcolor{#C8873A}{e_2 \\to (k, 1)}$');
    expect(out.endsWith('。全看基向量去哪。')).toBe(true);
    expect(normalizeNoteMarkdown('先画两个基向量')).toBe('先画两个基向量');
  });
});
