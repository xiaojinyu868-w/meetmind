'use client';

import { ArrowRight, CornerDownRight } from 'lucide-react';
import type { LearningActivityEntry, LearningThreadEntry } from '@/types/user';
import { COPY } from '@/lib/ui/copy';

interface ContextRecoveryCardProps {
  thread?: LearningThreadEntry;
  activity?: LearningActivityEntry;
  onResume: () => void;
  compact?: boolean;
}

export function ContextRecoveryCard({ thread, activity, onResume, compact = false }: ContextRecoveryCardProps) {
  const title = thread?.title || activity?.title;
  const detail = thread?.lastSummary || thread?.outcome || activity?.detail;
  if (!title) return null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={onResume}
        className="group flex w-full items-center gap-3 rounded-[18px] border border-vermilion/16 bg-vermilion-fog px-4 py-3.5 text-left transition active:scale-[0.99]"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white text-vermilion">
          <CornerDownRight size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-vermilion">{COPY.globalAsk.recoveryEyebrow}</span>
          <span className="mt-0.5 block truncate text-[15px] font-semibold text-ink">{title}</span>
        </span>
        <ArrowRight size={15} className="text-vermilion transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onResume}
      className="group w-full rounded-[18px] border border-pine/14 bg-pine-fog px-5 py-4 text-left transition hover:border-pine/24 hover:bg-pine-mist"
    >
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-pine/12 bg-white text-pine">
          <CornerDownRight size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-pine">{COPY.globalAsk.recoveryEyebrow}</span>
          <span className="mt-1 block truncate text-[14px] font-semibold text-ink">{title}</span>
          {detail ? <span className="mt-1 block line-clamp-2 text-[11.5px] leading-5 text-ink-secondary">{detail}</span> : null}
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-pine">
          <span className="hidden sm:inline">{COPY.globalAsk.recoveryResume}</span>
          <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}
