import type { ReactNode } from 'react';

export function LevelMeter({ active }: { active: boolean }) {
  return (
    <div className="flex h-5 items-end gap-1" aria-hidden="true">
      {[10, 15, 12, 18].map((height, index) => (
        <span
          key={height}
          className={'w-[3px] rounded-full bg-ink ' + (active ? 'consult-dot-pulse' : 'opacity-20')}
          style={{
            height,
            animationDelay: active ? `${index * 120}ms` : undefined,
          }}
        />
      ))}
    </div>
  );
}

export function Receipt({ children }: { children: ReactNode }) {
  return (
    <div className="consult-reveal rounded-xl border border-divider bg-card px-4 py-3 text-[12px] leading-relaxed text-ink-secondary">
      {children}
    </div>
  );
}

export function VoiceHistoryReceipt({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="consult-reveal rounded-xl border border-divider bg-card px-4 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" />
        <div className="min-w-0">
          <div className="text-[12px] font-medium leading-tight text-ink">{title}</div>
          <div className="mt-1 truncate text-[11.5px] leading-relaxed text-ink-muted">{body}</div>
        </div>
      </div>
    </div>
  );
}
