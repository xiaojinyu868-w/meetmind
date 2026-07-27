'use client';

/**
 * CheatsheetWindow — 考试速查表。
 *
 * 形态只有一种，对齐学术 cheat sheet 传统（LaTeX 排印）：
 *   A4 纵向 · 3 栏 · 正文衬线密排 · 藏青小型大写区块题 · 居中展示公式。
 * 默认黑白 + 荧光笔高亮（黄色马克笔划重点的样子，黑白打印成立）；
 * 彩色语义引导词（粉=定义 / 藏青=公式 / 青=流程 / 紫=对比 / 红=易错 / 绿=例题）是唯一可选开关。
 * 没有其他排版选项——密度恒定，内容少就留白，绝不把少量内容拉松铺满页面。
 * 学生仍然可以在纸面上改、删、收起条目（这是内容编辑，不是排版选择）。
 */

import { useCallback, useMemo, useState } from 'react';
import { Printer, Copy, Check, ChevronDown, ChevronRight, X, PencilLine, MoreHorizontal } from 'lucide-react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { CheatsheetRichText } from '@/components/apps/windows/CheatsheetRichText';
import { COPY } from '@/lib/ui/copy';
import type {
  CheatsheetItem,
  CheatsheetPayload,
  CheatsheetSection,
  CheatsheetSectionKey,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';
import {
  CHEATSHEET_COLUMN_COUNT,
  paginateCheatsheetSections,
  payloadToMarkdown,
} from './cheatsheet-window-model';

interface CheatsheetWindowProps {
  result: AppExecutionResult | null;
  /** 保留在 props 契约里与 AppRenderSurface 对齐；速查表是纸面优先产物，条目不挂时间回跳。 */
  onSeek?: (ms: number) => void;
}

/**
 * 区块语义色：低饱和学术色板（对齐经典 LaTeX cheat sheet 的
 * 粉=定义 / 藏青=公式 / 青=流程 / 紫=对比 / 红=易错 / 绿=例题）。
 * 只在速查表使用，不进全局 token。
 */
const SECTION_ACCENTS: Record<CheatsheetSectionKey, string> = {
  definition: '#B0306E',
  formula: '#1F3A5F',
  process: '#0E6655',
  contrast: '#6C3483',
  pitfall: '#B03A2E',
  exemplar: '#1E7A4F',
};

/** 彩色模式的区块题色（藏青）；黑白模式全部落回墨色 */
const HEADER_NAVY = '#1F3A5F';
const INK = '#20312A';

function extractPayload(result: AppExecutionResult | null): CheatsheetPayload | null {
  const payload = result?.render?.payload as Partial<CheatsheetPayload> | undefined;
  if (!payload) return null;
  if (!Array.isArray(payload.sections)) return null;
  if (typeof payload.title !== 'string') return null;
  return payload as CheatsheetPayload;
}

function ItemRow({
  item,
  accent,
  onHide,
  onEdit,
}: {
  item: CheatsheetItem;
  accent: string;
  onHide: () => void;
  onEdit: (next: Pick<CheatsheetItem, 'term' | 'body' | 'latex'>) => void;
}) {
  const isStrong = item.emphasis === 'strong';
  // 单行正文 → 引导词与解释同段（cheat sheet 的经典密排）；
  // 含列表 / 表格 / 图的条目仍用上下结构，保证块级内容可读。
  const isCompact = !/[\n\r]/.test(item.body) && !/^\s*(\||[-*+] |\d+\. |```|> )/m.test(item.body);
  const [editing, setEditing] = useState(false);
  const [draftTerm, setDraftTerm] = useState(item.term);
  const [draftBody, setDraftBody] = useState(item.body);
  const [draftLatex, setDraftLatex] = useState(item.latex || '');
  const [actionsOpen, setActionsOpen] = useState(false);

  const beginEdit = () => {
    setDraftTerm(item.term);
    setDraftBody(item.body);
    setDraftLatex(item.latex || '');
    setActionsOpen(false);
    setEditing(true);
  };

  // strong 条目用荧光笔高亮术语——像学生拿黄色马克笔划出来的，黑白打印也成立
  const termNode = (
    <strong className="cs-term" style={{ color: accent }}>
      {isStrong ? (
        <mark className="cs-hl" title={COPY.apps.cheatsheet.focusTitle} aria-label={COPY.apps.cheatsheet.focusTitle}>
          {item.term}
        </mark>
      ) : item.term}
    </strong>
  );

  return (
    <li className="cs-item group">
      {editing ? (
        <div className="print:hidden space-y-2 py-1">
          <input
            value={draftTerm}
            onChange={(event) => setDraftTerm(event.target.value)}
            aria-label={COPY.apps.cheatsheet.editTerm}
            className="w-full rounded-lg border border-divider bg-canvas px-2.5 py-2 text-[12px] font-semibold text-ink outline-none focus:border-pine/40"
          />
          <textarea
            value={draftBody}
            onChange={(event) => setDraftBody(event.target.value)}
            aria-label={COPY.apps.cheatsheet.editBody}
            rows={3}
            className="w-full resize-none rounded-lg border border-divider bg-canvas px-2.5 py-2 text-[11.5px] leading-5 text-ink outline-none focus:border-pine/40"
          />
          <input
            value={draftLatex}
            onChange={(event) => setDraftLatex(event.target.value)}
            aria-label={COPY.apps.cheatsheet.editFormula}
            className="w-full rounded-lg border border-divider bg-canvas px-2.5 py-2 font-mono text-[11px] text-ink outline-none focus:border-pine/40"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setEditing(false)} className="rounded-full px-3 py-1.5 text-[10.5px] text-ink-muted hover:bg-paper-warm">
              {COPY.apps.cheatsheet.cancelEdit}
            </button>
            <button
              type="button"
              disabled={!draftTerm.trim() || !draftBody.trim()}
              onClick={() => {
                onEdit({
                  term: draftTerm.trim(),
                  body: draftBody.trim(),
                  latex: draftLatex.trim() || undefined,
                });
                setEditing(false);
              }}
              className="rounded-full bg-pine px-3 py-1.5 text-[10.5px] font-medium text-white disabled:opacity-40"
            >
              {COPY.apps.cheatsheet.saveEdit}
            </button>
          </div>
        </div>
      ) : null}
      <div className={editing ? 'hidden print:block' : undefined}>
        {isCompact ? (
          <div className="cs-line">
            {termNode}
            {'　'}
            <span className="cheatsheet-inline-body">
              <CheatsheetRichText content={item.body} />
            </span>
          </div>
        ) : (
          <>
            <div className="cs-line">
              {termNode}
            </div>
            <div className="cs-bodyblock">
              <CheatsheetRichText content={item.body} />
            </div>
          </>
        )}
        {item.latex ? (
          <div className="cs-formula">
            <CheatsheetRichText content={`$$${item.latex}$$`} formulaOnly />
          </div>
        ) : null}
      </div>
      {/* 桌面端悬停出现；触屏端由下方显式菜单承接。 */}
      {!editing ? (
        <>
          <button
            type="button"
            onClick={beginEdit}
            className="print:hidden absolute right-7 top-0 hidden h-5 w-5 items-center justify-center rounded-full bg-white/85 text-ink-muted opacity-0 ring-[0.5px] ring-ink/[0.18] transition group-hover:opacity-100 hover:bg-white hover:text-pine hover:ring-pine/35 active:scale-90 sm:inline-flex"
            title={COPY.apps.cheatsheet.editItem}
            aria-label={COPY.apps.cheatsheet.editItem}
          >
            <PencilLine size={9.5} strokeWidth={2.1} />
          </button>
          <button
            type="button"
            onClick={onHide}
            className="print:hidden absolute right-1 top-0 hidden h-5 w-5 items-center justify-center rounded-full bg-white/85 text-ink-muted opacity-0 ring-[0.5px] ring-ink/[0.18] transition group-hover:opacity-100 hover:bg-white hover:text-vermilion hover:ring-vermilion/40 active:scale-90 sm:inline-flex"
            title={COPY.apps.cheatsheet.hideItem}
            aria-label={COPY.apps.cheatsheet.hideItem}
          >
            <X size={10} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            onClick={() => setActionsOpen((open) => !open)}
            className="print:hidden absolute right-0.5 top-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-muted transition active:bg-paper-warm sm:hidden"
            aria-expanded={actionsOpen}
            aria-label={COPY.apps.cheatsheet.itemActions}
          >
            <MoreHorizontal size={14} strokeWidth={1.9} aria-hidden />
          </button>
        </>
      ) : null}
      {actionsOpen ? (
        <div className="print:hidden mt-1.5 flex items-center justify-end gap-1.5 border-t border-divider/60 pt-1.5 sm:hidden">
          <button
            type="button"
            onClick={beginEdit}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-paper-warm px-3 text-[11px] font-medium text-ink-secondary"
          >
            <PencilLine size={11} strokeWidth={1.9} aria-hidden />
            {COPY.apps.cheatsheet.editShort}
          </button>
          <button
            type="button"
            onClick={() => {
              setActionsOpen(false);
              onHide();
            }}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-paper-warm px-3 text-[11px] font-medium text-vermilion"
          >
            <X size={11} strokeWidth={2} aria-hidden />
            {COPY.apps.cheatsheet.hideShort}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function SectionCard({
  section,
  hiddenItemIds,
  onHideItem,
  collapsed,
  onToggleCollapse,
  onEditItem,
  colorful,
}: {
  section: CheatsheetSection;
  hiddenItemIds: ReadonlySet<string>;
  onHideItem: (itemId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onEditItem: (itemId: string, next: Pick<CheatsheetItem, 'term' | 'body' | 'latex'>) => void;
  /** 彩色模式用语义色引导词；黑白模式全部墨色（荧光笔高亮不受影响） */
  colorful: boolean;
}) {
  const accent = colorful ? (SECTION_ACCENTS[section.key] ?? SECTION_ACCENTS.definition) : INK;
  const headerColor = colorful ? HEADER_NAVY : INK;
  const visibleItems = section.items.filter((it) => !hiddenItemIds.has(it.id));
  const strongCount = visibleItems.filter((i) => i.emphasis === 'strong').length;
  const hiddenCount = section.items.length - visibleItems.length;

  if (visibleItems.length === 0) {
    return (
      <section className="cs-section print:hidden">
        <header className="cs-sec-head">
          <h3 className="cs-sec-title" style={{ color: headerColor, opacity: 0.55 }}>{section.label}</h3>
          <span className="cs-sec-meta">{COPY.apps.cheatsheet.removedCount(hiddenCount)}</span>
        </header>
      </section>
    );
  }

  return (
    <section className="cs-section">
      <header className="cs-sec-head">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="print:hidden -ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-ink-muted/70 transition hover:text-ink"
          title={collapsed ? COPY.apps.cheatsheet.expand : COPY.apps.cheatsheet.collapse}
          aria-label={collapsed ? COPY.apps.cheatsheet.expand : COPY.apps.cheatsheet.collapse}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
        </button>
        <h3 className="cs-sec-title" style={{ color: headerColor }}>{section.label}</h3>
        <span className="cs-sec-meta print:hidden">
          {strongCount > 0 ? (
            <span style={{ color: colorful ? '#B03A2E' : 'inherit' }} title={COPY.apps.cheatsheet.focusCount(strongCount)}>
              {COPY.apps.cheatsheet.focusCount(strongCount)}
            </span>
          ) : null}
          {strongCount > 0 ? <span aria-hidden className="opacity-40"> · </span> : null}
          <span>{COPY.apps.cheatsheet.itemCount(visibleItems.length)}</span>
          {hiddenCount > 0 ? (
            <span className="opacity-50" title={COPY.apps.cheatsheet.removedTitle(hiddenCount)}>
              /-{hiddenCount}
            </span>
          ) : null}
        </span>
      </header>
      {collapsed ? (
        <p className="cs-collapsed print:hidden">
          {COPY.apps.cheatsheet.collapsedCount(visibleItems.length)}
        </p>
      ) : (
        <ul className="cs-items">
          {visibleItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              accent={accent}
              onHide={() => onHideItem(item.id)}
              onEdit={(next) => onEditItem(item.id, next)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function CheatsheetWindow({ result }: CheatsheetWindowProps) {
  const payload = extractPayload(result);

  // 轻编辑只属于当前产物，不写回长期学习上下文。
  const [colorMode, setColorMode] = useState<'mono' | 'color'>('mono');
  const colorful = colorMode === 'color';
  // 列表符 / 屏幕统计的强调色：彩色模式朱红，黑白模式墨色
  const markerColor = colorful ? '#B03A2E' : INK;
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [itemEdits, setItemEdits] = useState<Record<string, Pick<CheatsheetItem, 'term' | 'body' | 'latex'>>>({});
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');
  const editedPayload = useMemo<CheatsheetPayload | null>(() => {
    if (!payload) return null;
    return {
      ...payload,
      sections: payload.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => ({ ...item, ...itemEdits[item.id] })),
      })),
    };
  }, [itemEdits, payload]);

  const handleHideItem = useCallback((itemId: string) => {
    setHiddenItemIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  }, []);

  const handleEditItem = useCallback((
    itemId: string,
    next: Pick<CheatsheetItem, 'term' | 'body' | 'latex'>,
  ) => {
    setItemEdits((current) => ({ ...current, [itemId]: next }));
  }, []);

  const handleToggleCollapse = useCallback((sectionKey: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);

  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.print();
  }, []);

  const handleCopyMarkdown = useCallback(async () => {
    if (!editedPayload) return;
    const md = payloadToMarkdown(editedPayload, {
      hiddenItemIds,
      collapsedSections,
      focusLabel: COPY.apps.cheatsheet.focus,
    });
    try {
      await navigator.clipboard.writeText(md);
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopyState('done');
        window.setTimeout(() => setCopyState('idle'), 1800);
      } catch { /* swallow */ }
      document.body.removeChild(ta);
    }
  }, [editedPayload, hiddenItemIds, collapsedSections]);

  const visibleSections = useMemo(() => (editedPayload?.sections || [])
    .filter((section) => !collapsedSections.has(section.key))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !hiddenItemIds.has(item.id)),
    }))
    .filter((section) => section.items.length > 0), [collapsedSections, editedPayload, hiddenItemIds]);
  const pages = useMemo(() => paginateCheatsheetSections(visibleSections), [visibleSections]);
  const stats = useMemo(() => {
    if (!editedPayload) return null;
    const visibleItems = visibleSections.reduce((sum, section) => sum + section.items.length, 0);
    const strongCount = visibleSections.reduce(
      (sum, section) => sum + section.items.filter((item) => item.emphasis === 'strong').length,
      0,
    );
    const hiddenCount = editedPayload.sections.reduce((sum, section) => (
      sum + section.items.filter((item) => hiddenItemIds.has(item.id) || collapsedSections.has(section.key)).length
    ), 0);
    return {
      visibleSections: visibleSections.length,
      visibleItems,
      strongCount,
      hiddenCount,
      pageCount: pages.length,
    };
  }, [collapsedSections, editedPayload, hiddenItemIds, pages.length, visibleSections]);

  if (!payload) {
    return <AppWindowPlaceholder status="empty" appName={COPY.apps.cheatsheet.appName} description={COPY.apps.cheatsheet.emptyBody} />;
  }

  return (
    <div className="flex h-full flex-col bg-paper">
      {/* 顶部信息条：标题 + 统计 + 成品出口（复制 / 打印）。没有任何排版选项。 */}
      <div className="flex-shrink-0 border-b border-divider bg-canvas px-4 py-3.5 print:hidden sm:px-8">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.015em] text-ink">
              {payload.title}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">{payload.overview}</p>
            {stats ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-ink-muted/85">
                <span>
                  {COPY.apps.cheatsheet.sectionCount(stats.visibleSections, stats.visibleItems)}
                </span>
                {stats.strongCount > 0 ? (
                  <>
                    <span aria-hidden className="text-ink-muted/40">·</span>
                    <span className="inline-flex items-center" style={{ color: markerColor }}>
                      {COPY.apps.cheatsheet.focusCount(stats.strongCount)}
                    </span>
                  </>
                ) : null}
                <span aria-hidden className="text-ink-muted/40">·</span>
                <span>{COPY.apps.cheatsheet.pageTotal(stats.pageCount)}</span>
                {stats.hiddenCount > 0 ? (
                  <>
                    <span aria-hidden className="text-ink-muted/40">·</span>
                    <span className="text-ink-muted/70">{COPY.apps.cheatsheet.removedCount(stats.hiddenCount)}</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="hidden w-full flex-shrink-0 items-center gap-2 sm:flex sm:w-auto">
            {/* 唯一的呈现开关：黑白（荧光笔高亮）是默认，彩色语义引导词可选 */}
            <div className="inline-flex rounded-full bg-paper-warm p-[2px]">
              {(['mono', 'color'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setColorMode(mode)}
                  className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                    colorMode === mode ? 'bg-white text-ink ring-[0.5px] ring-divider' : 'text-ink-muted hover:text-ink'
                  }`}
                  aria-pressed={colorMode === mode}
                >
                  {mode === 'mono' ? COPY.apps.cheatsheet.mono : COPY.apps.cheatsheet.color}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex h-[28px] items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-ink ring-[0.5px] ring-ink/[0.18] transition hover:ring-ink/[0.4] active:scale-95"
              title={COPY.apps.cheatsheet.copyTitle}
            >
              {copyState === 'done' ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.8} />}
              {copyState === 'done' ? COPY.apps.cheatsheet.copied : COPY.apps.cheatsheet.copyMarkdown}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex h-[28px] items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-95"
              title={COPY.apps.cheatsheet.printTitle}
            >
              <Printer size={12} strokeWidth={1.8} />
              {COPY.apps.cheatsheet.print}
            </button>
          </div>
        </div>
      </div>

      {/* 真实分页预览：屏幕页界与打印页界共用同一份分配结果；内容少就留白。 */}
      <div className="flex-1 overflow-auto px-3 py-4 print:overflow-visible print:p-0 sm:px-6 sm:py-5">
        <div className="cheatsheet-pages mx-auto flex w-full max-w-[820px] flex-col gap-6 print:block">
          {pages.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-divider bg-white px-6 py-16 text-center text-[12.5px] text-ink-muted print:hidden">
              {COPY.apps.cheatsheet.allRemoved}
            </div>
          ) : pages.map((page, pageIndex) => (
            <article key={page.id} className="cs-sheet">
              {pageIndex === 0 ? (
                <header className="cs-title-head">
                  <h1>{payload.title}</h1>
                  <p className="cs-title-sub">{payload.overview}</p>
                  {payload.sources && payload.sources.length > 0 ? (
                    <p className="cs-title-src">
                      {COPY.apps.cheatsheet.sourcesLabel}：{payload.sources.map((source) => source.title).join(' · ')}
                    </p>
                  ) : null}
                </header>
              ) : (
                <header className="cs-running-head">
                  <span>{payload.title}</span>
                  <span className="tabular-nums">{COPY.apps.cheatsheet.pageNumber(pageIndex + 1, pages.length)}</span>
                </header>
              )}
              <div className="cs-grid">
                {Array.from({ length: CHEATSHEET_COLUMN_COUNT }, (_, columnIndex) => (
                  <div key={`${page.id}:column:${columnIndex}`} className="min-w-0">
                    {(page.columns[columnIndex]?.sections || []).map((section, sectionIndex) => (
                      <SectionCard
                        key={`${page.id}:${columnIndex}:${section.key}:${sectionIndex}`}
                        section={section}
                        hiddenItemIds={hiddenItemIds}
                        onHideItem={handleHideItem}
                        collapsed={false}
                        onToggleCollapse={() => handleToggleCollapse(section.key)}
                        onEditItem={handleEditItem}
                        colorful={colorful}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* 手机端长文档始终保留成品出口；分享仍在结果页顶栏。 */}
      <div className="print:hidden sticky bottom-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t border-divider bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl sm:hidden">
        <button
          type="button"
          onClick={handleCopyMarkdown}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-divider bg-white px-3 text-[11.5px] font-medium text-ink-secondary"
        >
          {copyState === 'done' ? <Check size={13} strokeWidth={2} aria-hidden /> : <Copy size={13} strokeWidth={1.8} aria-hidden />}
          {copyState === 'done' ? COPY.apps.cheatsheet.copied : COPY.apps.cheatsheet.mobileCopy}
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-ink px-4 text-[11.5px] font-medium text-white active:scale-[0.98]"
        >
          <Printer size={13} strokeWidth={1.8} aria-hidden />
          {COPY.apps.cheatsheet.mobilePrint}
        </button>
      </div>

      {/* 纸面排印：衬线、密排、学术 cheat sheet 传统；屏幕页界与打印页界同源。 */}
      <style jsx global>{`
        .cs-sheet {
          position: relative;
          aspect-ratio: 210 / 297;
          background: #ffffff;
          padding: 22px 24px 18px;
          box-shadow: 0 8px 28px rgba(32, 49, 42, 0.06);
          /* 正文用端正的正文衬线（Georgia / 宋体）；展示衬线只留给大标题，
             小字号下展示体的高对比笔画会让整页文字看起来歪斜 */
          font-family: Georgia, 'Nimbus Roman', 'Times New Roman', 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif;
          color: var(--mm-ink);
          font-size: 10.5px;
          line-height: 1.42;
          min-width: 680px;
        }
        .cs-title-head {
          margin-bottom: 8px;
          padding-bottom: 5px;
          border-bottom: 1.6px solid var(--mm-ink);
          text-align: center;
        }
        .cs-title-head h1 {
          font-family: 'Instrument Serif', 'Noto Serif SC', 'Songti SC', 'STSong', Georgia, serif;
          font-size: 19px;
          font-weight: 700;
          letter-spacing: 0.01em;
          line-height: 1.25;
        }
        .cs-title-sub {
          margin-top: 2px;
          font-size: 9.5px;
          font-style: italic;
          color: var(--mm-ink-secondary);
        }
        .cs-title-src {
          margin-top: 1px;
          font-size: 8px;
          color: var(--mm-ink-muted);
        }
        .cs-running-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 6px;
          padding-bottom: 3px;
          border-bottom: 0.8px solid rgba(32, 49, 42, 0.35);
          font-size: 8.5px;
          color: var(--mm-ink-muted);
        }
        .cs-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          column-gap: 16px;
          align-items: start;
        }
        .cs-section {
          break-inside: avoid;
          margin-bottom: 9px;
        }
        .cs-sec-head {
          display: flex;
          align-items: baseline;
          gap: 3px;
          margin-bottom: 3px;
        }
        .cs-sec-title {
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          font-variant-caps: small-caps;
        }
        .cs-sec-meta {
          margin-left: auto;
          font-family: var(--font-inter), sans-serif;
          font-size: 9px;
          color: var(--mm-ink-muted);
          white-space: nowrap;
        }
        .cs-collapsed {
          font-family: var(--font-inter), sans-serif;
          font-size: 9.5px;
          color: var(--mm-ink-muted);
        }
        .cs-items {
          display: flex;
          flex-direction: column;
          row-gap: 3px;
        }
        .cs-item {
          position: relative;
          break-inside: avoid;
        }
        .cs-line {
          text-align: justify;
          hyphens: auto;
        }
        .cs-term {
          font-weight: 700;
        }
        /* 荧光笔高亮：学生拿黄色马克笔划重点的样子；黑白打印呈浅灰，依然可读 */
        .cs-hl {
          background-color: rgba(255, 214, 64, 0.55);
          padding: 0 1px;
          border-radius: 1px;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .cs-bodyblock {
          text-align: justify;
        }
        .cs-formula {
          margin: 3px 0;
          text-align: center;
        }
        .cheatsheet-inline-body .cheatsheet-richtext {
          display: inline;
        }
        .cheatsheet-inline-body .cheatsheet-richtext p {
          display: inline;
          margin: 0;
        }
        /* 富文本在纸面里的排印：衬线、密行距、红色方块列表符、booktabs 表格 */
        .cs-sheet .cheatsheet-richtext {
          font-size: inherit;
          line-height: inherit;
          color: var(--mm-ink);
        }
        .cs-sheet .cheatsheet-richtext p {
          margin: 1px 0;
          line-height: 1.42;
          color: var(--mm-ink);
        }
        .cs-sheet .cheatsheet-richtext ul,
        .cs-sheet .cheatsheet-richtext ol {
          margin: 1px 0;
          padding-left: 12px;
        }
        .cs-sheet .cheatsheet-richtext ul {
          list-style: none;
        }
        .cs-sheet .cheatsheet-richtext ul > li {
          position: relative;
          padding-left: 2px;
        }
        .cs-sheet .cheatsheet-richtext ul > li::before {
          content: '';
          position: absolute;
          left: -9px;
          top: 0.42em;
          width: 4px;
          height: 4px;
          background: ${markerColor};
        }
        .cs-sheet .cheatsheet-richtext ol {
          list-style: decimal;
        }
        .cs-sheet .cheatsheet-richtext ol > li::marker {
          color: ${markerColor};
          font-weight: 700;
        }
        .cs-sheet .cheatsheet-richtext li {
          line-height: 1.4;
        }
        .cs-sheet .cheatsheet-richtext strong {
          color: var(--mm-ink);
        }
        .cs-sheet .cheatsheet-table-wrap {
          margin: 3px 0;
          overflow: visible;
        }
        .cs-sheet .cheatsheet-table-wrap table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9.5px;
          line-height: 1.35;
        }
        .cs-sheet .cheatsheet-table-wrap th {
          border-top: 1.4px solid var(--mm-ink);
          border-bottom: 0.8px solid var(--mm-ink);
          padding: 2px 4px;
          text-align: left;
          font-weight: 700;
        }
        .cs-sheet .cheatsheet-table-wrap td {
          border: 0;
          border-bottom: 0.5px solid rgba(32, 49, 42, 0.18);
          padding: 2px 4px;
          vertical-align: top;
        }
        .cs-sheet .cheatsheet-table-wrap tr:last-child td {
          border-bottom: 1.4px solid var(--mm-ink);
        }
        .cs-sheet .cheatsheet-richtext .katex-display {
          margin: 2px 0;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .cs-sheet .cheatsheet-mermaid {
          break-inside: avoid;
        }
        .cs-sheet .cheatsheet-mermaid .chat-mermaid-svg {
          padding: 2px;
        }
        .cs-sheet .cheatsheet-mermaid .chat-mermaid-svg svg {
          max-height: 150px;
          max-width: 100%;
        }
        @media print {
          .cheatsheet-pages {
            max-width: none !important;
          }
          .cs-sheet {
            break-after: page;
            box-sizing: border-box;
            min-width: 0 !important;
            min-height: 281mm;
            aspect-ratio: auto;
            padding: 0 !important;
            box-shadow: none !important;
          }
          .cs-sheet:last-child {
            break-after: auto;
          }
          .cs-grid {
            column-gap: 4mm;
          }
          @page {
            size: A4 portrait;
            margin: 9mm 10mm;
          }
          html,
          body {
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          aside,
          nav {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default CheatsheetWindow;
