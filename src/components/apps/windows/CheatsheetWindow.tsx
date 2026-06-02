'use client';

/**
 * CheatsheetWindow — 考试速查表渲染器（M7-fix12）
 *
 * 主用户场景：开卷考 / 允许带一张 A4 / quiz 时的"那一张纸"。
 *
 * 设计哲学校准：
 *   cheatsheet 不是展示工具，是【编辑工具 + 打印工具】。
 *   老师只给一张纸 → 用户必须做取舍 → 我们必须帮他做取舍。
 *
 * 这一轮（fix12）的核心改动：
 *   1. 横向 A4 默认（landscape 比 portrait 多 41% 横向，3 列布局密度更高）
 *   2. 单条删除（×）：屏幕 hover 显出，打印不渲染
 *   3. 区块折叠：整块"我熟"直接收起来
 *   4. 密度估算：顶部"约占一页 N%"，超过 100% 提醒怎么收
 *   5. 字号三档（紧凑 / 标准 / 舒适）：通过 CSS 变量统一驱动
 *
 * 保留来自上一轮的：
 *   - 6 区语义色编码（实色 border-left，打印 100% 保留）
 *   - emphasis = 'strong' 的 ★ 标记 + 极淡区块色（考场扫读救命）
 *   - 公式块强化（等宽 14px + 双侧实色边）
 *   - 打印 -webkit-print-color-adjust: exact
 *   - 复制为 Markdown（次要场景，给"分享给同学"用）
 */

import { useCallback, useMemo, useState } from 'react';
import { Printer, Copy, Check, ChevronDown, ChevronRight, X, RotateCcw } from 'lucide-react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { CompanionMarkdown } from '@/components/classroom/CompanionMarkdown';
import type {
  CheatsheetItem,
  CheatsheetPayload,
  CheatsheetSection,
  CheatsheetSectionKey,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';

interface CheatsheetWindowProps {
  result: AppExecutionResult | null;
  onSeek?: (ms: number) => void;
}

type PageOrientation = 'landscape' | 'portrait';
type FontScale = 'compact' | 'standard' | 'comfortable';

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
  FontScale,
  { term: string; body: string; latex: string; ts: string; rowGap: string; itemPadY: string }
> = {
  compact:     { term: '11.5px', body: '10.5px', latex: '12px', ts: '9.5px',  rowGap: '0.125rem', itemPadY: '0.25rem' },
  standard:    { term: '13.5px', body: '12.25px', latex: '14px', ts: '10.5px', rowGap: '0.25rem',  itemPadY: '0.375rem' },
  comfortable: { term: '15px',   body: '13.5px',  latex: '16px', ts: '11.5px', rowGap: '0.375rem', itemPadY: '0.5rem' },
};

const FONT_SCALE_LABELS: Record<FontScale, string> = {
  compact: '紧凑',
  standard: '标准',
  comfortable: '舒适',
};

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function extractPayload(result: AppExecutionResult | null): CheatsheetPayload | null {
  const payload = result?.render?.payload as Partial<CheatsheetPayload> | undefined;
  if (!payload) return null;
  if (!Array.isArray(payload.sections)) return null;
  if (typeof payload.title !== 'string') return null;
  return payload as CheatsheetPayload;
}

/**
 * 估算"这张速查表占一页 A4 多少比例"。
 *
 * 这是诚实的近似而非精确计算——精确版需要测量实际渲染高度，
 * 在不同字体/系统/打印机下还会漂移。我们给一个"用户能据此决策"
 * 的粗估（误差 ±10% 左右），UI 显示时永远加 "约" 字提醒是估算。
 *
 * 算法：把"一页可装多少条标准字号 item"作为基准容量，
 * 然后按字号档位 / 布局列数 / 是否含 latex 修正。
 */
function estimateDensity(args: {
  visibleItems: number;
  latexCount: number;
  orientation: PageOrientation;
  fontScale: FontScale;
}): number {
  const { visibleItems, latexCount, orientation, fontScale } = args;
  // 基准容量（标准字号 + 2 列 portrait）：~28 条 item
  const baseCapacity = 28;
  // 横向 + 3 列 大约 ×1.65 容量
  const layoutMul = orientation === 'landscape' ? 1.65 : 1;
  // 字号倍率：紧凑可装更多，舒适装更少
  const fontMul = fontScale === 'compact' ? 1.35 : fontScale === 'comfortable' ? 0.74 : 1;
  const capacity = baseCapacity * layoutMul * fontMul;
  // 含 latex 的 item 算 1.6 条（多一个公式块）
  const cost = visibleItems + latexCount * 0.6;
  return Math.round((cost / capacity) * 100);
}

function payloadToMarkdown(
  payload: CheatsheetPayload,
  filter?: { hiddenItemIds: ReadonlySet<string>; collapsedSections: ReadonlySet<string> },
): string {
  const lines: string[] = [];
  lines.push(`# ${payload.title}`, '', `> ${payload.overview}`, '');
  for (const section of payload.sections) {
    if (filter?.collapsedSections.has(section.key)) continue;
    const visibleItems = filter
      ? section.items.filter((it) => !filter.hiddenItemIds.has(it.id))
      : section.items;
    if (visibleItems.length === 0) continue;
    lines.push(`## ${section.label}`, '');
    for (const item of visibleItems) {
      const star = item.emphasis === 'strong' ? ' ★' : '';
      const ts = item.citation ? ` _(${formatMs(item.citation.startMs)})_` : '';
      lines.push(`- **${item.term}${star}** — ${item.body}${ts}`);
      if (item.latex) lines.push(`  $$${item.latex}$$`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function ItemRow({
  item,
  accent,
  onSeek,
  onHide,
}: {
  item: CheatsheetItem;
  accent: (typeof SECTION_ACCENTS)[CheatsheetSectionKey];
  onSeek?: (ms: number) => void;
  onHide: () => void;
}) {
  const isStrong = item.emphasis === 'strong';
  return (
    <li
      className="group relative flex flex-col gap-1 rounded-md print:px-1 print:py-0.5"
      style={{
        backgroundColor: isStrong ? accent.strongTint : 'transparent',
        paddingInline: '0.5rem',
        paddingBlock: 'var(--cs-item-pad-y, 0.375rem)',
      }}
    >
      <div className="flex items-start gap-1.5">
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
                aria-label="老师反复强调 / 必考"
                title="老师反复强调 / 必考"
                className="leading-none"
                style={{ color: accent.dot, fontSize: 'var(--cs-term, 13.5px)' }}
              >
                ★
              </span>
            ) : null}
            {item.citation && onSeek ? (
              <button
                type="button"
                onClick={() => onSeek(item.citation!.startMs)}
                className="print:hidden ml-auto inline-flex h-[22px] items-center rounded-full px-2 font-mono tabular-nums text-ink-secondary ring-[0.5px] ring-ink/[0.10] transition-all duration-150 hover:bg-pine/[0.10] hover:text-pine hover:ring-pine/30 active:scale-95"
                style={{ fontSize: 'var(--cs-ts, 10.5px)' }}
                title={`跳到课堂 ${formatMs(item.citation.startMs)} 处`}
                aria-label={`跳回课堂 ${formatMs(item.citation.startMs)}`}
              >
                {formatMs(item.citation.startMs)}
              </button>
            ) : item.citation ? (
              <span
                className="ml-auto font-mono tabular-nums text-ink-muted/70"
                style={{ fontSize: 'var(--cs-ts, 10.5px)' }}
              >
                {formatMs(item.citation.startMs)}
              </span>
            ) : null}
            {/* 删除按钮：hover 才显，避免视觉污染；打印时不渲染 */}
            <button
              type="button"
              onClick={onHide}
              className="print:hidden absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-ink-muted opacity-0 ring-[0.5px] ring-[#1C1B19]/[0.18] transition group-hover:opacity-100 hover:bg-white hover:text-[#B5483C] hover:ring-[#B5483C]/40 active:scale-90"
              title="不带这条进考场（屏幕态隐藏 / 打印不出）"
              aria-label="删除此条"
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
}: {
  section: CheatsheetSection;
  hiddenItemIds: ReadonlySet<string>;
  onHideItem: (itemId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSeek?: (ms: number) => void;
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
            {hiddenCount} 条已删
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
          title={collapsed ? '展开' : '折叠（不带进考场）'}
          aria-label={collapsed ? '展开' : '折叠'}
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
              title={`${strongCount} 条必考 / 重点`}
            >
              ★{strongCount}
            </span>
          ) : null}
          <span>{visibleItems.length}</span>
          {hiddenCount > 0 ? (
            <span className="text-ink-muted/50" title={`${hiddenCount} 条已删除`}>
              /-{hiddenCount}
            </span>
          ) : null}
        </span>
      </header>
      {collapsed ? (
        <p className="text-[10.5px] text-ink-muted/70 print:hidden">
          已折叠（不带进考场） · {visibleItems.length} 条
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
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function CheatsheetWindow({ result, onSeek }: CheatsheetWindowProps) {
  const payload = extractPayload(result);

  // 编辑态本地状态：删除集合 / 折叠集合 / 排版参数 / 字号档位
  // 全部本地，刷新即重置——这是有意的：避免引入持久化层增加复杂度，
  // 一节课的 cheatsheet 调一次基本就打印了，不需要跨会话保留。
  const [hiddenItemIds, setHiddenItemIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [orientation, setOrientation] = useState<PageOrientation>('landscape'); // 默认横向：考场带纸主流
  const [fontScale, setFontScale] = useState<FontScale>('standard');
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');

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
    if (!payload) return;
    const md = payloadToMarkdown(payload, { hiddenItemIds, collapsedSections });
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
  }, [payload, hiddenItemIds, collapsedSections]);

  // 密度估算 / 总览统计
  const stats = useMemo(() => {
    if (!payload) return null;
    let visibleItems = 0;
    let latexCount = 0;
    let strongCount = 0;
    let hiddenCount = 0;
    let visibleSections = 0;
    for (const section of payload.sections) {
      if (collapsedSections.has(section.key)) {
        // 折叠 = 不带 = 不算入密度，但单独统计
        hiddenCount += section.items.filter((it) => !hiddenItemIds.has(it.id)).length;
        continue;
      }
      let sectionVisible = 0;
      for (const item of section.items) {
        if (hiddenItemIds.has(item.id)) {
          hiddenCount += 1;
          continue;
        }
        visibleItems += 1;
        sectionVisible += 1;
        if (item.latex) latexCount += 1;
        if (item.emphasis === 'strong') strongCount += 1;
      }
      if (sectionVisible > 0) visibleSections += 1;
    }
    const density = estimateDensity({ visibleItems, latexCount, orientation, fontScale });
    return { visibleSections, visibleItems, strongCount, hiddenCount, density };
  }, [payload, hiddenItemIds, collapsedSections, orientation, fontScale]);

  const fontVars = FONT_SCALES[fontScale];
  const cssVars = {
    ['--cs-term' as string]: fontVars.term,
    ['--cs-body' as string]: fontVars.body,
    ['--cs-latex' as string]: fontVars.latex,
    ['--cs-ts' as string]: fontVars.ts,
    ['--cs-row-gap' as string]: fontVars.rowGap,
    ['--cs-item-pad-y' as string]: fontVars.itemPadY,
  };

  if (!payload) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <p className="text-[14px] font-medium text-ink">速查表还在等课堂内容</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted">
            一张能带进考场的速查表至少需要 5 分钟以上的课堂转录。
          </p>
          <ul className="mt-3 space-y-1.5 text-left text-[12px] leading-relaxed text-ink-muted">
            <li>{'· 继续录课，5 分钟后再点一次"考试速查表"'}</li>
            <li>· 或在已有课堂里试试，体验完整效果</li>
            <li>· 想先预览：试听一节 demo 课，看真实产出</li>
          </ul>
        </div>
      </div>
    );
  }

  const isOverflow = stats && stats.density > 100;
  const hasEdits = hiddenItemIds.size > 0 || collapsedSections.size > 0;

  return (
    <div className="flex h-full flex-col bg-[#FAF7F2]" style={cssVars as React.CSSProperties}>
      {/* 顶部信息条：标题 + 密度估算 + 编辑工具 + 主操作 */}
      <div className="flex-shrink-0 flex flex-col gap-2.5 border-b border-[#E8E2D5] bg-canvas px-8 py-3.5 print:hidden">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[17px] font-semibold tracking-[-0.015em] text-ink">
              {payload.title}
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">{payload.overview}</p>
            {stats ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-ink-muted/85">
                <span>
                  {stats.visibleSections} 区 · {stats.visibleItems} 条
                </span>
                {stats.strongCount > 0 ? (
                  <>
                    <span aria-hidden className="text-ink-muted/40">·</span>
                    <span className="inline-flex items-center text-[#B8842B]">★ {stats.strongCount}</span>
                  </>
                ) : null}
                <span aria-hidden className="text-ink-muted/40">·</span>
                <span
                  className={isOverflow ? 'font-medium text-vermilion' : 'text-ink-muted'}
                  title="按字号 / 布局粗略估算，实际打印 ±10% 误差"
                >
                  约占一页 {stats.density}%
                  {isOverflow ? `（超出 ${stats.density - 100}%）` : ''}
                </span>
                {stats.hiddenCount > 0 ? (
                  <>
                    <span aria-hidden className="text-ink-muted/40">·</span>
                    <span className="text-ink-muted/70">已删 {stats.hiddenCount}</span>
                  </>
                ) : null}
              </div>
            ) : null}
            {isOverflow ? (
              <p className="mt-1 text-[11px] leading-relaxed text-vermilion/85">
                超出一页：考虑调字号到「紧凑」、删几条、或者保持横向 A4。
              </p>
            ) : null}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex h-[28px] items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-medium text-ink ring-[0.5px] ring-[#1C1B19]/[0.18] transition hover:ring-[#1C1B19]/[0.4] active:scale-95"
              title="复制为 Markdown，便于粘贴到笔记或发给同学"
            >
              {copyState === 'done' ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.8} />}
              {copyState === 'done' ? '已复制' : 'Markdown'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex h-[28px] items-center gap-1.5 rounded-full bg-ink px-3.5 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-95"
              title="打印 / 导出 PDF（按当前布局与字号）"
            >
              <Printer size={12} strokeWidth={1.8} />
              打印 / 导出 PDF
            </button>
          </div>
        </div>

        {/* 编辑工具条：横向/纵向 + 字号档位 + 恢复全部 */}
        <div className="flex items-center gap-3 text-[11px] text-ink-muted">
          {/* 布局切换 */}
          <div className="inline-flex items-center gap-1">
            <span className="text-ink-muted/70">页面</span>
            <div className="inline-flex rounded-full bg-paper-warm p-[2px]">
              {(['landscape', 'portrait'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setOrientation(opt)}
                  className={`rounded-full px-2.5 py-[2px] text-[11px] font-medium transition ${
                    orientation === opt ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}
                  title={opt === 'landscape' ? '横向 A4（3 列，密度更高）' : '纵向 A4（2 列）'}
                  aria-pressed={orientation === opt}
                >
                  {opt === 'landscape' ? '横向 A4' : '纵向 A4'}
                </button>
              ))}
            </div>
          </div>

          {/* 字号档位 */}
          <div className="inline-flex items-center gap-1">
            <span className="text-ink-muted/70">字号</span>
            <div className="inline-flex rounded-full bg-paper-warm p-[2px]">
              {(['compact', 'standard', 'comfortable'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFontScale(opt)}
                  className={`rounded-full px-2.5 py-[2px] text-[11px] font-medium transition ${
                    fontScale === opt ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}
                  aria-pressed={fontScale === opt}
                  title={
                    opt === 'compact'
                      ? '紧凑：能塞最多内容（中文打印可读极限）'
                      : opt === 'comfortable'
                        ? '舒适：屏幕预览友好'
                        : '标准：均衡'
                  }
                >
                  {FONT_SCALE_LABELS[opt]}
                </button>
              ))}
            </div>
          </div>

          {/* 恢复全部：仅在有编辑时出现，避免视觉污染 */}
          {hasEdits ? (
            <button
              type="button"
              onClick={handleResetEdits}
              className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] text-ink-muted ring-[0.5px] ring-[#1C1B19]/[0.14] transition hover:bg-white hover:text-ink hover:ring-[#1C1B19]/[0.3] active:scale-95"
              title="恢复全部（撤销所有删除和折叠）"
            >
              <RotateCcw size={11} strokeWidth={1.8} />
              恢复全部
            </button>
          ) : null}
        </div>
      </div>

      {/* 速查卡主体 */}
      <div className="flex-1 overflow-y-auto px-6 py-5 print:overflow-visible print:p-[10mm]">
        <div className="mx-auto w-full" style={{ maxWidth: orientation === 'landscape' ? '1100px' : '880px' }}>
          {/* 打印态专属 header */}
          <header className="mb-3 hidden print:block">
            <h1 className="text-[16px] font-semibold text-ink">{payload.title}</h1>
            <p className="mt-0.5 text-[10px] text-ink-muted">{payload.overview}</p>
          </header>
          <div
            className={`grid gap-3 print:gap-2 ${
              orientation === 'landscape'
                ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-3'
                : 'grid-cols-1 md:grid-cols-2 print:grid-cols-2'
            }`}
          >
            {payload.sections.map((section) => (
              <SectionCard
                key={section.key}
                section={section}
                hiddenItemIds={hiddenItemIds}
                onHideItem={handleHideItem}
                collapsed={collapsedSections.has(section.key)}
                onToggleCollapse={() => handleToggleCollapse(section.key)}
                onSeek={onSeek}
              />
            ))}
          </div>

          <footer className="mt-6 hidden print:flex print:items-center print:justify-between print:text-[8.5px] print:text-ink-muted">
            <span className="truncate">{payload.title}</span>
            <span className="tabular-nums">
              {new Date().toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </footer>
        </div>
      </div>

      {/* 打印样式：按 orientation 动态切换 + 颜色保真 */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 ${orientation};
            margin: 0;
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
