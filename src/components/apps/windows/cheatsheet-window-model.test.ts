import { describe, expect, it } from 'vitest';
import type { CheatsheetSection } from '@/lib/ai-native/plugins/cheatsheet.plugin';
import {
  OPEN_BOOK_PRINT_SETTINGS,
  REVIEW_PRINT_SETTINGS,
  citationLabel,
  pageCapacity,
  paginateCheatsheetSections,
  targetPageCount,
} from './cheatsheet-window-model';

function section(count: number): CheatsheetSection {
  return {
    key: 'definition',
    label: '核心定义',
    items: Array.from({ length: count }, (_, index) => ({
      id: `item-${index}`,
      term: `术语 ${index}`,
      body: '一句足够简短、可以被快速扫读的定义。',
      emphasis: 'normal',
    })),
  };
}

describe('cheatsheet print model', () => {
  it('maps one duplex sheet to two printable pages', () => {
    expect(targetPageCount(OPEN_BOOK_PRINT_SETTINGS)).toBe(2);
    expect(targetPageCount(REVIEW_PRINT_SETTINGS)).toBe(2);
  });

  it('gives compact landscape more capacity than standard portrait', () => {
    expect(pageCapacity(OPEN_BOOK_PRINT_SETTINGS)).toBeGreaterThan(pageCapacity(REVIEW_PRINT_SETTINGS));
  });

  it('splits dense sections across physical pages without losing items', () => {
    const source = section(80);
    const pages = paginateCheatsheetSections([source], REVIEW_PRINT_SETTINGS);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.flatMap((page) => page.sections).flatMap((item) => item.items)).toHaveLength(80);
    expect(pages.every((page) => page.sections[0]?.label === '核心定义')).toBe(true);
  });

  it('uses the lesson title and lesson-local time for multi-source citations', () => {
    expect(citationLabel({
      id: 'x',
      term: '边际成本',
      body: '定义',
      emphasis: 'normal',
      citation: {
        startMs: 70_000,
        endMs: 75_000,
        sourceTitle: '第二讲 · 成本',
        sourceStartMs: 10_000,
      },
    })).toBe('第二讲 · 成本 · 0:10');
  });

  it('labels syllabus evidence without inventing a classroom timestamp', () => {
    expect(citationLabel({
      id: 'x',
      term: '考试范围',
      body: '包含需求弹性',
      emphasis: 'normal',
      citation: {
        startMs: 0,
        endMs: 0,
        sourceTitle: '考试大纲',
        sourceKind: 'syllabus',
      },
    })).toBe('考试大纲');
  });
});
