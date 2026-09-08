'use client';

/**
 * MomentList — 复习页「困惑点」tab 没选中任何一处时的列表：这节课里学生标下的每一刻，按名字列出来。
 *
 * 此前这里是一个 🎯 空态："选择一个困惑点查看详情 · 点击波形上的红点"——让人去波形上找红点，
 * 而红点只有时间。现在每一刻有名字（moment-title：学生备注 → 脉络要点 → 老师那一刻的原话首句），
 * 点一行就进详情并跳到那一句。命名与问同学书桌、同桌开场 chip 同一套。
 */

import { Check } from 'lucide-react';
import type { Anchor, TranscriptSegment } from '@/types';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import { describeMoment } from '@/lib/learning/moment-title';

interface MomentListProps {
  anchors: readonly Anchor[];
  segments: readonly TranscriptSegment[];
  onSelect: (anchor: Anchor) => void;
}

export function MomentList({ anchors, segments, onSelect }: MomentListProps) {
  const live = anchors.filter((anchor) => !anchor.cancelled);
  const ordered = [...live].sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.timestamp - b.timestamp);
  const copy = COPY.reviewTutor.moments;

  if (ordered.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center" data-testid="moment-list-empty">
        <p className="text-[13px] text-ink-secondary">{copy.emptyTitle}</p>
        <p className="mt-1 text-[12px] leading-5 text-ink-muted">{copy.emptyBody}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white" data-testid="moment-list">
      <div className="flex items-baseline justify-between border-b border-divider-light px-4 py-3">
        <p className="text-[13px] font-semibold text-ink">{copy.title(ordered.length)}</p>
        <p className="text-[11px] text-ink-muted">{copy.hint}</p>
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-divider-light overflow-y-auto">
        {ordered.map((anchor) => {
          const moment = describeMoment(anchor, segments);
          const typeLabel = COPY.globalAsk.desk.anchorType[anchor.type] ?? '';
          return (
            <li key={anchor.id}>
              <button
                type="button"
                onClick={() => onSelect(anchor)}
                className={cn(
                  'flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-paper-warm',
                  anchor.resolved && 'opacity-70',
                )}
              >
                <span
                  className={cn('mt-[7px] h-2 w-2 shrink-0 rounded-full', anchor.resolved ? 'bg-pine' : 'bg-vermilion')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-muted">{moment.time}</span>
                    <span className="min-w-0 truncate text-[13.5px] text-ink">{moment.title || COPY.reviewTutor.confusionUnnamed}</span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                    {anchor.resolved ? (
                      <span className="inline-flex items-center gap-1 text-pine"><Check size={11} strokeWidth={2.4} />{copy.resolved}</span>
                    ) : typeLabel}
                    {anchor.note && moment.source !== 'note' ? ` · ${anchor.note}` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
