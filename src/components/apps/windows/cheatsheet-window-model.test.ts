import { describe, expect, it } from 'vitest';
import type { CheatsheetPayload } from '@/lib/ai-native/plugins/cheatsheet.plugin';
import {
  CHEATSHEET_LAYOUT_PREF_KEY,
  DEFAULT_CHEATSHEET_LAYOUT,
  cheatsheetColumnWidth,
  fitScaleFor,
  formatClock,
  normalizeLayoutPrefs,
  paginateMeasuredBlocks,
  payloadToMarkdown,
  readLayoutPrefs,
  topicsOf,
  type LayoutBlock,
} from './cheatsheet-window-model';

function blocks(spec: Array<[kind: 'heading' | 'item', height: number]>, topicId = 't1'): LayoutBlock[] {
  return spec.map(([kind, height], index) => ({ id: `${kind}:${index}`, kind, topicId, height }));
}

describe('paginateMeasuredBlocks', () => {
  it('fills columns by measured height and starts a new page when all columns are used', () => {
    const items = blocks(Array.from({ length: 30 }, () => ['item', 100] as ['item', number]));
    const pages = paginateMeasuredBlocks(items, { columns: 3, firstPageCapacity: 500, pageCapacity: 500 });
    // 30 × 100 / (3 栏 × 500) = 2 页整
    expect(pages).toHaveLength(2);
    expect(pages.flatMap((page) => page.columns).flatMap((column) => column.blocks)).toHaveLength(30);
    pages.forEach((page) => page.columns.forEach((column) => expect(column.height).toBeLessThanOrEqual(500)));
  });

  it('never leaves a topic heading orphaned at the bottom of a column', () => {
    const list = blocks([['item', 450], ['heading', 30], ['item', 100], ['item', 100]]);
    const pages = paginateMeasuredBlocks(list, { columns: 2, firstPageCapacity: 500, pageCapacity: 500 });
    const firstColumn = pages[0].columns[0].blocks.map((block) => block.kind);
    expect(firstColumn).toEqual(['item']);
    expect(pages[0].columns[1].blocks[0].kind).toBe('heading');
  });

  it('balances the last page instead of stacking everything in the first column', () => {
    const list = blocks(Array.from({ length: 9 }, () => ['item', 50] as ['item', number]));
    const pages = paginateMeasuredBlocks(list, { columns: 3, firstPageCapacity: 1000, pageCapacity: 1000 });
    expect(pages).toHaveLength(1);
    expect(pages[0].columns).toHaveLength(3);
    const heights = pages[0].columns.map((column) => column.height);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(50);
  });

  it('keeps an oversized block instead of dropping it', () => {
    const list = blocks([['item', 100], ['item', 2000], ['item', 100]]);
    const pages = paginateMeasuredBlocks(list, { columns: 2, firstPageCapacity: 500, pageCapacity: 500 });
    expect(pages.flatMap((page) => page.columns).flatMap((column) => column.blocks)).toHaveLength(3);
  });

  it('gives the first page less room when its title block is taller', () => {
    const list = blocks(Array.from({ length: 12 }, () => ['item', 100] as ['item', number]));
    const tallHeader = paginateMeasuredBlocks(list, { columns: 2, firstPageCapacity: 300, pageCapacity: 600 });
    const noHeader = paginateMeasuredBlocks(list, { columns: 2, firstPageCapacity: 600, pageCapacity: 600 });
    expect(tallHeader.length).toBeGreaterThan(noHeader.length);
  });
});

describe('fit-one-page scale estimate', () => {
  it('returns 1 when content already fits and shrinks by sqrt otherwise', () => {
    expect(fitScaleFor(400, 500)).toBe(1);
    expect(fitScaleFor(2000, 500)).toBeCloseTo(Math.sqrt(0.25) * 0.97, 5);
  });
});

describe('layout prefs', () => {
  it('normalizes garbage back to defaults and clamps the font size', () => {
    expect(normalizeLayoutPrefs(null)).toEqual(DEFAULT_CHEATSHEET_LAYOUT);
    expect(normalizeLayoutPrefs({ columns: 7, fontPx: 40, density: 'huge', highlight: 'yes' })).toEqual({
      ...DEFAULT_CHEATSHEET_LAYOUT,
      fontPx: 14,
    });
    expect(normalizeLayoutPrefs({ columns: 4, fontPx: 8.5, density: 'tight', highlight: false, fitOnePage: true }))
      .toEqual({ columns: 4, fontPx: 8.5, density: 'tight', highlight: false, fitOnePage: true });
  });

  it('reads from storage under the documented key', () => {
    const store = new Map<string, string>([[CHEATSHEET_LAYOUT_PREF_KEY, JSON.stringify({ columns: 2 })]]);
    expect(readLayoutPrefs({ getItem: (key) => store.get(key) ?? null }).columns).toBe(2);
    expect(readLayoutPrefs({ getItem: () => '{not json' })).toEqual(DEFAULT_CHEATSHEET_LAYOUT);
  });

  it('derives column width from the A4 logical page', () => {
    expect(cheatsheetColumnWidth(1)).toBe(794 - 68);
    expect(cheatsheetColumnWidth(3)).toBeLessThan(cheatsheetColumnWidth(2));
  });
});

describe('topicsOf / payloadToMarkdown', () => {
  const legacy: CheatsheetPayload = {
    title: '微观经济学速查',
    overview: '开卷时快速定位',
    sections: [
      { key: 'definition', label: '核心定义', items: [{ id: 'd1', term: '机会成本', body: '放弃的最佳替代', emphasis: 'normal' }] },
      { key: 'pitfall', label: '易错点', items: [{ id: 'p1', term: '沉没成本', body: '不影响决策', emphasis: 'strong' }] },
    ],
  };

  it('turns a v1 sections payload into one topic per section and fills kind from the section key', () => {
    const topics = topicsOf(legacy);
    expect(topics.map((topic) => topic.title)).toEqual(['核心定义', '易错点']);
    expect(topics[1].items[0].kind).toBe('pitfall');
  });

  it('prefers v2 topics when present', () => {
    const topics = topicsOf({
      ...legacy,
      topics: [{ id: 'topic-1', title: '成本', items: [{ id: 'x', term: 'MC', body: '边际', emphasis: 'normal', kind: 'formula' }] }],
    });
    expect(topics).toHaveLength(1);
    expect(topics[0].items[0].kind).toBe('formula');
  });

  it('exports numbered topics and skips hidden items / topics', () => {
    const md = payloadToMarkdown(legacy, { hiddenItemIds: new Set(['d1']), hiddenTopicIds: new Set(), focusLabel: '重点' });
    expect(md).not.toContain('核心定义');
    expect(md).toContain('## 1. 易错点');
    expect(md).toContain('**沉没成本 [重点]**');
  });

  it('formats clocks as MM:SS', () => {
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(undefined)).toBe('');
  });
});
