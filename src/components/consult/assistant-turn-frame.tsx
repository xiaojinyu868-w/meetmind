'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { UIMessage } from 'ai';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { summarizeAssistantTurn } from './assistant-turn-summary';

interface AssistantTurnFrameProps {
  message: UIMessage;
  compactByDefault: boolean;
  children: ReactNode;
}

export function AssistantTurnFrame({ message, compactByDefault, children }: AssistantTurnFrameProps) {
  const [open, setOpen] = useState(!compactByDefault);

  useEffect(() => {
    if (compactByDefault) setOpen(false);
  }, [compactByDefault]);

  if (!compactByDefault) return <>{children}</>;

  const summary = summarizeAssistantTurn(message);

  if (open) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex items-center gap-1.5 text-[11px] text-ink-muted transition hover:text-ink"
        >
          <ChevronDown size={13} strokeWidth={1.8} />
          收起这轮
        </button>
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="consult-reveal flex w-full items-center gap-3 rounded-xl border border-divider bg-card px-4 py-3 text-left transition hover:border-ink/40 hover:bg-hover"
    >
      <ChevronRight size={14} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-ink-muted">{summary.label}</div>
        <div className="mt-0.5 truncate text-[12.5px] font-medium text-ink">{summary.title}</div>
        {summary.detail && (
          <div className="mt-0.5 line-clamp-1 text-[11px] text-ink-muted">{summary.detail}</div>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-ink-muted">展开</span>
    </button>
  );
}
