import { describe, expect, it } from 'vitest';
import { collapseDoubledLatexBackslashes, normalizeLatexInRichText, repairLatexEscapesInJson } from './latex-json-repair';

describe('repairLatexEscapesInJson (解析前)', () => {
  it('keeps \\to / \\frac / \\neq inside math spans from being eaten as control characters', () => {
    const raw = '{"body":"记 $f:X \\to Y$，$\\frac{1}{2} \\neq 0$，$\\beta$ 与 $\\rho$"}';
    const parsed = JSON.parse(repairLatexEscapesInJson(raw)) as { body: string };
    expect(parsed.body).toBe('记 $f:X \\to Y$，$\\frac{1}{2} \\neq 0$，$\\beta$ 与 $\\rho$');
  });

  it('protects the latex field and doubles invalid escapes so JSON.parse succeeds', () => {
    const raw = '{"latex":"\\forall x \\in \\mathbb{R}","body":"$x \\mid y$"}';
    expect(() => JSON.parse(raw)).toThrow();
    const parsed = JSON.parse(repairLatexEscapesInJson(raw)) as { latex: string; body: string };
    expect(parsed.latex).toBe('\\forall x \\in \\mathbb{R}');
    expect(parsed.body).toBe('$x \\mid y$');
  });

  it('leaves correctly escaped JSON and real newlines outside math alone', () => {
    const raw = '{"body":"第一行\\n第二行 $a \\\\to b$","latex":"E = mc^2"}';
    const parsed = JSON.parse(repairLatexEscapesInJson(raw)) as { body: string; latex: string };
    expect(parsed.body).toBe('第一行\n第二行 $a \\to b$');
    expect(parsed.latex).toBe('E = mc^2');
  });
});

describe('repairLatexEscapesInJson · 约束解码的三反斜杠', () => {
  it('turns \\\\\\to (escaped backslash + tab escape) back into a single \\to', () => {
    const raw = '{"body":"记 $f:X \\\\\\to Y$","latex":"f^{-1}: R_f \\\\\\to X"}';
    const parsed = JSON.parse(repairLatexEscapesInJson(raw)) as { body: string; latex: string };
    expect(parsed.body).toBe('记 $f:X \\to Y$');
    expect(parsed.latex).toBe('f^{-1}: R_f \\to X');
  });
});

describe('collapseDoubledLatexBackslashes (解析后)', () => {
  it('restores control characters and underscores that replaced LaTeX command letters', () => {
    expect(collapseDoubledLatexBackslashes('f:X \\\to Y, \\\frac{1}{2}, n \\\neq 0')).toBe('f:X \\to Y, \\frac{1}{2}, n \\neq 0');
    expect(collapseDoubledLatexBackslashes('R_f \\_subseteq Y, \\_pm 2, \\_lim_{n \\_to \\_infty}')).toBe('R_f \\subseteq Y, \\pm 2, \\lim_{n \\to \\infty}');
    expect(collapseDoubledLatexBackslashes('x \\.in X')).toBe('x \\in X');
    // 约束解码塞的引号 / 斜杠：只折已知命令，变音符 \"o 不动
    expect(collapseDoubledLatexBackslashes('\\forall x \\\\"in X, \\/sum_i')).toBe('\\forall x \\in X, \\sum_i');
    expect(collapseDoubledLatexBackslashes('Schr\\"odinger')).toBe('Schr\\"odinger');
  });

  it('folds over-escaped commands back to single backslashes but keeps LaTeX line breaks', () => {
    expect(collapseDoubledLatexBackslashes('f:X \\\\to Y, \\\\mathbb{R}, \\\\{a\\\\}')).toBe('f:X \\to Y, \\mathbb{R}, \\{a\\}');
    expect(collapseDoubledLatexBackslashes('a \\\\ b')).toBe('a \\\\ b');
    expect(collapseDoubledLatexBackslashes('a \\\\[2pt] b')).toBe('a \\\\[2pt] b');
  });

  it('only touches math spans inside rich text', () => {
    expect(normalizeLatexInRichText('路径 C:\\\\temp 与 $R_f \\\\subseteq Y$')).toBe('路径 C:\\\\temp 与 $R_f \\subseteq Y$');
  });
});
