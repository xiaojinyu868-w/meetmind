'use client';

import { BookOpen, Clock3, Database } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

interface LearningContextStatusProps {
  currentCount: number;
  recentCount: number;
  memoryCount: number;
}

export function LearningContextStatus({
  currentCount,
  recentCount,
  memoryCount,
}: LearningContextStatusProps) {
  const signals = [
    { key: 'current', count: currentCount, label: COPY.globalAsk.contextCurrentCount(currentCount), icon: BookOpen },
    { key: 'recent', count: recentCount, label: COPY.globalAsk.contextRecentCount(recentCount), icon: Clock3 },
    { key: 'memory', count: memoryCount, label: COPY.globalAsk.contextMemoryCount(memoryCount), icon: Database },
  ].filter((signal) => signal.count > 0);

  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px] text-ink-muted" aria-label={COPY.globalAsk.contextStatus}>
      <span className="shrink-0 font-medium text-ink-secondary">{COPY.globalAsk.contextStatus}</span>
      {signals.length > 0 ? signals.map((signal) => {
        const Icon = signal.icon;
        return (
          <span key={signal.key} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper-warm px-2 py-1">
            <Icon size={11} aria-hidden />
            {signal.label}
          </span>
        );
      }) : <span className="shrink-0">{COPY.globalAsk.contextEmpty}</span>}
    </div>
  );
}
