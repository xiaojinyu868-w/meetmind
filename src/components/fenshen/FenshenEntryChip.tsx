'use client';

/**
 * FenshenEntryChip — 「请一个分身」固定入口。
 *
 * 自包含：入口按钮 + FenshenShelf 全屏层（fixed inset-0，模式参照
 * IntentDialog）的状态都在内部，消费侧只需渲染 <FenshenEntryChip />。
 * 挂载点：课后应用矩阵（WorkshopYellowPage，card 形态）+ 课堂同桌课后
 * starter 卡（ClassroomCompanionPanel，chip 形态）；它不是
 * /api/apps/execute 产物型应用，不进 WORKSHOP_APP_CATALOG。
 */

import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { FenshenShelf } from './FenshenShelf';

export function FenshenEntryChip({ variant = 'chip' }: { variant?: 'chip' | 'card' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'card' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-pine/30 bg-card p-3.5 text-left text-ink transition hover:-translate-y-0.5 hover:border-pine hover:bg-pine-mist/40 hover:shadow-soft active:scale-[0.99]"
        >
          <span
            aria-hidden
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-pine-mist text-pine"
          >
            <Sparkles size={20} strokeWidth={1.6} />
          </span>
          <span className="min-w-0">
            <strong className="block text-[14px] font-medium leading-snug">
              {COPY.fenshen.entryLabel}
            </strong>
            <span className="mt-0.5 block truncate text-[12px] leading-snug text-ink-secondary">
              {COPY.fenshen.entryBody}
            </span>
          </span>
          <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-pine">
            {COPY.fenshen.invite}
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={COPY.fenshen.entryBody}
          className="inline-flex items-center gap-1.5 rounded-full border border-pine/40 bg-white px-3 py-1.5 text-[12px] text-pine transition hover:bg-pine-mist active:scale-[0.98]"
        >
          <Sparkles size={12} aria-hidden />
          {COPY.fenshen.entryLabel}
        </button>
      )}
      <FenshenShelf open={open} onClose={() => setOpen(false)} />
    </>
  );
}
