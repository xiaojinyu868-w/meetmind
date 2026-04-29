import { describe, expect, it } from 'vitest';
import { normalizeCompanionMarkdown } from './companion-markdown-utils';

describe('normalizeCompanionMarkdown', () => {
  it('removes classroom timestamps without collapsing markdown line breaks', () => {
    const input = '[12:03] **为什么要这么做？**\n\n1. **先看目标**：找到主线。\n2. **再看证据**：回到原文。';

    const output = normalizeCompanionMarkdown(input);

    expect(output).not.toContain('[12:03]');
    expect(output).toContain('**为什么要这么做？**\n\n1. **先看目标**');
    expect(output).toContain('\n2. **再看证据**');
  });
});
