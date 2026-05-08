'use client';

/**
 * CheatsheetWindow — 考试速查表渲染器（M7-fix10）
 *
 * 用户场景：考前 5-15 分钟翻一眼，把这节课最要命的东西一扫而过。
 *
 * 视觉设计（受 Evan715823/cheatsheet-generator-skill 启发，不抄 LaTeX，抄其哲学）：
 *   - 2 列密集栅格，每一寸都值得看
 *   - 按语义分块着色（定义=墨黑、公式=深黄、易错点=酒红、…）
 *   - 行间距压缩，字号对比拉开——术语 13-14px、正文 11.5-12px
 *   - 打印友好：A4 portrait、页内不分节、浅色底全部去掉
 *   - 每条可选挂小 timestamp chip（点击跳回课堂录音；当下场景在录课中没有播放器，
 *     但 review 态一样渲染时跳转就能生效）
 */

import { useCallback } from 'react';
import { Printer } from 'lucide-react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { CompanionMarkdown } from '@/components/classroom/CompanionMarkdown';
import type {
  CheatsheetPayload,
  CheatsheetSection,
  CheatsheetSectionKey,
} from '@/lib/ai-native/plugins/cheatsheet.plugin';

interface CheatsheetWindowProps {
  result: AppExecutionResult | null;
  onSeek?: (ms: number) => void;
}

// 语义分区配色：墨底强调色由 key 决定，整体仍是白底
const SECTION_ACCENTS: Record<CheatsheetSectionKey, { ring: string; dot: string; label: string }> = {
  definition: { ring: 'ring-[#232322]/20', dot: '#232322', label: 'text-[#232322]' },
  formula:    { ring: 'ring-[#B78900]/35', dot: '#B78900', label: 'text-[#8B6914]' },
  process:    { ring: 'ring-[#2F5D8A]/30', dot: '#2F5D8A', label: 'text-[#2F5D8A]' },
  contrast:   { ring: 'ring-[#5C8A4F]/30', dot: '#5C8A4F', label: 'text-[#5C8A4F]' },
  pitfall:    { ring: 'ring-[#D96B6B]/35', dot: '#D96B6B', label: 'text-[#D96B6B]' },
  exemplar:   { ring: 'ring-[#8A6CB4]/30', dot: '#8A6CB4', label: 'text-[#6C509C]' },
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

function SectionCard({
  section,
  onSeek,
}: {
  section: CheatsheetSection;
  onSeek?: (ms: number) => void;
}) {
  const accent = SECTION_ACCENTS[section.key] ?? SECTION_ACCENTS.definition;
  return (
    <section
      className={`relative break-inside-avoid rounded-xl bg-white px-4 py-3.5 ring-[0.5px] ${accent.ring}`}
    >
      <header className="mb-2.5 flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: accent.dot }}
        />
        <h3 className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${accent.label}`}>
          {section.label}
        </h3>
        <span className="ml-auto text-[10.5px] tabular-nums text-ink-muted/60">
          {section.items.length}
        </span>
      </header>
      <ul className="flex flex-col gap-2">
        {section.items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1">
            <div className="flex items-start gap-1.5">
              <span className="mt-[3px] inline-block h-[3px] w-[3px] flex-shrink-0 rounded-full bg-ink-muted/70" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <strong className="text-[13px] font-semibold tracking-[-0.005em] text-ink">
                    {item.term}
                  </strong>
                  {item.citation && onSeek ? (
                    <button
                      type="button"
                      onClick={() => onSeek(item.citation!.startMs)}
                      className="print:hidden rounded-full px-1.5 py-[1px] font-mono text-[9.5px] tabular-nums text-ink-muted/80 ring-[0.5px] ring-[#232322]/[0.08] transition hover:text-ink hover:ring-[#232322]/[0.2]"
                      title={`跳到 ${formatMs(item.citation.startMs)}`}
                    >
                      {formatMs(item.citation.startMs)}
                    </button>
                  ) : item.citation ? (
                    <span className="font-mono text-[9.5px] tabular-nums text-ink-muted/60">
                      {formatMs(item.citation.startMs)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-[1.55] text-ink-secondary">
                  {item.body}
                </p>
                {item.latex ? (
                  <div className="mt-1 rounded-md bg-[#FAFAF7] px-2 py-1 text-[12px] leading-snug">
                    {/*
                      CompanionMarkdown 已经挂了 remark-math + rehype-katex；
                      用 $$…$$ 让它走块级数学渲染，不需要单独引 katex 依赖。
                    */}
                    <CompanionMarkdown content={`$$${item.latex}$$`} />
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CheatsheetWindow({ result, onSeek }: CheatsheetWindowProps) {
  const payload = extractPayload(result);
  const handlePrint = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.print();
  }, []);

  if (!payload) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-[14px] font-medium text-ink">还没拿到速查表</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
          等课堂内容足够多时再点"考试速查表"——通常需要 ≥ 5 分钟的转录。
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#F7F7F5]">
      {/* 顶部信息条：标题 / 一句话说明 / 打印 */}
      <div className="flex-shrink-0 flex items-start gap-4 border-b border-[#E9E9E7] bg-canvas px-8 py-4 print:hidden">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.015em] text-ink">
            {payload.title}
          </h2>
          <p className="mt-1 truncate text-[12.5px] text-ink-muted">
            {payload.overview}
          </p>
        </div>
        <button
          type="button"
          onClick={handlePrint}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-95"
          title="打印 / 导出 PDF"
        >
          <Printer size={13} strokeWidth={1.8} />
          打印 / 导出 PDF
        </button>
      </div>

      {/* 速查卡主体：2 列栅格，打印时转 A4 portrait */}
      <div className="flex-1 overflow-y-auto px-6 py-5 print:overflow-visible print:p-[12mm]">
        <div className="mx-auto w-full max-w-4xl">
          <header className="mb-4 hidden print:block">
            <h1 className="text-[18px] font-semibold text-ink">{payload.title}</h1>
            <p className="mt-0.5 text-[11px] text-ink-muted">{payload.overview}</p>
          </header>
          <div
            // 2 列在屏幕上 ≥ md；打印时固定 2 列
            className="grid grid-cols-1 gap-3 md:grid-cols-2 print:grid-cols-2 print:gap-2"
          >
            {payload.sections.map((section) => (
              <SectionCard key={section.key} section={section} onSeek={onSeek} />
            ))}
          </div>
        </div>
      </div>

      {/* 打印样式：A4 portrait + 颜色保真 */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          html,
          body {
            background: #ffffff !important;
          }
          /* 打印时去掉窗口壳带来的阴影/边框残影 */
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
