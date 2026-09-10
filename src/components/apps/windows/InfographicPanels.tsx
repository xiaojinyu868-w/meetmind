'use client';

/**
 * InfographicPanels — 信息图窗口的三块纯展示（从 InfographicWindow 提出，2026-09-10，窗口回到 500 行预算内）：
 * WordToggle（两个词 + 下划线的切换，与导图顶栏、速查表工具条同一控件语言）、PreparingState（与海报同比例的骨架）、
 * LayoutPreview（定制态的版面示意）。无状态、无请求。
 */

import { APPS_COPY } from '@/lib/ui/copy-apps';

export type Orientation = 'landscape' | 'portrait' | 'square';
const ASPECT: Record<Orientation, string> = { landscape: '4 / 3', portrait: '3 / 4', square: '1 / 1' };

/**
 * 等待态：一张与将要生成的海报同比例的骨架（shimmer 横扫）+ 一句话——成品落下来时不跳版；
 * 此前只有一条细线，海报出现的一瞬整个窗口重排。
 */
export function PreparingState({ orientation }: { orientation: Orientation }) {
  return (
    <section
      className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 bg-canvas px-6 py-6"
      data-testid="infographic-window"
      aria-busy
    >
      <div
        className="skel w-full max-w-[min(100%,420px)] rounded-[12px]"
        style={{ aspectRatio: ASPECT[orientation], maxHeight: '60vh' }}
        aria-hidden
      />
      <div className="text-center">
        <p className="text-[14px] font-medium text-ink">{APPS_COPY.infographic.preparing}</p>
        <p className="mt-1 text-[12px] leading-6 text-ink-muted">{APPS_COPY.infographic.preparingHint}</p>
      </div>
    </section>
  );
}

/** 定制态右侧的版面示意：比例随尺寸、底色随风格、字是草案里的标题与要点——改一个词立刻看到大概样子 */
export function LayoutPreview({ orientation, styleClassName, title, points }: { orientation: Orientation; styleClassName: string; title: string; points: string[] }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`w-full max-w-[220px] overflow-hidden rounded-[10px] border border-divider bg-gradient-to-br p-3 shadow-soft transition-[aspect-ratio] duration-300 motion-reduce:transition-none ${styleClassName}`}
        style={{ aspectRatio: ASPECT[orientation] }}
        aria-hidden
      >
        <p className="truncate text-[11px] font-semibold text-ink">{title}</p>
        <ul className="mt-2 space-y-1.5">
          {points.slice(0, 3).map((point, index) => (
            <li key={`${point}-${index}`} className="flex items-start gap-1.5 text-[9px] leading-[1.4] text-ink-secondary">
              <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-ink/50" />
              <span className="line-clamp-2">{point}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[11px] text-ink-muted">{APPS_COPY.infographic.layoutPreview}</p>
    </div>
  );
}

/** 两个词 + 下划线的切换（与导图顶栏、速查表工具条同一控件语言） */
export function WordToggle<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (next: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`text-[13px] underline-offset-[5px] transition ${
              active ? 'font-medium text-ink underline decoration-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

