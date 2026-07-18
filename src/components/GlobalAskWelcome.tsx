'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Check, ChevronRight, Layers3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LearningThreadEntry } from '@/types/user';
import { COPY } from '@/lib/ui/copy';
import { OctoAvatar } from '@/components/ui/octo-avatar';

interface GlobalAskWelcomeProps {
  depth: 'quick' | 'deep';
  activeThread?: LearningThreadEntry;
  composer: ReactNode;
  contextSummary: string;
  onDepthChange: (depth: 'quick' | 'deep') => void;
  onOpenContext: () => void;
  onChoosePrompt: (prompt: string) => void;
  onResumeThread: () => void;
}

export function GlobalAskWelcome({
  depth,
  activeThread,
  composer,
  contextSummary,
  onDepthChange,
  onOpenContext,
  onChoosePrompt,
  onResumeThread,
}: GlobalAskWelcomeProps) {
  const prompts = depth === 'deep'
    ? COPY.globalAsk.deepExamples
    : COPY.globalAsk.quickExamples;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-1 pb-6 pt-3 sm:px-4 sm:pb-10 sm:pt-8">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <OctoAvatar mood="listening" size="sm" className="shrink-0" />
          <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-vermilion">
            {COPY.globalAsk.welcomeEyebrow}
          </p>
        </div>
        <h2 className="mt-2 max-w-2xl font-serif text-[28px] italic leading-[1.12] tracking-[-0.035em] text-ink sm:text-[38px]">
          {depth === 'deep' ? COPY.globalAsk.deepEmptyTitle : COPY.globalAsk.emptyTitle}
        </h2>
        <p className="mt-2 max-w-xl text-[12.5px] leading-5 text-ink-secondary sm:text-[13px] sm:leading-6">
          {depth === 'deep' ? COPY.globalAsk.deepEmptyBody : COPY.globalAsk.emptyBody}
        </p>
      </div>

      {activeThread?.status === 'active' ? (
        <button
          type="button"
          onClick={onResumeThread}
          className="group mt-7 flex w-full items-center gap-3 border-y border-divider py-3.5 text-left transition hover:border-pine/20"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pine-fog text-pine"><ArrowRight size={14} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-pine">{COPY.globalAsk.threadTitle}</span>
            <span className="mt-1 block truncate text-[13px] font-semibold text-ink">{activeThread.title}</span>
          </span>
          <span className="hidden text-[11px] font-medium text-ink-muted sm:block">{COPY.globalAsk.threadResume}</span>
          <ChevronRight size={14} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
        </button>
      ) : null}

      <div className="mt-7 overflow-hidden rounded-[24px] border border-pine/15 bg-white">
        <div className="px-3 pt-3 sm:px-4 sm:pt-4">{composer}</div>
        <div className="flex flex-col gap-2 border-t border-divider-light px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1" aria-label={COPY.globalAsk.modeSelectorLabel}>
            {(['quick', 'deep'] as const).map((option) => {
              const selected = depth === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onDepthChange(option)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11.5px] transition',
                    selected ? 'bg-ink text-white' : 'text-ink-muted hover:bg-paper-warm hover:text-ink',
                  )}
                >
                  {selected ? <Check size={11} /> : null}
                  {option === 'quick' ? COPY.globalAsk.quickMode : COPY.globalAsk.deepMode}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onOpenContext}
            className="inline-flex min-w-0 items-center gap-1.5 text-left text-[10.5px] text-ink-muted transition hover:text-pine"
          >
            <Layers3 size={12} className="shrink-0" />
            <span className="truncate">{contextSummary}</span>
            <ChevronRight size={11} className="shrink-0" />
          </button>
        </div>
      </div>

      <div className="mt-8">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-muted">{COPY.globalAsk.startersTitle}</p>
        <div className="mt-2 border-t border-divider">
          {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onChoosePrompt(prompt)}
            className="group flex w-full items-center justify-between gap-4 border-b border-divider py-3.5 text-left transition hover:border-pine/25"
          >
            <span className="text-[12.5px] leading-5 text-ink-secondary transition group-hover:text-ink">{prompt}</span>
            <ArrowRight size={14} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
          </button>
          ))}
        </div>
      </div>
    </div>
  );
}
