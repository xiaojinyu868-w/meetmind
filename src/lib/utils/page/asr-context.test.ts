import { describe, expect, it } from 'vitest';
import { buildASRContextHint } from './context-and-format';

describe('buildASRContextHint', () => {
  it('includes baseline AI tool terms even when the user has not provided a topic', () => {
    const hint = buildASRContextHint({
      manualHint: '',
      recentSegments: [],
      importedReferences: [],
    });

    expect(hint).toContain('Cursor');
    expect(hint).toContain('Claude Code');
    expect(hint).toContain('Codex');
    expect(hint).toContain('Copilot');
    expect(hint).toContain('Midjourney');
  });

  it('keeps user-provided topic before generic tool terms', () => {
    const hint = buildASRContextHint({
      manualHint: 'AI 编程工具课：Cursor、Copilot、Claude Code 的产品差异',
      recentSegments: [],
      importedReferences: [],
    });

    expect(hint.indexOf('AI 编程工具课')).toBeLessThan(hint.indexOf('常见中英混合术语'));
  });
});
