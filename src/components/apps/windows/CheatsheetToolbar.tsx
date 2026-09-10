'use client';

/**
 * 速查表工具条：一行安静的文字控件，不是表单。
 *
 * 左边是这张纸是什么（课名 · 速查表 · 生成时间 · 页数条数），右边是能对它做什么：
 * 版式（弹出：栏数 / 字号 / 密度）· 高亮 · 装进一页 · 缩放 · 打印 · 复制。
 * 开关态 = 墨色字 + 一道松石绿下划线；关 = 灰字。「再做一版」在外层壳的标题栏，这里不重复。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import {
  CHEATSHEET_FONT_RANGE,
  type CheatsheetColumns,
  type CheatsheetDensity,
  type CheatsheetLayoutPrefs,
} from './cheatsheet-window-model';

export type CheatsheetZoom = 'fit' | number;

interface CheatsheetToolbarProps {
  title: string;
  generatedAt?: string;
  pageCount: number;
  itemCount: number;
  hiddenCount: number;
  prefs: CheatsheetLayoutPrefs;
  /** 「装进一页」压缩后的实际字号；与 prefs.fontPx 不同时在版式里提示 */
  effectiveFontPx: number;
  /** 窄容器：单栏长文，不提供栏数 / 装进一页 / 缩放 */
  flow: boolean;
  zoom: CheatsheetZoom;
  displayScale: number;
  copyState: 'idle' | 'done';
  onPrefsChange: (patch: Partial<CheatsheetLayoutPrefs>) => void;
  onZoomChange: (zoom: CheatsheetZoom) => void;
  onRestoreHidden: () => void;
  onPrint: () => void;
  onCopy: () => void;
  /** 第一次进入时的一行快捷键提示（keyboard-hints 记住） */
  keyboardHint?: string;
}

/** 文字开关：36px 高的命中区（触屏够按），下划线 180ms 淡入淡出，pine 焦点环 */
function TextToggle({ active, onClick, children, ariaLabel }: { active: boolean; onClick: () => void; children: ReactNode; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`cs-tb-btn mm-press mm-focus relative inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-1 text-[12.5px] ${active ? 'text-ink' : 'text-ink-muted mm-hover-ink'}`}
    >
      {children}
      <span
        aria-hidden
        className={`absolute bottom-[5px] left-1 right-1 h-[1.5px] rounded-full bg-pine transition-opacity duration-[180ms] ${active ? 'opacity-100' : 'opacity-0'}`}
      />
    </button>
  );
}

function TextAction({ onClick, children, primary }: { onClick: () => void; children: ReactNode; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mm-press mm-focus inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-1 text-[12.5px] ${primary ? 'font-medium text-ink hover:text-pine' : 'text-ink-secondary mm-hover-ink'}`}
    >
      {children}
    </button>
  );
}

function Stepper({ value, onDec, onInc, decLabel, incLabel, disabledDec, disabledInc }: {
  value: ReactNode; onDec: () => void; onInc: () => void; decLabel: string; incLabel: string; disabledDec?: boolean; disabledInc?: boolean;
}) {
  const btn = 'mm-press mm-focus mm-hover-warm flex h-8 w-8 items-center justify-center rounded-full text-[15px] leading-none text-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-30';
  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-[12px] tabular-nums text-ink-secondary">
      <button type="button" onClick={onDec} disabled={disabledDec} aria-label={decLabel} title={decLabel} className={btn}>−</button>
      <span className="min-w-[4ch] text-center">{value}</span>
      <button type="button" onClick={onInc} disabled={disabledInc} aria-label={incLabel} title={incLabel} className={btn}>+</button>
    </span>
  );
}

function formatGeneratedAt(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function CheatsheetToolbar(props: CheatsheetToolbarProps) {
  const {
    title, generatedAt, pageCount, itemCount, hiddenCount, prefs, effectiveFontPx, flow, zoom, displayScale,
    copyState, onPrefsChange, onZoomChange, onRestoreHidden, onPrint, onCopy, keyboardHint,
  } = props;
  const [layoutOpen, setLayoutOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const copy = APPS_COPY.cheatsheet;

  useEffect(() => {
    if (!layoutOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setLayoutOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setLayoutOpen(false); };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [layoutOpen]);

  const generated = formatGeneratedAt(generatedAt);
  const fontStep = (direction: 1 | -1) => {
    const next = Math.round((prefs.fontPx + direction * CHEATSHEET_FONT_RANGE.step) * 2) / 2;
    onPrefsChange({ fontPx: Math.min(CHEATSHEET_FONT_RANGE.max, Math.max(CHEATSHEET_FONT_RANGE.min, next)) });
  };
  const zoomStep = (direction: 1 | -1) => {
    const current = zoom === 'fit' ? displayScale : zoom;
    const next = Math.round((current + direction * 0.1) * 10) / 10;
    onZoomChange(Math.min(2, Math.max(0.4, next)));
  };
  const fontCompressed = Math.abs(effectiveFontPx - prefs.fontPx) > 0.05;

  return (
    <div className={`cs-noprint flex items-center gap-x-5 gap-y-1 px-4 pb-2 pt-2 sm:px-6 ${flow ? 'flex-col items-stretch' : 'flex-wrap'}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
          {title}
          <span className="font-normal text-ink-muted"> · {copy.paperLabel}</span>
        </p>
        <p className="mt-0.5 truncate text-[11.5px] tabular-nums text-ink-muted">
          {[generated ? copy.generatedAt(generated) : null, flow ? null : copy.pageTotal(pageCount), copy.itemCount(itemCount)]
            .filter(Boolean)
            .join(' · ')}
          {hiddenCount > 0 ? (
            <>
              <span aria-hidden> · </span>
              <button type="button" onClick={onRestoreHidden} className="mm-focus rounded text-ink-muted underline decoration-divider underline-offset-2 hover:text-ink">
                {copy.restoreHidden(hiddenCount)}
              </button>
            </>
          ) : null}
          {keyboardHint ? <span className="hidden text-ink-muted/70 md:inline"> · {keyboardHint}</span> : null}
        </p>
      </div>

      {/* 窄屏：动作一行横向滚动，不折成两行 */}
      <div className={`flex items-center gap-x-3 ${flow ? 'mm-no-scrollbar -mx-1 overflow-x-auto px-1' : 'flex-wrap gap-y-1'}`}>
        <div ref={popoverRef} className="relative">
          <TextToggle active={layoutOpen} onClick={() => setLayoutOpen((open) => !open)}>{copy.layout}</TextToggle>
          {layoutOpen ? (
            <div className={`mm-pop-in absolute top-[calc(100%+6px)] z-30 w-[236px] rounded-[14px] border border-divider bg-white p-4 shadow-float ${flow ? 'left-0' : 'right-0'}`}>
              {!flow ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] text-ink-secondary">{copy.columns}</span>
                  <span className="flex items-center gap-3.5">
                    {([1, 2, 3, 4] as CheatsheetColumns[]).map((count) => (
                      <TextToggle key={count} active={prefs.columns === count} onClick={() => onPrefsChange({ columns: count })} ariaLabel={copy.columnsOf(count)}>
                        <span className="font-mono tabular-nums">{count}</span>
                      </TextToggle>
                    ))}
                  </span>
                </div>
              ) : null}
              <div className={`flex items-center justify-between gap-3 ${flow ? '' : 'mt-3.5'}`}>
                <span className="text-[12px] text-ink-secondary">{copy.fontSize}</span>
                <Stepper
                  value={fontCompressed ? `${effectiveFontPx.toFixed(1).replace(/\.0$/, '')}*` : prefs.fontPx.toFixed(1).replace(/\.0$/, '')}
                  onDec={() => fontStep(-1)}
                  onInc={() => fontStep(1)}
                  decLabel={copy.fontSmaller}
                  incLabel={copy.fontLarger}
                  disabledDec={prefs.fontPx <= CHEATSHEET_FONT_RANGE.min}
                  disabledInc={prefs.fontPx >= CHEATSHEET_FONT_RANGE.max}
                />
              </div>
              <div className="mt-3.5 flex items-center justify-between gap-3">
                <span className="text-[12px] text-ink-secondary">{copy.density}</span>
                <span className="flex items-center gap-3">
                  {(['tight', 'normal', 'loose'] as CheatsheetDensity[]).map((density) => (
                    <TextToggle key={density} active={prefs.density === density} onClick={() => onPrefsChange({ density })}>
                      {copy.densityLabel[density]}
                    </TextToggle>
                  ))}
                </span>
              </div>
              {fontCompressed ? (
                <p className="mt-3 text-[11px] leading-5 text-ink-muted">{copy.fontCompressedHint}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <TextToggle active={prefs.highlight} onClick={() => onPrefsChange({ highlight: !prefs.highlight })}>{copy.highlight}</TextToggle>
        {!flow ? (
          <TextToggle active={prefs.fitOnePage} onClick={() => onPrefsChange({ fitOnePage: !prefs.fitOnePage })}>{copy.fitOnePage}</TextToggle>
        ) : null}
        {!flow ? (
          <span className="hidden items-center gap-0.5 md:inline-flex">
            <Stepper
              value={`${Math.round(displayScale * 100)}%`}
              onDec={() => zoomStep(-1)}
              onInc={() => zoomStep(1)}
              decLabel={copy.zoomOut}
              incLabel={copy.zoomIn}
            />
            {zoom !== 'fit' ? (
              <button type="button" onClick={() => onZoomChange('fit')} className="mm-focus mm-app-enter ml-1 rounded text-[11.5px] text-ink-muted hover:text-ink">{copy.zoomFit}</button>
            ) : null}
          </span>
        ) : null}
        <span aria-hidden className="hidden h-3.5 w-px bg-divider sm:inline-block" />
        <TextAction onClick={onCopy}>{copyState === 'done' ? copy.copied : copy.copyMarkdown}</TextAction>
        <TextAction onClick={onPrint} primary>{copy.print}</TextAction>
      </div>
    </div>
  );
}
