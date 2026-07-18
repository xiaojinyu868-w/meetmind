'use client';

import { BookOpen, ChevronRight, Clock3, Database, FileText, History, X } from 'lucide-react';
import type { LearningThreadEntry } from '@/types/user';
import { COPY } from '@/lib/ui/copy';

interface ContextSource {
  id: string;
  title: string;
}

interface GlobalAskContextDrawerProps {
  currentCount: number;
  recentCount: number;
  memoryCount: number;
  sources: ContextSource[];
  activeThread?: LearningThreadEntry;
  onClose: () => void;
  onOpenMemory: () => void;
  onOpenSource?: (sourceId: string) => void;
}

export function GlobalAskContextDrawer({
  currentCount,
  recentCount,
  memoryCount,
  sources,
  activeThread,
  onClose,
  onOpenMemory,
  onOpenSource,
}: GlobalAskContextDrawerProps) {
  const hasContext = currentCount + recentCount + memoryCount > 0;

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-ink/10" role="presentation" onMouseDown={onClose}>
      <aside
        className="flex h-full w-full max-w-[390px] flex-col border-l border-divider bg-paper"
        aria-label={COPY.globalAsk.contextRailTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-divider px-5 py-5 sm:px-6">
          <div>
            <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-pine">{COPY.globalAsk.contextRailEyebrow}</p>
            <h2 className="mt-1.5 text-[17px] font-semibold text-ink">{COPY.globalAsk.contextRailTitle}</h2>
            <p className="mt-1 max-w-xs text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.contextRailBody}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={COPY.globalAsk.close}>
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2 sm:px-6">
          {!hasContext ? <p className="py-8 text-[13px] leading-6 text-ink-secondary">{COPY.globalAsk.contextEmpty}</p> : null}

          {currentCount > 0 ? (
            <section className="border-b border-divider py-5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-ink"><BookOpen size={14} className="text-pine" />{COPY.globalAsk.contextDrawerCurrent}</div>
              {sources.length > 0 ? (
                <div className="mt-2">
                  {sources.map((source) => (
                    <button key={source.id} type="button" onClick={() => onOpenSource?.(source.id)} className="group flex w-full items-center gap-2.5 py-2.5 text-left">
                      <FileText size={13} className="shrink-0 text-ink-muted group-hover:text-pine" />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-secondary group-hover:text-ink">{source.title}</span>
                      <ChevronRight size={12} className="shrink-0 text-ink-muted" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.contextCurrentCount(currentCount)}</p>
              )}
            </section>
          ) : null}

          {recentCount > 0 ? (
            <section className="flex items-start gap-3 border-b border-divider py-5">
              <Clock3 size={14} className="mt-0.5 shrink-0 text-pine" />
              <div><p className="text-[12px] font-semibold text-ink">{COPY.globalAsk.contextDrawerRecent}</p><p className="mt-1 text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.contextRecentCount(recentCount)}，{COPY.globalAsk.contextDrawerRecentBody}</p></div>
            </section>
          ) : null}

          {memoryCount > 0 ? (
            <section className="flex items-start gap-3 border-b border-divider py-5">
              <Database size={14} className="mt-0.5 shrink-0 text-pine" />
              <div><p className="text-[12px] font-semibold text-ink">{COPY.globalAsk.contextDrawerMemory}</p><p className="mt-1 text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.contextMemoryCount(memoryCount)}，{COPY.globalAsk.contextDrawerMemoryBody}</p></div>
            </section>
          ) : null}

          {activeThread?.status === 'active' ? (
            <section className="py-5">
              <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-pine">{COPY.globalAsk.contextActiveThread}</p>
              <p className="mt-1.5 text-[12.5px] font-medium leading-5 text-ink">{activeThread.title}</p>
              {activeThread.lastSummary ? <p className="mt-1 line-clamp-3 text-[11.5px] leading-5 text-ink-muted">{activeThread.lastSummary}</p> : null}
            </section>
          ) : null}
        </div>

        <div className="border-t border-divider p-4 sm:px-6">
          <button type="button" onClick={onOpenMemory} className="flex w-full items-center justify-between rounded-[14px] bg-ink px-4 py-3 text-[12px] font-medium text-white transition hover:bg-pine">
            <span className="inline-flex items-center gap-2"><History size={13} />{COPY.globalAsk.memoryAction}</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </aside>
    </div>
  );
}
