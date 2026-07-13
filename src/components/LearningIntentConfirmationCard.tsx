'use client';

import { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type {
  LearningContextFocus,
  LearningIntentApproach,
  LearningIntentPlan,
} from '@/types/learning-intent';
import { COPY } from '@/lib/ui/copy';

const APPROACHES: Array<{ key: LearningIntentApproach; label: string }> = [
  { key: 'understand', label: COPY.globalAsk.approachUnderstand },
  { key: 'practice', label: COPY.globalAsk.approachPractice },
  { key: 'synthesize', label: COPY.globalAsk.approachSynthesize },
  { key: 'create', label: COPY.globalAsk.approachCreate },
];

const CONTEXTS: Array<{ key: LearningContextFocus; label: string }> = [
  { key: 'mixed', label: COPY.globalAsk.contextMixed },
  { key: 'current', label: COPY.globalAsk.contextCurrent },
  { key: 'personal', label: COPY.globalAsk.contextPersonal },
];

interface LearningIntentConfirmationCardProps {
  plan: LearningIntentPlan;
  busy?: boolean;
  onConfirm: (plan: LearningIntentPlan) => void;
  onCancel: () => void;
}

export function LearningIntentConfirmationCard({
  plan,
  busy = false,
  onConfirm,
  onCancel,
}: LearningIntentConfirmationCardProps) {
  const [title, setTitle] = useState(plan.title);
  const [outcome, setOutcome] = useState(plan.outcome);
  const [approach, setApproach] = useState(plan.approach);
  const [contextFocus, setContextFocus] = useState(plan.contextFocus);

  const confirm = () => onConfirm({ ...plan, title: title.trim(), outcome: outcome.trim(), approach, contextFocus });

  return (
    <section className="rounded-[22px] border border-pine/18 bg-pine-fog px-5 py-5" aria-label={COPY.globalAsk.intentEyebrow}>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine">
          {COPY.globalAsk.intentEyebrow}
        </p>
        <span className="text-[11px] text-ink-muted">{COPY.globalAsk.intentAdjust}</span>
      </div>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="mt-3 w-full border-0 bg-transparent p-0 text-[19px] font-semibold tracking-[-0.02em] text-ink outline-none"
        aria-label={COPY.globalAsk.intentEyebrow}
      />
      <label className="mt-4 block">
        <span className="text-[11px] font-medium text-ink-muted">{COPY.globalAsk.intentOutcome}</span>
        <textarea
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          rows={2}
          className="mt-1.5 w-full resize-none rounded-xl border border-divider bg-white px-3 py-2 text-[13.5px] leading-6 text-ink outline-none focus:border-pine/35"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {APPROACHES.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setApproach(item.key)}
            className={`rounded-full border px-3 py-1.5 text-[11.5px] transition ${approach === item.key ? 'border-pine bg-pine text-white' : 'border-divider bg-white text-ink-secondary hover:border-pine/30'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {CONTEXTS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setContextFocus(item.key)}
            className={`rounded-full border px-3 py-1.5 text-[11px] transition ${contextFocus === item.key ? 'border-pine/25 bg-pine-mist text-pine' : 'border-divider bg-white text-ink-muted hover:text-ink-secondary'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {plan.checkpoints.length > 0 ? (
        <div className="mt-5 border-t border-pine/12 pt-4">
          <p className="text-[11px] font-medium text-ink-muted">{COPY.globalAsk.intentPath}</p>
          <ol className="mt-2 space-y-2">
            {plan.checkpoints.map((checkpoint, index) => (
              <li key={`${checkpoint}-${index}`} className="flex items-start gap-2 text-[12.5px] leading-5 text-ink-secondary">
                <span className="mt-0.5 font-mono text-[10px] text-pine">{String(index + 1).padStart(2, '0')}</span>
                <span>{checkpoint}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full px-2 py-2 text-[12px] text-ink-muted hover:text-ink">
          <X size={13} />
          {COPY.globalAsk.intentCancel}
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy || !title.trim() || !outcome.trim()}
          className="inline-flex items-center gap-2 rounded-full bg-pine px-4 py-2.5 text-[12.5px] font-medium text-white transition hover:bg-pine-deep disabled:opacity-40"
        >
          {COPY.globalAsk.intentConfirm}
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}
