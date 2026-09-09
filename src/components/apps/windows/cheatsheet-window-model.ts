import type {
  CheatsheetItem,
  CheatsheetPayload,
  CheatsheetSectionKey,
  CheatsheetTopic,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';

/**
 * 速查表纸面模型（纯函数，可单测）。
 *
 * 2026-09-09 起纸面是「一张 A4 逻辑页 + 实测分栏分页」：
 *   - 逻辑页固定 794 × 1123 px（A4 @ 96dpi），屏幕上整页等比缩放，打印时 1:1——屏幕看到的就是打印出来的；
 *   - 分页不再靠字数估算的容量系数，而是把每个块（主题标题 / 条目）在真实栏宽、真实字号下渲染一次量高度，
 *     再按像素装栏、装页。字号 / 栏数 / 密度一变就重量重装，结果是精确的；
 *   - 「装进一页」= 按 总高 / 单页容量 反推字号缩放，迭代到装下为止。
 */

/* ------------------------------------------------------------------ */
/*  版式偏好                                                            */
/* ------------------------------------------------------------------ */

export type CheatsheetColumns = 1 | 2 | 3 | 4;
export type CheatsheetDensity = 'tight' | 'normal' | 'loose';

export interface CheatsheetLayoutPrefs {
  columns: CheatsheetColumns;
  /** 逻辑页上的正文字号（px）。打印时 794px = 210mm，10px ≈ 7.5pt */
  fontPx: number;
  density: CheatsheetDensity;
  /** 三色荧光笔（黄 = 定义 / 术语，绿 = 公式 / 结论，朱红 = 易错）整体开关 */
  highlight: boolean;
  /** 自动压到一页 A4（开卷考试带一张纸） */
  fitOnePage: boolean;
}

/** 偏好 key（localStorage）——记在 windows/DOMAIN.md 的偏好表里 */
export const CHEATSHEET_LAYOUT_PREF_KEY = 'meetmind:cheatsheet:layout';

export const DEFAULT_CHEATSHEET_LAYOUT: CheatsheetLayoutPrefs = {
  columns: 3,
  fontPx: 10,
  density: 'normal',
  highlight: true,
  fitOnePage: false,
};

export const CHEATSHEET_FONT_RANGE = { min: 7, max: 14, step: 0.5 } as const;
/** 「装进一页」允许压到的最小字号：再小打印出来就读不了了 */
export const CHEATSHEET_FIT_MIN_FONT_PX = 6;

export interface DensityPreset {
  lineHeight: number;
  /** 条目间距（em） */
  itemGap: number;
  /** 主题之间的间距（em） */
  topicGap: number;
}

export const CHEATSHEET_DENSITY_PRESETS: Record<CheatsheetDensity, DensityPreset> = {
  tight: { lineHeight: 1.28, itemGap: 0.12, topicGap: 0.7 },
  normal: { lineHeight: 1.4, itemGap: 0.28, topicGap: 1 },
  loose: { lineHeight: 1.55, itemGap: 0.5, topicGap: 1.35 },
};

export function isCheatsheetColumns(value: unknown): value is CheatsheetColumns {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function normalizeLayoutPrefs(raw: unknown): CheatsheetLayoutPrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CheatsheetLayoutPrefs, unknown>>;
  const fontPx = typeof value.fontPx === 'number' && Number.isFinite(value.fontPx)
    ? Math.min(CHEATSHEET_FONT_RANGE.max, Math.max(CHEATSHEET_FONT_RANGE.min, value.fontPx))
    : DEFAULT_CHEATSHEET_LAYOUT.fontPx;
  return {
    columns: isCheatsheetColumns(value.columns) ? value.columns : DEFAULT_CHEATSHEET_LAYOUT.columns,
    fontPx,
    density: value.density === 'tight' || value.density === 'loose' || value.density === 'normal'
      ? value.density
      : DEFAULT_CHEATSHEET_LAYOUT.density,
    highlight: typeof value.highlight === 'boolean' ? value.highlight : DEFAULT_CHEATSHEET_LAYOUT.highlight,
    fitOnePage: typeof value.fitOnePage === 'boolean' ? value.fitOnePage : DEFAULT_CHEATSHEET_LAYOUT.fitOnePage,
  };
}

export function readLayoutPrefs(storage: Pick<Storage, 'getItem'> | undefined): CheatsheetLayoutPrefs {
  if (!storage) return DEFAULT_CHEATSHEET_LAYOUT;
  try {
    const raw = storage.getItem(CHEATSHEET_LAYOUT_PREF_KEY);
    return raw ? normalizeLayoutPrefs(JSON.parse(raw)) : DEFAULT_CHEATSHEET_LAYOUT;
  } catch {
    return DEFAULT_CHEATSHEET_LAYOUT;
  }
}

export function writeLayoutPrefs(storage: Pick<Storage, 'setItem'> | undefined, prefs: CheatsheetLayoutPrefs): void {
  if (!storage) return;
  try {
    storage.setItem(CHEATSHEET_LAYOUT_PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* 配额满了就算了：偏好丢失不影响纸面 */
  }
}

/* ------------------------------------------------------------------ */
/*  逻辑页几何                                                          */
/* ------------------------------------------------------------------ */

/** A4 纵向 @ 96dpi；打印 @page 用 A4 且边距 0，页内 padding 就是纸边距（≈ 9mm） */
export const CHEATSHEET_PAGE = {
  width: 794,
  height: 1123,
  padX: 34,
  padTop: 30,
  padBottom: 28,
  /** 栏间距（含 0.5px 栏线） */
  columnGap: 16,
  /** 页脚一行（来源 · 页码）占用的高度 */
  footerHeight: 22,
} as const;

/** 窄于这个宽度的容器不做 A4 分页，改成手机阅读用的单栏长文 */
export const CHEATSHEET_FLOW_MAX_WIDTH = 640;

export function cheatsheetColumnWidth(columns: CheatsheetColumns): number {
  const content = CHEATSHEET_PAGE.width - CHEATSHEET_PAGE.padX * 2;
  return Math.floor((content - (columns - 1) * CHEATSHEET_PAGE.columnGap) / columns);
}

/** 每栏可用高度：首页要扣掉标题区（实测传入），后续页扣掉页眉（实测传入） */
export function cheatsheetColumnCapacity(headerHeight: number): number {
  return Math.max(
    120,
    CHEATSHEET_PAGE.height - CHEATSHEET_PAGE.padTop - CHEATSHEET_PAGE.padBottom - CHEATSHEET_PAGE.footerHeight - headerHeight,
  );
}

/* ------------------------------------------------------------------ */
/*  主题视图（新旧结果同一入口）                                         */
/* ------------------------------------------------------------------ */

/**
 * 窗口渲染用的主题列表：v2 结果直接用 topics；v1 结果把每个知识类型区块当成一个主题，
 * 条目 kind 缺省按区块 key 补上——旧缓存照旧能渲染，只是章节按类型而非按考试主题。
 */
export function topicsOf(payload: CheatsheetPayload): CheatsheetTopic[] {
  if (Array.isArray(payload.topics) && payload.topics.length > 0) {
    return payload.topics.map((topic) => ({
      ...topic,
      items: topic.items.map((item) => ({ ...item, kind: item.kind ?? 'definition' })),
    }));
  }
  return (payload.sections ?? []).map((section) => ({
    id: `section:${section.key}`,
    title: section.label,
    items: section.items.map((item) => ({ ...item, kind: item.kind ?? section.key })),
  }));
}

export function itemKindOf(item: CheatsheetItem): CheatsheetSectionKey {
  return item.kind ?? 'definition';
}

/* ------------------------------------------------------------------ */
/*  实测分栏分页                                                        */
/* ------------------------------------------------------------------ */

export interface LayoutBlock {
  id: string;
  kind: 'heading' | 'item';
  topicId: string;
  /** 实测高度（逻辑 px，含块自身的下间距） */
  height: number;
}

export interface PaginatedColumn {
  blocks: LayoutBlock[];
  height: number;
}

export interface PaginatedPage {
  columns: PaginatedColumn[];
}

export interface PaginateOptions {
  columns: CheatsheetColumns;
  /** 首页每栏可用高度（扣掉标题区） */
  firstPageCapacity: number;
  /** 后续页每栏可用高度（扣掉页眉） */
  pageCapacity: number;
}

function greedyColumns(blocks: LayoutBlock[], capacity: number): PaginatedColumn[] {
  const columns: PaginatedColumn[] = [];
  let current: PaginatedColumn = { blocks: [], height: 0 };
  blocks.forEach((block, index) => {
    // 主题标题不能孤悬在栏底：它和第一条要一起装得下才留在本栏
    const next = blocks[index + 1];
    const need = block.kind === 'heading' && next && next.kind === 'item'
      ? block.height + next.height
      : block.height;
    if (current.height > 0 && current.height + need > capacity) {
      columns.push(current);
      current = { blocks: [], height: 0 };
    }
    current.blocks.push(block);
    current.height += block.height;
  });
  if (current.blocks.length > 0) columns.push(current);
  return columns;
}

/**
 * 均衡装栏：给定 N 栏，找一个最小的栏高阈值让内容正好装进 N 栏（像 LaTeX multicols 的 balance）。
 * 用在每页的最后一页——否则短页会是「第一栏满、后面全空」。
 */
function balancedColumns(blocks: LayoutBlock[], columns: number, hardCapacity: number): PaginatedColumn[] {
  const total = blocks.reduce((sum, block) => sum + block.height, 0);
  const tallest = blocks.reduce((max, block) => Math.max(max, block.height), 0);
  let capacity = Math.max(tallest, total / columns);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = greedyColumns(blocks, capacity);
    if (result.length <= columns || capacity >= hardCapacity) return result;
    capacity = Math.min(hardCapacity, capacity * 1.08);
  }
  return greedyColumns(blocks, hardCapacity);
}

/**
 * 两遍：先用满栏容量贪心装出「页 → 栏」，再把最后一页重新按均衡栏高装一遍。
 * 单个块比整栏还高（超长表格）时独占一栏并溢出——渲染层裁切，不丢内容。
 */
export function paginateMeasuredBlocks(blocks: LayoutBlock[], options: PaginateOptions): PaginatedPage[] {
  if (blocks.length === 0) return [];
  const pages: PaginatedPage[] = [];
  let remaining = blocks;
  while (remaining.length > 0) {
    const capacity = pages.length === 0 ? options.firstPageCapacity : options.pageCapacity;
    const columns = greedyColumns(remaining, capacity);
    if (columns.length <= options.columns) {
      // 最后一页：均衡栏高
      pages.push({ columns: balancedColumns(remaining, options.columns, capacity) });
      break;
    }
    const pageColumns = columns.slice(0, options.columns);
    pages.push({ columns: pageColumns });
    const placed = pageColumns.reduce((sum, column) => sum + column.blocks.length, 0);
    remaining = remaining.slice(placed);
  }
  return pages;
}

/**
 * 「装进一页」的字号缩放估算：字号缩 s，每行字数变 1/s、行高变 s，总高 ≈ s²·H。
 * 返回相对当前字号的乘数，调用方迭代重量收敛。
 */
export function fitScaleFor(totalHeight: number, capacity: number): number {
  if (totalHeight <= 0 || capacity <= 0) return 1;
  if (totalHeight <= capacity) return 1;
  return Math.sqrt(capacity / totalHeight) * 0.97;
}

/* ------------------------------------------------------------------ */
/*  导出与显示 helper                                                   */
/* ------------------------------------------------------------------ */

export function formatClock(ms: number | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function payloadToMarkdown(
  payload: CheatsheetPayload,
  options: {
    hiddenItemIds: ReadonlySet<string>;
    hiddenTopicIds: ReadonlySet<string>;
    focusLabel: string;
  },
): string {
  const lines: string[] = [`# ${payload.title}`, '', `> ${payload.overview}`, ''];
  if (payload.sources && payload.sources.length > 0) {
    lines.push(`> 来源：${payload.sources.map((source) => source.title).join(' · ')}`, '');
  }
  let number = 0;
  topicsOf(payload).forEach((topic) => {
    if (options.hiddenTopicIds.has(topic.id)) return;
    const visibleItems = topic.items.filter((item) => !options.hiddenItemIds.has(item.id));
    if (visibleItems.length === 0) return;
    number += 1;
    lines.push(`## ${number}. ${topic.title}`, '');
    visibleItems.forEach((item) => {
      const focus = item.emphasis === 'strong' ? ` [${options.focusLabel}]` : '';
      lines.push(`- **${item.term}${focus}** — ${item.body}`);
      if (item.latex) lines.push(`  $$${item.latex}$$`);
    });
    lines.push('');
  });
  return lines.join('\n').trim();
}
