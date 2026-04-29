'use client';

import { useMemo } from 'react';
import type { UIMessage } from 'ai';
import { ArrowRight, CircleDashed } from 'lucide-react';
import {
  deriveConsultWorkbench,
  type ConsultWorkbenchState,
} from './workbench-compass-model';

interface ConsultWorkbenchCompassProps {
  messages: UIMessage[];
  busy: boolean;
  onContinue: (text: string) => void;
}

function statusCopy(state: ConsultWorkbenchState): { label: string; dot: string } {
  if (state.status === 'working') return { label: '推进中', dot: 'bg-[var(--consult-primary)] consult-dot-pulse' };
  if (state.status === 'blocked') return { label: '待修复', dot: 'bg-rose-dark' };
  return { label: '可继续', dot: 'bg-[var(--consult-success)]' };
}

export function ConsultWorkbenchCompass({ messages, busy, onContinue }: ConsultWorkbenchCompassProps) {
  const state = useMemo(() => deriveConsultWorkbench(messages, busy), [messages, busy]);
  if (!state.visible) return null;

  const status = statusCopy(state);
  const canContinue = !busy && state.status !== 'blocked';
  const primaryAction = state.nextActions[0];
  const continueText = primaryAction
    ? `继续推进当前任务：${primaryAction.label}`
    : `继续推进当前任务：${state.title}`;
  const actionLabel = primaryAction?.label ?? '继续';
  const signalText = state.signals
    .slice(0, 2)
    .map((signal) => `${signal.label} · ${signal.value}`)
    .join(' / ');

  return (
    <section className="border-b border-[var(--consult-border)] bg-[var(--consult-surface)]/95">
      <div className="mx-auto max-w-[760px] px-5 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--consult-border)] bg-[var(--consult-surface-muted)] px-2 py-1 text-[10.5px] text-[var(--consult-secondary)]">
                <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </span>
              <span className="truncate text-[10.5px] text-[var(--consult-muted)]">{state.stage}</span>
              {state.note && (
                <span className="hidden rounded-full border border-[var(--consult-border)] bg-[var(--consult-primary-soft)] px-2 py-1 text-[10.5px] text-[var(--consult-primary)] sm:inline-flex">
                  {state.note}
                </span>
              )}
            </div>

            <div className="mt-2 text-[13px] font-medium leading-snug text-[var(--consult-text)]">{state.title}</div>
            {(state.subtitle || state.detail) && (
              <div className="mt-1 line-clamp-1 text-[11.5px] leading-relaxed text-[var(--consult-secondary)]">
                {state.detail ?? state.subtitle}
              </div>
            )}
            {signalText && <div className="mt-1 text-[10.5px] text-[var(--consult-muted)]">{signalText}</div>}
          </div>

          <div className="flex shrink-0 items-center justify-end">
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => onContinue(continueText)}
              className={
                'inline-flex h-8 max-w-[180px] items-center gap-1.5 rounded-lg border px-3 text-[11.5px] transition ' +
                (canContinue
                  ? 'consult-primary-action'
                  : 'border-[var(--consult-border)] bg-[var(--consult-surface-muted)] text-[var(--consult-muted)]')
              }
              title={actionLabel}
            >
              {busy ? <CircleDashed size={13} strokeWidth={1.8} /> : <ArrowRight size={13} strokeWidth={1.8} />}
              <span className="truncate">{actionLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
