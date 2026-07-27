import { describe, expect, it } from 'vitest';
import type { CheatsheetSection } from '@/lib/ai-native/plugins/cheatsheet.plugin';
import {
  CHEATSHEET_COLUMN_COUNT,
  paginateCheatsheetSections,
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
  it('splits dense sections across physical pages without losing items', () => {
    const source = section(140);
    const pages = paginateCheatsheetSections([source]);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.flatMap((page) => page.sections).flatMap((item) => item.items)).toHaveLength(140);
    expect(pages.every((page) => page.sections[0]?.label === '核心定义')).toBe(true);
    expect(pages.every((page) => page.columns.length <= CHEATSHEET_COLUMN_COUNT)).toBe(true);
    expect(pages.flatMap((page) => page.columns).every((column) => column.sections.length > 0)).toBe(true);
  });

  it('balances column heights on a partially filled page', () => {
    // 12 条定义 ≈ 12.8 成本，容量 56：老式“先灌满第一栏”会把全部条目塞进栏 1，
    // 其余两栏全空；均衡装栏必须让三栏都有内容且高度接近。
    const pages = paginateCheatsheetSections([section(12)]);
    expect(pages).toHaveLength(1);
    const costs = pages[0].columns.map((column) => column.cost);
    expect(costs.length).toBe(CHEATSHEET_COLUMN_COUNT);
    costs.forEach((cost) => expect(cost).toBeGreaterThan(0));
    expect(Math.max(...costs) - Math.min(...costs)).toBeLessThanOrEqual(2);
  });

  it('leaves sparse content as honest whitespace instead of stretching it', () => {
    // 内容只有 3 条时仍是一页三栏的固定密度：不拆成整页大字，也不多分页
    const pages = paginateCheatsheetSections([section(3)]);
    expect(pages).toHaveLength(1);
    expect(pages[0].columns.length).toBeLessThanOrEqual(CHEATSHEET_COLUMN_COUNT);
  });

  it('reserves real paper space for tables and Mermaid instead of counting them as plain text', () => {
    const plain = section(24);
    const rich: CheatsheetSection = {
      ...section(24),
      items: section(24).items.map((item) => ({
        ...item,
        body: `${item.body}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n\`\`\`mermaid\nflowchart LR\nA --> B\n\`\`\``,
      })),
    };
    expect(paginateCheatsheetSections([rich]).length)
      .toBeGreaterThan(paginateCheatsheetSections([plain]).length);
  });
});
