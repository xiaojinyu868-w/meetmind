'use client';

/**
 * GlobalAskDesk — 问同学空态的「书桌」：composer 上方那几行可点的实物。
 *
 * 每行一个分组（正在读 / 你标的 / 还没稳 / 最近 / 记得），每件是一枚 chip；点一下，
 * 一句指向具体位置的问题就落进输入框（由宿主 onChoose 处理）。桌上全空时显示空桌面，
 * 给出试听示例课的入口——访客也能看见"这里本来会摆什么"。
 *
 * 数据由 global-ask-desk.ts 纯函数算好传入；这里只负责摆放。
 */

import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import type { DeskGroup, DeskItem } from '@/components/global-ask-desk';

interface GlobalAskDeskProps {
  groups: readonly DeskGroup[];
  onChoose: (item: DeskItem) => void;
  onStartDemo?: () => void;
  className?: string;
}

function ToneDot({ tone }: { tone: DeskItem['tone'] }) {
  if (!tone) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        tone === 'vermilion' ? 'bg-vermilion' : 'bg-pine ring-[3px] ring-pine/15',
      )}
    />
  );
}

export function GlobalAskDesk({ groups, onChoose, onStartDemo, className }: GlobalAskDeskProps) {
  const copy = GLOBAL_ASK_COPY.desk;

  if (groups.length === 0) {
    return (
      <div className={cn('px-4 pt-4 sm:px-5', className)} data-testid="ask-desk-empty">
        <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-pine">{copy.eyebrow}</p>
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[12.5px] leading-5 text-ink-secondary">
            <span className="font-medium text-ink">{copy.emptyTitle}</span>{' '}
            {onStartDemo ? copy.emptyBody : copy.emptyBodyNoDemo}
          </p>
          {onStartDemo ? (
            <button
              type="button"
              onClick={onStartDemo}
              className="group inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-pine transition hover:text-pine-deep"
            >
              {copy.emptyDemo}
              <ArrowRight size={12} className="transition group-hover:translate-x-0.5" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('px-4 pt-4 sm:px-5', className)} data-testid="ask-desk">
      <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-pine">{copy.eyebrow}</p>
      <div className="mt-3 space-y-2">
        {groups.map((group) => (
          <div key={group.id} className="flex items-start gap-3" data-testid={`ask-desk-${group.id}`}>
            <span className="w-[44px] shrink-0 whitespace-nowrap pt-[7px] font-mono text-[9.5px] tracking-[0.04em] text-ink-muted">{group.title}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChoose(item)}
                  title={item.prompt}
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink/8 bg-white/70 px-3 py-1.5 text-left text-[12px] leading-4 text-ink transition hover:-translate-y-px hover:border-pine/40 hover:bg-white hover:shadow-sm"
                >
                  <ToneDot tone={item.tone} />
                  <span className="truncate">{item.label}</span>
                  {item.meta ? <span className="shrink-0 text-[10.5px] text-ink-muted">{item.meta}</span> : null}
                </button>
              ))}
              {group.overflow ? (
                <span className="px-1.5 py-1.5 font-mono text-[10.5px] text-ink-muted">{copy.overflow(group.overflow)}</span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
