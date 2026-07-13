'use client';

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

interface LearningProgressMemoryCardProps {
  points: string[];
  saved?: boolean;
  onSave: (points: string[]) => Promise<void> | void;
  onDismiss: () => void;
}

export function LearningProgressMemoryCard({
  points,
  saved = false,
  onSave,
  onDismiss,
}: LearningProgressMemoryCardProps) {
  const [selected, setSelected] = useState(() => points.map(() => true));
  const [busy, setBusy] = useState(false);
  const accepted = points.filter((_, index) => selected[index]);

  if (saved) {
    return (
      <div className="rounded-2xl border border-pine/18 bg-pine-fog px-4 py-3 text-[12.5px] text-pine">
        <span className="inline-flex items-center gap-2"><Check size={14} />{COPY.globalAsk.progressSaved}</span>
      </div>
    );
  }

  return (
    <section className="rounded-[20px] border border-divider bg-white px-4 py-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine">{COPY.globalAsk.progressEyebrow}</p>
      <p className="mt-1 text-[11.5px] text-ink-muted">{COPY.globalAsk.progressHint}</p>
      <div className="mt-3 space-y-2">
        {points.map((point, index) => (
          <button
            key={`${point}-${index}`}
            type="button"
            onClick={() => setSelected((current) => current.map((value, itemIndex) => itemIndex === index ? !value : value))}
            className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${selected[index] ? 'border-pine/20 bg-pine-fog text-ink' : 'border-divider bg-paper text-ink-muted'}`}
          >
            <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${selected[index] ? 'border-pine bg-pine text-white' : 'border-ink-muted/40'}`}>
              {selected[index] ? <Check size={10} strokeWidth={2.5} /> : null}
            </span>
            <span className="text-[13px] leading-5">{point}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={onDismiss} className="inline-flex items-center gap-1.5 px-2 py-2 text-[12px] text-ink-muted hover:text-ink">
          <X size={13} />{COPY.globalAsk.progressDismiss}
        </button>
        <button
          type="button"
          disabled={busy || accepted.length === 0}
          onClick={async () => {
            setBusy(true);
            try { await onSave(accepted); } finally { setBusy(false); }
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-pine px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40"
        >
          <Check size={13} />{COPY.globalAsk.progressSave}
        </button>
      </div>
    </section>
  );
}
