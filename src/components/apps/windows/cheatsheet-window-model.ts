import type {
  CheatsheetItem,
  CheatsheetPayload,
  CheatsheetSection,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';

export interface CheatsheetColumn {
  id: string;
  sections: CheatsheetSection[];
  cost: number;
}

export interface CheatsheetPage {
  id: string;
  sections: CheatsheetSection[];
  columns: CheatsheetColumn[];
  cost: number;
}

/**
 * 速查表只有一种形态：A4 纵向 3 栏衬线密排（学术 cheat sheet 传统）。
 * 密度恒定——内容少就留白，绝不通过放大字号或拉松行距把少量内容铺满页面。
 */
export const CHEATSHEET_COLUMN_COUNT = 3;

/** A4 纵向 3 栏、10.5px 衬线行高的单页条目容量（按真实渲染校准）。 */
const PAGE_CAPACITY = 56;

function itemCost(item: CheatsheetItem): number {
  const bodyLengthCost = Math.max(0, Math.ceil(item.body.length / 64) - 1) * 0.35;
  const nonEmptyLines = item.body.split('\n').filter((line) => line.trim()).length;
  const markdownLineCost = Math.max(0, nonEmptyLines - 1) * 0.18;
  const tableRowCost = item.body.split('\n').filter((line) => /^\s*\|.+\|\s*$/.test(line)).length * 0.28;
  const chartCost = /```mermaid[\s\S]*?```/i.test(item.body) ? 4.5 : 0;
  return 1 + (item.latex ? 0.65 : 0) + bodyLengthCost + markdownLineCost + tableRowCost + chartCost;
}

interface StreamEntry {
  section: CheatsheetSection;
  item: CheatsheetItem;
}

const SECTION_HEADER_COST = 0.8;

/**
 * 两遍分页：
 *   1. 按页容量把条目流切成页（顺序保持）；
 *   2. 每页内按“均衡栏高”把条目装进 3 栏（顺序保持，像 LaTeX multicols 一样
 *      平衡各栏，而不是先灌满第一栏——否则短页会出现一栏满、一栏空的大片留白）。
 * 区块可以跨页 / 跨栏，但每栏都保留区块名，保证打印后散页仍可读。
 */
export function paginateCheatsheetSections(
  sections: CheatsheetSection[],
): CheatsheetPage[] {
  // ── 第一遍：切页
  const pageEntries: StreamEntry[][] = [];
  let entries: StreamEntry[] = [];
  let pageCost = 0;
  let lastSectionKey: string | null = null;
  const flushPage = () => {
    if (entries.length === 0) return;
    pageEntries.push(entries);
    entries = [];
    pageCost = 0;
    lastSectionKey = null;
  };
  sections.forEach((section) => {
    section.items.forEach((item) => {
      const headerCost = lastSectionKey === section.key ? 0 : SECTION_HEADER_COST;
      const cost = itemCost(item);
      if (pageCost > 0 && pageCost + headerCost + cost > PAGE_CAPACITY) {
        flushPage();
      }
      entries.push({ section, item });
      pageCost += (lastSectionKey === section.key ? 0 : SECTION_HEADER_COST) + cost;
      lastSectionKey = section.key;
    });
  });
  flushPage();

  // ── 第二遍：页内均衡装栏
  return pageEntries.map((pageStream, pageIndex) => {
    const totalCost = pageStream.reduce((sum, entry, index) => (
      sum + itemCost(entry.item) + (index === 0 || pageStream[index - 1].section.key !== entry.section.key ? SECTION_HEADER_COST : 0)
    ), 0);
    const targetColumnCost = Math.max(1, totalCost / CHEATSHEET_COLUMN_COUNT);

    const page: CheatsheetPage = { id: `page-${pageIndex + 1}`, sections: [], columns: [], cost: totalCost };
    let currentColumn: CheatsheetColumn | null = null;
    const ensureColumn = (): CheatsheetColumn => {
      if (currentColumn) return currentColumn;
      currentColumn = {
        id: `${page.id}-column-${page.columns.length + 1}`,
        sections: [],
        cost: 0,
      };
      page.columns.push(currentColumn);
      return currentColumn;
    };

    pageStream.forEach((entry) => {
      const column = ensureColumn();
      const cost = itemCost(entry.item);
      // 当前栏已达到均衡高度才换栏（贪婪法：栏满到 target 即停），最后一栏吸收余量
      if (
        column.cost > 0
        && column.cost >= targetColumnCost
        && page.columns.length < CHEATSHEET_COLUMN_COUNT
      ) {
        currentColumn = null;
      }
      const target = ensureColumn();
      let piece = target.sections[target.sections.length - 1];
      if (!piece || piece.key !== entry.section.key) {
        piece = { ...entry.section, items: [] };
        target.sections.push(piece);
        target.cost += SECTION_HEADER_COST;
      }
      piece.items.push(entry.item);
      target.cost += cost;
    });
    page.sections = page.columns.flatMap((column) => column.sections);
    return page;
  });
}

export function payloadToMarkdown(
  payload: CheatsheetPayload,
  options: {
    hiddenItemIds: ReadonlySet<string>;
    collapsedSections: ReadonlySet<string>;
    focusLabel: string;
  },
): string {
  const lines: string[] = [`# ${payload.title}`, '', `> ${payload.overview}`, ''];
  if (payload.sources && payload.sources.length > 0) {
    lines.push(`> 来源：${payload.sources.map((source) => source.title).join(' · ')}`, '');
  }
  payload.sections.forEach((section) => {
    if (options.collapsedSections.has(section.key)) return;
    const visibleItems = section.items.filter((item) => !options.hiddenItemIds.has(item.id));
    if (visibleItems.length === 0) return;
    lines.push(`## ${section.label}`, '');
    visibleItems.forEach((item) => {
      const focus = item.emphasis === 'strong' ? ` [${options.focusLabel}]` : '';
      lines.push(`- **${item.term}${focus}** — ${item.body}`);
      if (item.latex) lines.push(`  $$${item.latex}$$`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}
