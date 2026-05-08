import { describe, it, expect } from 'vitest';
import { extractCitationsFromMarkdown, normalizeCompanionMarkdown } from './companion-markdown-utils';

describe('extractCitationsFromMarkdown', () => {
  it('抽出 [MM:SS] 时间戳并清除 markdown 里对应字面量', () => {
    const input = '这段在讲极限 [01:23]，和后面的连续性 [02:05-02:30] 有关。';
    const { content, citations } = extractCitationsFromMarkdown(input);
    expect(content).not.toContain('[01:23]');
    expect(content).not.toContain('[02:05-02:30]');
    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({
      startMs: 83_000,        // 1*60 + 23 = 83
      endMs: 85_000,          // default +2s when single
      label: '01:23',
    });
    expect(citations[1]).toMatchObject({
      startMs: 125_000,       // 2*60 + 5
      endMs: 150_000,         // 2*60 + 30
      label: '02:05-02:30',
    });
  });

  it('兼容 [引用 MM:SS] 旧标记', () => {
    const { citations } = extractCitationsFromMarkdown('见 [引用 01:10]');
    expect(citations).toHaveLength(1);
    expect(citations[0].label).toBe('01:10');
    expect(citations[0].startMs).toBe(70_000);
  });

  it('去重：相同时间戳只留一条', () => {
    const { citations } = extractCitationsFromMarkdown('A [00:30] B [00:30] C');
    expect(citations).toHaveLength(1);
  });

  it('最多保留 6 条', () => {
    const parts = Array.from({ length: 10 }, (_, i) => `[00:${String(10 + i).padStart(2, '0')}]`);
    const { citations } = extractCitationsFromMarkdown(parts.join(' '));
    expect(citations).toHaveLength(6);
  });

  it('没有时间戳时 citations 为空、content 不变（除空格修剪外）', () => {
    const { content, citations } = extractCitationsFromMarkdown('这节课讲了极限。');
    expect(citations).toHaveLength(0);
    expect(content).toBe('这节课讲了极限。');
  });

  it('normalizeCompanionMarkdown 作为兼容包装返回干净正文', () => {
    const cleaned = normalizeCompanionMarkdown('见 [01:23] 这段');
    expect(cleaned).not.toContain('[01:23]');
    expect(cleaned).toContain('这段');
  });
});
