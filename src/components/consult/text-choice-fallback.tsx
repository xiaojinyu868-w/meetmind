'use client';

import type { InlineChoicePrompt } from './text-choice-parser';

export function TextChoiceFallback({
  prompt,
  disabled,
  onChoose,
}: {
  prompt: InlineChoicePrompt;
  disabled?: boolean;
  onChoose: (message: string) => void;
}) {
  return (
    <div className="consult-reveal overflow-hidden rounded-xl border border-[var(--consult-border)] bg-[var(--consult-surface)]">
      <div className="border-b border-[var(--consult-border)] px-4 py-3">
        <div className="text-[10.5px] uppercase tracking-wider text-[var(--consult-muted)]">需要你确认一下</div>
        <div className="mt-1 text-[14px] font-medium leading-relaxed text-[var(--consult-text)]">{prompt.question}</div>
      </div>
      <div className="divide-y divide-[var(--consult-border)]">
        {prompt.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onChoose(`我选 ${option.label}：${option.text}`)}
            className="group flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[var(--consult-primary-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[var(--consult-border)] bg-[var(--consult-bg)] text-[11px] font-medium text-[var(--consult-muted)] group-hover:border-[var(--consult-primary)] group-hover:bg-[var(--consult-surface)] group-hover:text-[var(--consult-primary)]">
              {option.label}
            </span>
            <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-[var(--consult-text)]">{option.text}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-[var(--consult-border)] bg-[var(--consult-bg)] px-4 py-2 text-[10.5px] text-[var(--consult-muted)]">
        已自动整理成可点选项，避免让你手打 A/B/C。
      </div>
    </div>
  );
}
