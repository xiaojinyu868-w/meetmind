import type {
  CheatsheetItem,
  CheatsheetPayload,
  CheatsheetSection,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';

export type CheatsheetPaperSize = 'a4' | 'letter';
export type CheatsheetOrientation = 'landscape' | 'portrait';
export type CheatsheetFontScale = 'compact' | 'standard' | 'comfortable';
export type CheatsheetPrintSides = 'single' | 'duplex';
export type CheatsheetPurpose = 'review' | 'open-book';
export type CheatsheetColorMode = 'color' | 'mono';
export type CheatsheetColumnCount = 1 | 2 | 3 | 4;

export interface CheatsheetPrintSettings {
  paperSize: CheatsheetPaperSize;
  orientation: CheatsheetOrientation;
  fontScale: CheatsheetFontScale;
  sides: CheatsheetPrintSides;
  purpose: CheatsheetPurpose;
  colorMode: CheatsheetColorMode;
  columnCount: CheatsheetColumnCount;
  sheetCount: 1 | 2 | 3;
}

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

export const REVIEW_PRINT_SETTINGS: CheatsheetPrintSettings = {
  paperSize: 'a4',
  orientation: 'portrait',
  fontScale: 'standard',
  sides: 'single',
  purpose: 'review',
  colorMode: 'color',
  columnCount: 2,
  sheetCount: 2,
};

export const OPEN_BOOK_PRINT_SETTINGS: CheatsheetPrintSettings = {
  paperSize: 'a4',
  orientation: 'landscape',
  fontScale: 'compact',
  sides: 'duplex',
  purpose: 'open-book',
  colorMode: 'color',
  columnCount: 4,
  sheetCount: 1,
};

export function settingsForPurpose(purpose: CheatsheetPurpose): CheatsheetPrintSettings {
  return purpose === 'open-book' ? { ...OPEN_BOOK_PRINT_SETTINGS } : { ...REVIEW_PRINT_SETTINGS };
}

export function targetPageCount(settings: CheatsheetPrintSettings): number {
  return settings.sheetCount * (settings.sides === 'duplex' ? 2 : 1);
}

export function pageCapacity(settings: CheatsheetPrintSettings): number {
  const orientationCapacity = settings.orientation === 'landscape' ? 46 : 28;
  const baselineColumns = settings.orientation === 'landscape' ? 3 : 2;
  const columnMultiplier = settings.columnCount / baselineColumns;
  const fontMultiplier = settings.fontScale === 'compact'
    ? 1.34
    : settings.fontScale === 'comfortable'
      ? 0.74
      : 1;
  const paperMultiplier = settings.paperSize === 'letter' ? 0.95 : 1;
  return orientationCapacity * columnMultiplier * fontMultiplier * paperMultiplier;
}

function itemCost(item: CheatsheetItem): number {
  const bodyLengthCost = Math.max(0, Math.ceil(item.body.length / 64) - 1) * 0.35;
  const nonEmptyLines = item.body.split('\n').filter((line) => line.trim()).length;
  const markdownLineCost = Math.max(0, nonEmptyLines - 1) * 0.18;
  const tableRowCost = item.body.split('\n').filter((line) => /^\s*\|.+\|\s*$/.test(line)).length * 0.28;
  const chartCost = /```mermaid[\s\S]*?```/i.test(item.body) ? 4.5 : 0;
  return 1 + (item.latex ? 0.65 : 0) + bodyLengthCost + markdownLineCost + tableRowCost + chartCost;
}

/**
 * 按真实纸面容量拆分区块。区块可以跨页，但每页都保留区块名，保证打印后散页仍可读。
 */
export function paginateCheatsheetSections(
  sections: CheatsheetSection[],
  settings: CheatsheetPrintSettings,
): CheatsheetPage[] {
  const capacity = Math.max(4, pageCapacity(settings));
  const columnCapacity = capacity / settings.columnCount;
  const pages: CheatsheetPage[] = [];
  let current: CheatsheetPage = { id: 'page-1', sections: [], columns: [], cost: 0 };
  let currentColumn: CheatsheetColumn | null = null;

  const flush = () => {
    if (current.sections.length === 0) return;
    pages.push(current);
    current = { id: `page-${pages.length + 1}`, sections: [], columns: [], cost: 0 };
    currentColumn = null;
  };

  const ensureColumn = (): CheatsheetColumn => {
    if (currentColumn) return currentColumn;
    currentColumn = {
      id: `${current.id}-column-${current.columns.length + 1}`,
      sections: [],
      cost: 0,
    };
    current.columns.push(currentColumn);
    return currentColumn;
  };

  const advanceColumn = () => {
    currentColumn = null;
    if (current.columns.length >= settings.columnCount) flush();
  };

  sections.forEach((section) => {
    let currentSection: CheatsheetSection | null = null;
    section.items.forEach((item) => {
      const cost = itemCost(item);
      const headerCost = currentSection ? 0 : 0.8;
      const column = ensureColumn();
      if (column.cost > 0 && column.cost + headerCost + cost > columnCapacity) {
        advanceColumn();
        currentSection = null;
      }
      if (!currentSection) {
        currentSection = { ...section, items: [] };
        ensureColumn().sections.push(currentSection);
        current.sections.push(currentSection);
        ensureColumn().cost += 0.8;
        current.cost += 0.8;
      }
      currentSection.items.push(item);
      ensureColumn().cost += cost;
      current.cost += cost;
    });
  });
  flush();
  return pages;
}

/**
 * 在不删除内容、不改变纸张数量的前提下，优先保住可读字号，再增加列数。
 * 若最紧凑组合仍超页，也返回该组合，让 UI 继续明确提示需要人工取舍。
 */
export function fitCheatsheetToTarget(
  sections: CheatsheetSection[],
  settings: CheatsheetPrintSettings,
): CheatsheetPrintSettings {
  const fontScales: CheatsheetFontScale[] = ['comfortable', 'standard', 'compact'];
  const columns: CheatsheetColumnCount[] = settings.orientation === 'landscape' ? [3, 4] : [2, 3];
  const candidates = fontScales.flatMap((fontScale) => columns.map((columnCount) => ({
    ...settings,
    fontScale,
    columnCount,
  })));
  return candidates.find((candidate) => (
    paginateCheatsheetSections(sections, candidate).length <= targetPageCount(candidate)
  )) ?? candidates[candidates.length - 1];
}

export function citationLabel(item: CheatsheetItem): string | null {
  if (!item.citation) return null;
  if (item.citation.sourceKind && item.citation.sourceKind !== 'lesson') {
    return item.citation.sourceTitle || null;
  }
  const ms = item.citation.sourceStartMs ?? item.citation.startMs;
  const total = Math.max(0, Math.floor(ms / 1000));
  const time = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  return item.citation.sourceTitle ? `${item.citation.sourceTitle} · ${time}` : time;
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
  payload.sections.forEach((section) => {
    if (options.collapsedSections.has(section.key)) return;
    const visibleItems = section.items.filter((item) => !options.hiddenItemIds.has(item.id));
    if (visibleItems.length === 0) return;
    lines.push(`## ${section.label}`, '');
    visibleItems.forEach((item) => {
      const focus = item.emphasis === 'strong' ? ` [${options.focusLabel}]` : '';
      const citation = citationLabel(item);
      lines.push(`- **${item.term}${focus}** — ${item.body}${citation ? ` _(${citation})_` : ''}`);
      if (item.latex) lines.push(`  $$${item.latex}$$`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}
