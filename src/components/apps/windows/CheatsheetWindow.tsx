'use client';

/**
 * CheatsheetWindow — 跨课考试速查表的编辑与打印界面。
 *
 * 屏幕预览与打印共用同一套分页模型；学生可以按考试规则切换纸张、
 * 横纵向、单双面与页数，并在打印前删减、折叠或修正具体条目。
 */

import { useCallback, useMemo, useState } from 'react';
import { Printer, Copy, Check, ChevronDown, ChevronRight, X, RotateCcw, Settings2, PencilLine } from 'lucide-react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { CompanionMarkdown } from '@/components/classroom/CompanionMarkdown';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { COPY } from '@/lib/ui/copy';
import type {
  CheatsheetItem,
  CheatsheetPayload,
  CheatsheetSection,
  CheatsheetSectionKey,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';
import {
  REVIEW_PRINT_SETTINGS,
  citationLabel,
  paginateCheatsheetSections,
  payloadToMarkdown,
  settingsForPurpose,
  targetPageCount,
  type CheatsheetColorMode,
  type CheatsheetFontScale,
  type CheatsheetOrientation,
  type CheatsheetPaperSize,
  type CheatsheetPrintSides,
  type CheatsheetPrintSettings,
  type CheatsheetPurpose,
} from './cheatsheet-window-model';

interface CheatsheetWindowProps {
  result: AppExecutionResult | null;
  onSeek?: (ms: number) => void;
}

const SECTION_ACCENTS: Record<
  CheatsheetSectionKey,
  { borderColor: string; dot: string; label: string; strongTint: string }
> = {
  definition: { borderColor: '#1C1B19', dot: '#1C1B19', label: 'text-[#1C1B19]', strongTint: '#F2EDE3' },
  formula:    { borderColor: '#B8842B', dot: '#B8842B', label: 'text-[#2D4F3E]', strongTint: '#FBF2EF' },
  process:    { borderColor: '#2D4F3E', dot: '#2D4F3E', label: 'text-[#2D4F3E]', strongTint: '#F2F6F3' },
  contrast:   { borderColor: '#2D4F3E', dot: '#2D4F3E', label: 'text-[#2D4F3E]', strongTint: '#F2F6F3' },
  pitfall:    { borderColor: '#B5483C', dot: '#B5483C', label: 'text-[#B5483C]', strongTint: '#FCEFEF' },
  exemplar:   { borderColor: '#2D4F3E', dot: '#2D4F3E', label: 'text-[#2D4F3E]', strongTint: '#F2F6F3' },
};

/**
 * 字号档位 → CSS 变量。所有字号都从变量读，切换档位等于全表跟随。
 *
 * 紧凑模式给"考场带纸 + 内容多"的场景，term 11.5 / body 10.5 已是中文打印
 * 可读极限；舒适模式给"屏幕预览 / 内容少"，term 15 / body 13.5 看着舒服。
 */
const FONT_SCALES: Record<
  CheatsheetFontScale,
  { term: string; body: string; latex: string; ts: string; rowGap: string; itemPadY: string }
> = {
  compact:     { term: '11.5px', body: '10.5px', latex: '12px', ts: '9.5px',  rowGap: '0.125rem', itemPadY: '0.25rem' },
  standard:    { term: '13.5px', body: '12.25px', latex: '14px', ts: '10.5px', rowGap: '0.25rem',  itemPadY: '0.375rem' },
  comfortable: { term: '15px',   body: '13.5px',  latex: '16px', ts: '11.5px', rowGap: '0.375rem', itemPadY: '0.5rem' },
};

const FONT_SCALE_LABELS: Record<CheatsheetFontScale, string> = {
  compact: COPY.apps.cheatsheet.compact,
  standard: COPY.apps.cheatsheet.standard,
  comfortable: COPY.apps.cheatsheet.comfortable,
};

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
  onSeek,
  onHide,
  onEdit,
}: {
  item: CheatsheetItem;
  accent: (typeof SECTION_ACCENTS)[CheatsheetSectionKey];
  onSeek?: (ms: number) => void;
  onHide: () => void;
  onEdit: (next: Pick<CheatsheetItem, 'term' | 'body' | 'latex'>) => void;
}) {
  const isStrong = item.emphasis === 'strong';
  const citation = citationLabel(item);
  const [editing, setEditing] = useState(false);
  const [draftTerm, setDraftTerm] = useState(item.term);
  const [draftBody, setDraftBody] = useState(item.body);
  const [draftLatex, setDraftLatex] = useState(item.latex || '');

  const beginEdit = () => {
    setDraftTerm(item.term);
    setDraftBody(item.body);
    setDraftLatex(item.latex || '');
    setEditing(true);
  };

  return (
    <li
      className="group relative flex flex-col gap-1 rounded-md print:px-1 print:py-0.5"
      style={{
        backgroundColor: isStrong ? accent.strongTint : 'transparent',
        paddingInline: '0.5rem',
        paddingBlock: 'var(--cs-item-pad-y, 0.375rem)',
      }}
    >
      {editing ? (
        <div className="print:hidden space-y-2">
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
      <div className={`items-start gap-1.5 ${editing ? 'hidden print:flex' : 'flex'}`}>
        <span
          className="mt-[5px] inline-block h-[4px] w-[4px] flex-shrink-0 rounded-full"
          style={{ backgroundColor: isStrong ? accent.dot : 'rgba(0,0,0,0.45)' }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <strong
              className="font-semibold tracking-[-0.005em] text-ink"
              style={{ fontSize: 'var(--cs-term, 13.5px)' }}
            >
              {item.term}
            </strong>
            {isStrong ? (
              <span
                aria-label={COPY.apps.cheatsheet.focusTitle}
                title={COPY.apps.cheatsheet.focusTitle}
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: accent.dot }}
              />
            ) : null}
            {item.citation && citation && onSeek ? (
              <button
                type="button"
                onClick={() => onSeek(item.citation!.startMs)}
                className="print:hidden ml-auto inline-flex h-[22px] items-center rounded-full px-2 font-mono tabular-nums text-ink-secondary ring-[0.5px] ring-ink/[0.10] transition-all duration-150 hover:bg-pine/[0.10] hover:text-pine hover:ring-pine/30 active:scale-95"
                style={{ fontSize: 'var(--cs-ts, 10.5px)' }}
                title={COPY.apps.cheatsheet.seekTitle(citation)}
                aria-label={COPY.apps.cheatsheet.seekTitle(citation)}
              >
                {citation}
              </button>
            ) : item.citation && citation ? (
              <span
                className="ml-auto font-mono tabular-nums text-ink-muted/70"
                style={{ fontSize: 'var(--cs-ts, 10.5px)' }}
              >
                {citation}
              </span>
            ) : null}
            {/* 删除按钮：hover 才显，避免视觉污染；打印时不渲染 */}
            <button
              type="button"
              onClick={beginEdit}
              className="print:hidden absolute right-7 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-ink-muted opacity-0 ring-[0.5px] ring-[#1C1B19]/[0.18] transition group-hover:opacity-100 hover:bg-white hover:text-pine hover:ring-pine/35 active:scale-90"
              title={COPY.apps.cheatsheet.editItem}
              aria-label={COPY.apps.cheatsheet.editItem}
            >
              <PencilLine size={9.5} strokeWidth={2.1} />
            </button>
            <button
              type="button"
              onClick={onHide}
              className="print:hidden absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-ink-muted opacity-0 ring-[0.5px] ring-[#1C1B19]/[0.18] transition group-hover:opacity-100 hover:bg-white hover:text-[#B5483C] hover:ring-[#B5483C]/40 active:scale-90"
              title={COPY.apps.cheatsheet.hideItem}
              aria-label={COPY.apps.cheatsheet.hideItem}
            >
              <X size={10} strokeWidth={2.4} />
            </button>
          </div>
          <p
            className="mt-0.5 text-ink-secondary"
            style={{
              fontSize: 'var(--cs-body, 12.25px)',
              lineHeight: 1.55,
            }}
          >
            {item.body}
          </p>
          {item.latex ? (
            <div
              className="mt-1.5 rounded-md bg-paper-warm px-2.5 py-1.5 text-center"
              style={{
                borderLeft: `2px solid ${accent.borderColor}`,
                borderRight: `2px solid ${accent.borderColor}`,
              }}
            >
              <div style={{ fontSize: 'var(--cs-latex, 14px)', lineHeight: 1.2 }}>
                <CompanionMarkdown content={`$$${item.latex}$$`} />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function SectionCard({
  section,
  hiddenItemIds,
  onHideItem,
  collapsed,
  onToggleCollapse,
  onSeek,
  onEditItem,
}: {
  section: CheatsheetSection;
  hiddenItemIds: ReadonlySet<string>;
  onHideItem: (itemId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSeek?: (ms: number) => void;
  onEditItem: (itemId: string, next: Pick<CheatsheetItem, 'term' | 'body' | 'latex'>) => void;
}) {
  const accent = SECTION_ACCENTS[section.key] ?? SECTION_ACCENTS.definition;
  const visibleItems = section.items.filter((it) => !hiddenItemIds.has(it.id));
  const strongCount = visibleItems.filter((i) => i.emphasis === 'strong').length;
  const hiddenCount = section.items.length - visibleItems.length;

  // 折叠态 + 全部条目都被删 → 这个区块不渲染（折叠的还要打印保留？不，折叠就是"不带"）
  if (visibleItems.length === 0) {
    return (
      <section
        className="relative break-inside-avoid rounded-xl bg-white/40 px-4 py-2 print:hidden"
        style={{ borderLeft: `3px solid ${accent.borderColor}` }}
      >
        <header className="flex items-center gap-2 text-ink-muted/70">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent.dot }} />
          <h3 className={`text-[11.5px] font-semibold uppercase tracking-[0.16em] ${accent.label}/60`}>
            {section.label}
          </h3>
          <span className="ml-auto text-[10.5px] tabular-nums">
            {COPY.apps.cheatsheet.removedCount(hiddenCount)}
          </span>
        </header>
      </section>
    );
  }

  return (
    <section
      className="relative break-inside-avoid rounded-xl bg-white print:px-3 print:py-2"
      style={{
        borderLeft: `3px solid ${accent.borderColor}`,
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.04)',
        paddingInline: '1rem',
        paddingBlock: '0.875rem',
      }}
    >
      <header className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="print:hidden inline-flex h-5 w-5 items-center justify-center rounded text-ink-muted transition hover:bg-[#1C1B19]/[0.06] hover:text-ink"
          title={collapsed ? COPY.apps.cheatsheet.expand : COPY.apps.cheatsheet.collapse}
          aria-label={collapsed ? COPY.apps.cheatsheet.expand : COPY.apps.cheatsheet.collapse}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />}
        </button>
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent.dot }} />
        <h3 className={`text-[11.5px] font-semibold uppercase tracking-[0.16em] ${accent.label}`}>
          {section.label}
        </h3>
        <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] tabular-nums text-ink-muted/70">
          {strongCount > 0 ? (
            <span
              className="inline-flex items-center gap-0.5"
              style={{ color: accent.dot }}
              title={COPY.apps.cheatsheet.focusCount(strongCount)}
            >
              {COPY.apps.cheatsheet.focusCount(strongCount)}
            </span>
          ) : null}
          <span>{visibleItems.length}</span>
          {hiddenCount > 0 ? (
            <span className="text-ink-muted/50" title={COPY.apps.cheatsheet.removedTitle(hiddenCount)}>
              /-{hiddenCount}
            </span>
          ) : null}
        </span>
      </header>
      {collapsed ? (
        <p className="text-[10.5px] text-ink-muted/70 print:hidden">
          {COPY.apps.cheatsheet.collapsedCount(visibleItems.length)}
        </p>
      ) : (
        <ul className="flex flex-col" style={{ rowGap: 'var(--cs-row-gap, 0.25rem)' }}>
          {visibleItems.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              accent={accent}
              onSeek={onSeek}
              onHide={() => onHideItem(item.id)}
              onEdit={(next) => onEditItem(item.id, next)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SettingChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10.5px] text-ink-muted">{label}</p>
      <div className="inline-flex max-w-full rounded-full bg-paper-warm p-[2px]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              value === option.value ? 'bg-white text-ink ring-[0.5px] ring-divider' : 'text-ink-muted hover:text-ink'
            }`}
            aria-pressed={value === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CheatsheetWindow({ result, onSeek }: CheatsheetWindowProps) {
  const payload = extractPayload(result);

  // 轻编辑与打印约束只属于当前产物，不写回长期学习上下文。
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [itemEdits, setItemEdits] = useState<Record<string, Pick<CheatsheetItem, 'term' | 'body' | 'latex'>>>({});
  const [settings, setSettings] = useState<CheatsheetPrintSettings>({ ...REVIEW_PRINT_SETTINGS });
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const handleResetEdits = useCallback(() => {
    setHiddenItemIds(new Set());
    setCollapsedSections(new Set());
    setItemEdits({});
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
  const pages = useMemo(
    () => paginateCheatsheetSections(visibleSections, settings),
    [settings, visibleSections],
  );
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
      targetPages: targetPageCount(settings),
    };
  }, [collapsedSections, editedPayload, hiddenItemIds, pages.length, settings, visibleSections]);

  const fontVars = FONT_SCALES[settings.fontScale];
  const cssVars = {
    ['--cs-term' as string]: fontVars.term,
    ['--cs-body' as string]: fontVars.body,
    ['--cs-latex' as string]: fontVars.latex,
    ['--cs-ts' as string]: fontVars.ts,
    ['--cs-row-gap' as string]: fontVars.rowGap,
    ['--cs-item-pad-y' as string]: fontVars.itemPadY,
  };

  if (!payload) {
    return <AppWindowPlaceholder status="empty" appName={COPY.apps.cheatsheet.appName} description={COPY.apps.cheatsheet.emptyBody} />;
  }

  const isOverflow = Boolean(stats && stats.pageCount > stats.targetPages);
  const hasEdits = hiddenItemIds.size > 0 || collapsedSections.size > 0 || Object.keys(itemEdits).length > 0;

  return (
    <div className="flex h-full flex-col bg-[#FAF7F2]" style={cssVars as React.CSSProperties}>
      {/* 顶部信息条：标题 + 密度估算 + 编辑工具 + 主操作 */}
      <div className="flex-shrink-0 flex flex-col gap-2.5 border-b border-[#E8E2D5] bg-canvas px-4 py-3.5 print:hidden sm:px-8">
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
                    <span className="inline-flex items-center text-[#B8842B]">{COPY.apps.cheatsheet.focusCount(stats.strongCount)}</span>
                  </>
                ) : null}
                <span aria-hidden className="text-ink-muted/40">·</span>
                <span
                  className={isOverflow ? 'font-medium text-vermilion' : 'text-ink-muted'}
                >
                  {COPY.apps.cheatsheet.pageUsage(stats.pageCount, stats.targetPages)}
                </span>
                {stats.hiddenCount > 0 ? (
                  <>
                    <span aria-hidden className="text-ink-muted/40">·</span>
                    <span className="text-ink-muted/70">{COPY.apps.cheatsheet.removedCount(stats.hiddenCount)}</span>
                  </>
                ) : null}
              </div>
            ) : null}
            {isOverflow && stats ? (
              <p className="mt-1 text-[11px] leading-relaxed text-vermilion/85">
                {COPY.apps.cheatsheet.pageOverflow(stats.pageCount - stats.targetPages)}
              </p>
            ) : null}
          </div>
          <div className="flex w-full flex-shrink-0 items-center gap-2 sm:w-auto">
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              className="inline-flex h-[28px] items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-ink ring-[0.5px] ring-divider transition hover:ring-pine/35 active:scale-95"
              aria-expanded={settingsOpen}
              title={COPY.apps.cheatsheet.printLayout}
            >
              <Settings2 size={12} strokeWidth={1.8} />
              {COPY.apps.cheatsheet.settingSummary(settings)}
            </button>
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex h-[28px] items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-ink ring-[0.5px] ring-[#1C1B19]/[0.18] transition hover:ring-[#1C1B19]/[0.4] active:scale-95"
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

        {settingsOpen ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[18px] border border-divider bg-white p-3.5 sm:grid-cols-3 lg:grid-cols-6">
            <SettingChoice<CheatsheetPurpose>
              label={COPY.apps.cheatsheet.purpose}
              value={settings.purpose}
              options={[
                { value: 'review', label: COPY.apps.cheatsheet.reviewPurpose },
                { value: 'open-book', label: COPY.apps.cheatsheet.openBookPurpose },
              ]}
              onChange={(purpose) => setSettings(settingsForPurpose(purpose))}
            />
            <SettingChoice<CheatsheetPaperSize>
              label={COPY.apps.cheatsheet.paper}
              value={settings.paperSize}
              options={[
                { value: 'a4', label: COPY.apps.cheatsheet.paperA4 },
                { value: 'letter', label: COPY.apps.cheatsheet.paperLetter },
              ]}
              onChange={(paperSize) => setSettings((current) => ({ ...current, paperSize }))}
            />
            <SettingChoice<CheatsheetOrientation>
              label={COPY.apps.cheatsheet.orientation}
              value={settings.orientation}
              options={[
                { value: 'portrait', label: COPY.apps.cheatsheet.portrait },
                { value: 'landscape', label: COPY.apps.cheatsheet.landscape },
              ]}
              onChange={(orientation) => setSettings((current) => ({ ...current, orientation }))}
            />
            <SettingChoice<'1' | '2' | '3'>
              label={COPY.apps.cheatsheet.sheets}
              value={String(settings.sheetCount) as '1' | '2' | '3'}
              options={(['1', '2', '3'] as const).map((value) => ({ value, label: COPY.apps.cheatsheet.sheetCount(Number(value)) }))}
              onChange={(value) => setSettings((current) => ({ ...current, sheetCount: Number(value) as 1 | 2 | 3 }))}
            />
            <SettingChoice<CheatsheetPrintSides>
              label={COPY.apps.cheatsheet.sides}
              value={settings.sides}
              options={[
                { value: 'single', label: COPY.apps.cheatsheet.singleSided },
                { value: 'duplex', label: COPY.apps.cheatsheet.duplex },
              ]}
              onChange={(sides) => setSettings((current) => ({ ...current, sides }))}
            />
            <SettingChoice<CheatsheetFontScale>
              label={COPY.apps.cheatsheet.fontSize}
              value={settings.fontScale}
              options={(Object.keys(FONT_SCALE_LABELS) as CheatsheetFontScale[]).map((value) => ({ value, label: FONT_SCALE_LABELS[value] }))}
              onChange={(fontScale) => setSettings((current) => ({ ...current, fontScale }))}
            />
            <SettingChoice<CheatsheetColorMode>
              label={COPY.apps.cheatsheet.colorMode}
              value={settings.colorMode}
              options={[
                { value: 'color', label: COPY.apps.cheatsheet.color },
                { value: 'mono', label: COPY.apps.cheatsheet.mono },
              ]}
              onChange={(colorMode) => setSettings((current) => ({ ...current, colorMode }))}
            />
            {settings.sides === 'duplex' ? (
              <p className="col-span-2 self-end text-[10.5px] leading-5 text-ink-muted sm:col-span-2">
                {COPY.apps.cheatsheet.duplexHint}
              </p>
            ) : null}
            {hasEdits ? (
              <button
                type="button"
                onClick={handleResetEdits}
                className="col-span-2 inline-flex items-center justify-center gap-1 rounded-full border border-divider px-3 py-2 text-[11px] text-ink-muted hover:text-ink sm:col-span-1"
              >
                <RotateCcw size={11} strokeWidth={1.8} />{COPY.apps.cheatsheet.restore}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 真实分页预览：屏幕页界与打印页界共用同一份分配结果。 */}
      <div className="flex-1 overflow-y-auto px-3 py-4 print:overflow-visible print:p-0 sm:px-6 sm:py-5">
        <div
          className="mx-auto flex w-full flex-col gap-5 print:block"
          style={{ maxWidth: settings.orientation === 'landscape' ? '1120px' : '820px' }}
        >
          {pages.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-divider bg-white px-6 py-16 text-center text-[12.5px] text-ink-muted print:hidden">
              {COPY.apps.cheatsheet.allRemoved}
            </div>
          ) : pages.map((page, pageIndex) => (
            <article
              key={page.id}
              className={`cheatsheet-print-page flex flex-col bg-white p-4 sm:p-6 ${settings.colorMode === 'mono' ? 'cheatsheet-monochrome' : ''}`}
              style={{
                aspectRatio: settings.paperSize === 'a4'
                  ? (settings.orientation === 'portrait' ? '210 / 297' : '297 / 210')
                  : (settings.orientation === 'portrait' ? '8.5 / 11' : '11 / 8.5'),
              }}
            >
              <header className="print-keep mb-3 border-b border-divider/70 pb-2">
                <h1 className="text-[15px] font-semibold text-ink">{payload.title}</h1>
                <p className="mt-0.5 text-[9.5px] leading-4 text-ink-muted">{payload.overview}</p>
              </header>
              <div className="cheatsheet-content-grid grid flex-1 content-start gap-3 print:gap-2">
                {page.sections.map((section, sectionIndex) => (
                  <SectionCard
                    key={`${page.id}:${section.key}:${sectionIndex}`}
                    section={section}
                    hiddenItemIds={hiddenItemIds}
                    onHideItem={handleHideItem}
                    collapsed={false}
                    onToggleCollapse={() => handleToggleCollapse(section.key)}
                    onSeek={onSeek}
                    onEditItem={handleEditItem}
                  />
                ))}
              </div>
              <footer className="mt-3 flex items-center justify-between border-t border-divider/60 pt-2 text-[8.5px] text-ink-muted">
                <span className="truncate">{payload.title}</span>
                <span className="tabular-nums">{COPY.apps.cheatsheet.pageNumber(pageIndex + 1, pages.length)}</span>
              </footer>
            </article>
          ))}
        </div>
      </div>

      {/* 打印样式：纸张、方向与分页和屏幕预览保持同源。 */}
      <style jsx global>{`
        .cheatsheet-content-grid {
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
        }
        .cheatsheet-monochrome {
          filter: grayscale(1);
        }
        @media print {
          .cheatsheet-print-page {
            break-after: page;
            box-sizing: border-box;
            min-height: ${settings.paperSize === 'a4'
              ? (settings.orientation === 'portrait' ? '281mm' : '194mm')
              : (settings.orientation === 'portrait' ? '10.37in' : '7.87in')};
            padding: 0 !important;
          }
          .cheatsheet-print-page:last-child {
            break-after: auto;
          }
          .cheatsheet-content-grid {
            grid-template-columns: repeat(${settings.orientation === 'landscape' ? 3 : 2}, minmax(0, 1fr));
          }
          @page {
            size: ${settings.paperSize === 'a4' ? 'A4' : 'Letter'} ${settings.orientation};
            margin: 8mm;
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
          nav,
          header:not(.print-keep) {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export default CheatsheetWindow;
