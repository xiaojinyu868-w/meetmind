'use client';

/**
 * InfographicPanels — 信息图窗口的三块纯展示（从 InfographicWindow 提出，2026-09-10，窗口回到 500 行预算内）：
 * WordToggle（两个词 + 下划线的切换，与导图顶栏、速查表工具条同一控件语言）、PreparingState（与海报同比例的骨架）、
 * LayoutPreview（定制态的版面示意）。无状态、无请求。
 */

import { APPS_COPY } from '@/lib/ui/copy-apps';

export type Orientation = 'landscape' | 'portrait' | 'square';
const ASPECT: Record<Orientation, string> = { landscape: '4 / 3', portrait: '3 / 4', square: '1 / 1' };

/** 进入态 / 等待态里那张框的宽度：与 AppWindowPlaceholder 的形状同一档，四个宿主里视觉重量一致 */
export const FRAME_CLASS = 'w-[clamp(150px,24vw,210px)]';

/**
 * 等待态：与定制态同一套版式——同一张海报比例的框留在原位变成骨架（shimmer 横扫）+ 一句话；
 * 成品落下来时不跳版。此前是骨架 + 两句说明。
 */
export function PreparingState({ orientation }: { orientation: Orientation }) {
  return (
    <section
      className="flex h-full min-h-[420px] flex-col items-center justify-center gap-6 bg-canvas px-6 py-10"
      data-testid="infographic-window"
      aria-busy
    >
      <div
        className={`skel ${FRAME_CLASS} rounded-[10px] shadow-soft`}
        style={{ aspectRatio: ASPECT[orientation], maxHeight: '60vh' }}
        aria-hidden
      />
      <p className="text-center text-[15px] font-medium tracking-[-0.01em] text-ink">{APPS_COPY.infographic.preparing}</p>
    </section>
  );
}

/**
 * 定制态的主角：一张海报比例的框——比例随尺寸、底色随风格、字是草案里的标题与要点。
 * 改一个词框立刻变，所以框下面的两排词不需要「尺寸 / 视觉感觉」这样的标签，也不需要「版面示意」的说明。
 */
export function LayoutPreview({ orientation, styleClassName, title, points }: { orientation: Orientation; styleClassName: string; title: string; points: string[] }) {
  return (
    <div
      className={`${FRAME_CLASS} overflow-hidden rounded-[10px] border border-divider bg-gradient-to-br p-3 shadow-soft transition-[aspect-ratio] duration-300 motion-reduce:transition-none ${styleClassName}`}
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
  );
}

/** 两个词 + 下划线的切换（与导图顶栏、速查表工具条同一控件语言）；`label` 只给读屏，屏幕上不出现标签 */
export function WordToggle<T extends string>({ value, options, onChange, label, className }: { value: T; options: Array<{ value: T; label: string }>; onChange: (next: T) => void; label?: string; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className ?? ''}`} role="group" aria-label={label}>
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

