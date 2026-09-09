'use client';

/**
 * 速查表的纸：A4 逻辑页（首页标题区 / 后续页页眉 / 分栏 / 页脚）与手机用的单栏长文。
 * 只负责把已经分好的块摆到纸上；块本身由窗口通过 renderBlock 提供（页面与量高容器共用同一渲染）。
 */

import type { ReactNode } from 'react';
import type { CheatsheetPayload } from '@/lib/ai-native/plugins/cheatsheet.plugin';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import type { PaginatedPage } from './cheatsheet-window-model';

interface PaperMeta {
  payload: CheatsheetPayload;
  lessonCount: number;
}

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date);
}

/** 荧光笔图例：三色各一个词，让这张纸自己解释自己的颜色 */
function HighlightLegend() {
  const copy = APPS_COPY.cheatsheet.legend;
  return (
    <span className="cs-title-legend" aria-hidden>
      <span><mark className="cs-hl" data-kind="definition">{copy.definition}</mark></span>
      <span><mark className="cs-hl" data-kind="formula">{copy.formula}</mark></span>
      <span><mark className="cs-hl" data-kind="pitfall">{copy.pitfall}</mark></span>
    </span>
  );
}

export function CheatsheetFirstHead({ payload, highlight }: { payload: CheatsheetPayload; highlight: boolean }) {
  return (
    <header className="cs-title-head" data-measure="first-head">
      <div className="min-w-0">
        <h1>{payload.title}</h1>
        {payload.overview ? <p className="cs-title-overview">{payload.overview}</p> : null}
      </div>
      {highlight ? <HighlightLegend /> : null}
    </header>
  );
}

export function CheatsheetRunningHead({ payload }: { payload: CheatsheetPayload }) {
  return (
    <header className="cs-running-head" data-measure="running-head">
      <strong>{payload.title}</strong>
      <span>{payload.overview}</span>
    </header>
  );
}

export function CheatsheetPageFoot({ payload, lessonCount, pageNumber, pageCount }: PaperMeta & { pageNumber?: number; pageCount?: number }) {
  const copy = APPS_COPY.cheatsheet;
  const date = formatDate(payload.generatedAt);
  const sourceTitles = (payload.sources ?? []).filter((source) => source.kind === 'lesson').map((source) => source.title);
  const extra = (payload.sources ?? []).filter((source) => source.kind !== 'lesson').map((source) => source.title);
  const from = sourceTitles.length > 0
    ? copy.footerFrom(sourceTitles.length <= 2 ? sourceTitles.join(' · ') : `${sourceTitles[0]} 等`, lessonCount)
    : '';
  const text = [from, extra.join(' · '), date].filter(Boolean).join(' · ');
  return (
    <footer className="cs-page-foot">
      <span>{text}</span>
      {typeof pageNumber === 'number' && typeof pageCount === 'number' ? <span>{copy.pageNumber(pageNumber, pageCount)}</span> : <span />}
    </footer>
  );
}

interface CheatsheetPagesProps extends PaperMeta {
  pages: PaginatedPage[];
  /** 逻辑页高（px），单页装不满时比 A4 短 */
  pageHeight: number;
  columns: number;
  displayScale: number;
  highlight: boolean;
  renderBlock: (blockId: string) => ReactNode;
}

export function CheatsheetPages({ payload, lessonCount, pages, pageHeight, columns, displayScale, highlight, renderBlock }: CheatsheetPagesProps) {
  return (
    <div className="cs-pages flex flex-col items-center gap-6" style={{ ['--cs-scale' as string]: displayScale, ['--cs-page-h' as string]: `${pageHeight}px` }}>
      {pages.map((page, pageIndex) => (
        <div key={`page-${pageIndex + 1}`} className="cs-page-frame">
          <article className="cs-page" data-cheatsheet-paper data-page={pageIndex + 1} style={{ ['--cs-cols' as string]: columns }}>
            {pageIndex === 0 ? <CheatsheetFirstHead payload={payload} highlight={highlight} /> : <CheatsheetRunningHead payload={payload} />}
            <div className="cs-columns">
              {Array.from({ length: columns }, (_, columnIndex) => (
                <div key={columnIndex} className="cs-col">
                  {(page.columns[columnIndex]?.blocks ?? []).map((block) => (
                    <div key={block.id}>{renderBlock(block.id)}</div>
                  ))}
                </div>
              ))}
            </div>
            <CheatsheetPageFoot payload={payload} lessonCount={lessonCount} pageNumber={pageIndex + 1} pageCount={pages.length} />
          </article>
        </div>
      ))}
    </div>
  );
}

interface CheatsheetFlowProps extends PaperMeta {
  blockIds: string[];
  highlight: boolean;
  renderBlock: (blockId: string) => ReactNode;
}

/** 手机 / 窄栏：一栏读下去，不分页；打印时浏览器自然分页 */
export function CheatsheetFlow({ payload, lessonCount, blockIds, highlight, renderBlock }: CheatsheetFlowProps) {
  return (
    <article className="cs-flow" data-cheatsheet-paper data-flow>
      <CheatsheetFirstHead payload={payload} highlight={highlight} />
      {blockIds.map((id) => <div key={id}>{renderBlock(id)}</div>)}
      <CheatsheetPageFoot payload={payload} lessonCount={lessonCount} />
    </article>
  );
}
