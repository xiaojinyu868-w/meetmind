import { describe, expect, it } from 'vitest';
import { expandColorMacros } from './blocks/LiveBlockView';

describe('expandColorMacros', () => {
  it('expands nested color macros with balanced braces', () => {
    expect(expandColorMacros('\\pine{a^2} + \\blue{\\frac{1}{2}}')).toBe('\\textcolor{#2F6B55}{a^2} + \\textcolor{#3B6FB6}{\\frac{1}{2}}');
    expect(expandColorMacros('\\rose{\\pine{x}}')).toBe('\\textcolor{#C24B5A}{\\textcolor{#2F6B55}{x}}');
    expect(expandColorMacros('a^2+b^2=c^2')).toBe('a^2+b^2=c^2');
  });
});
