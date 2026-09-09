'use client';

/**
 * 速查表实测分页 hook。
 *
 * 流程：窗口把全部块（主题标题 / 条目）在一个隐藏的量高容器里按真实栏宽、真实字号渲染一遍
 * → 这里读每个块的高度 → `paginateMeasuredBlocks` 装栏装页 → 返回 pages 给纸面渲染。
 * 「装进一页」：装不进就按 sqrt(容量 / 总高) 缩字号再量，最多迭代几轮；内容变了先回到原字号再压。
 * KaTeX 同步、Mermaid 异步、字体后到——量高容器上挂 ResizeObserver，尺寸一变就重量。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CheatsheetTopic } from '@/lib/ai-native/plugins/cheatsheet.plugin';
import {
  CHEATSHEET_FIT_MIN_FONT_PX,
  CHEATSHEET_PAGE,
  cheatsheetColumnCapacity,
  cheatsheetColumnWidth,
  fitScaleFor,
  paginateMeasuredBlocks,
  type CheatsheetLayoutPrefs,
  type LayoutBlock,
  type PaginatedPage,
} from './cheatsheet-window-model';

const MAX_FIT_ITERATIONS = 6;

export interface CheatsheetLayoutState {
  pages: PaginatedPage[];
  /** 逻辑页高（px）：单页装不满时裁短，见 shortSheetHeight */
  pageHeight: number;
  /** 压缩后的实际正文字号（逻辑 px） */
  effectiveFontPx: number;
  /** 栏宽（逻辑 px），量高容器与页内栏一致 */
  columnWidth: number;
  measurerRef: (node: HTMLDivElement | null) => void;
  /** 量高完成前 pages 为空且 ready=false；避免闪一帧空纸 */
  ready: boolean;
}

/** 块顺序：每个主题一个标题块 + 它的条目块 */
export function blockOrderOf(topics: CheatsheetTopic[]): Array<Pick<LayoutBlock, 'id' | 'kind' | 'topicId'>> {
  return topics.flatMap((topic) => [
    { id: `heading:${topic.id}`, kind: 'heading' as const, topicId: topic.id },
    ...topic.items.map((item) => ({ id: `item:${item.id}`, kind: 'item' as const, topicId: topic.id })),
  ]);
}

/**
 * 只有一页且装不满时，纸按内容裁短（保底半张 A4）：屏幕上半页空白像半成品，
 * 而一张短一点的“便签纸”读起来是完整的。多页照旧整张 A4；打印永远 A4（@page）。
 */
function shortSheetHeight(pages: PaginatedPage[], firstPageCapacity: number): number {
  if (pages.length !== 1) return CHEATSHEET_PAGE.height;
  const tallest = Math.max(0, ...pages[0].columns.map((column) => column.height));
  const slack = firstPageCapacity - tallest;
  if (slack < firstPageCapacity * 0.2) return CHEATSHEET_PAGE.height;
  return Math.max(Math.round(CHEATSHEET_PAGE.height * 0.5), Math.round(CHEATSHEET_PAGE.height - slack + 16));
}

export function useCheatsheetLayout(
  topics: CheatsheetTopic[],
  prefs: CheatsheetLayoutPrefs,
  enabled: boolean,
): CheatsheetLayoutState {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [pages, setPages] = useState<PaginatedPage[]>([]);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [pageHeight, setPageHeight] = useState<number>(CHEATSHEET_PAGE.height);
  const [measureTick, setMeasureTick] = useState(0);
  const iterationsRef = useRef(0);

  const order = useMemo(() => blockOrderOf(topics), [topics]);
  const contentKey = useMemo(
    () => `${order.map((block) => block.id).join('|')}::${prefs.columns}:${prefs.fontPx}:${prefs.density}:${prefs.fitOnePage}`,
    [order, prefs.columns, prefs.fontPx, prefs.density, prefs.fitOnePage],
  );

  // 内容 / 版式一变，先回到原字号再决定要不要压
  useEffect(() => {
    setScale(1);
    iterationsRef.current = 0;
  }, [contentKey]);

  const effectiveFontPx = Math.max(CHEATSHEET_FIT_MIN_FONT_PX, Math.round(prefs.fontPx * scale * 10) / 10);
  const columnWidth = cheatsheetColumnWidth(prefs.columns);

  const measurerRef = useCallback((next: HTMLDivElement | null) => setNode(next), []);

  useEffect(() => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setMeasureTick((tick) => tick + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    let cancelled = false;
    void document.fonts.ready.then(() => { if (!cancelled) setMeasureTick((tick) => tick + 1); });
    return () => { cancelled = true; };
  }, []);

  useLayoutEffect(() => {
    if (!enabled || !node) return;
    const heights = new Map<string, number>();
    node.querySelectorAll<HTMLElement>('[data-block-id]').forEach((element) => {
      heights.set(element.dataset.blockId ?? '', element.getBoundingClientRect().height);
    });
    const firstHead = node.querySelector<HTMLElement>('[data-measure="first-head"]')?.getBoundingClientRect().height ?? 0;
    const runningHead = node.querySelector<HTMLElement>('[data-measure="running-head"]')?.getBoundingClientRect().height ?? 0;
    const blocks: LayoutBlock[] = order.map((block) => ({ ...block, height: heights.get(block.id) ?? 0 }));
    if (blocks.some((block) => block.height === 0) && blocks.length > 0) {
      // 还没渲染完（首帧 / 字体切换中）：等 ResizeObserver 再来
      return;
    }
    const firstPageCapacity = cheatsheetColumnCapacity(firstHead);
    const pageCapacity = cheatsheetColumnCapacity(runningHead);
    const nextPages = paginateMeasuredBlocks(blocks, { columns: prefs.columns, firstPageCapacity, pageCapacity });
    setPages(nextPages);
    setPageHeight(shortSheetHeight(nextPages, firstPageCapacity));
    setReady(true);

    if (prefs.fitOnePage && nextPages.length > 1 && effectiveFontPx > CHEATSHEET_FIT_MIN_FONT_PX && iterationsRef.current < MAX_FIT_ITERATIONS) {
      const total = blocks.reduce((sum, block) => sum + block.height, 0);
      const factor = fitScaleFor(total, firstPageCapacity * prefs.columns);
      if (factor < 0.995) {
        iterationsRef.current += 1;
        setScale((current) => Math.max(CHEATSHEET_FIT_MIN_FONT_PX / prefs.fontPx, current * factor));
      }
    }
  }, [enabled, node, order, prefs.columns, prefs.fitOnePage, prefs.fontPx, effectiveFontPx, measureTick, contentKey]);

  return { pages, pageHeight, effectiveFontPx, columnWidth, measurerRef, ready };
}
