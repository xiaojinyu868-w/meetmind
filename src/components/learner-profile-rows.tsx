'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import type { LearningMemoryKind } from '@/types/user';
import type { ProfileMemoryRow } from '@/components/learner-profile-model';

/**
 * 画像栏里的行：一条"记住的"（可确认 / 改 / 忘掉 / 恢复）与"告诉同学一件事"的新增行。
 * 动作全部是文字，悬停才出现（触屏常显）；这里的每一次点击都是用户在维护自己的画像。
 */

const ADDABLE_KINDS: readonly LearningMemoryKind[] = ['topic', 'challenge', 'preference'];

function TextAction({ onClick, tone = 'muted', children, disabled }: {
  onClick: () => void;
  tone?: 'muted' | 'pine' | 'vermilion';
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded px-1 text-[11.5px] leading-5 transition disabled:opacity-40',
        tone === 'pine' && 'text-pine hover:underline',
        tone === 'vermilion' && 'text-ink-muted hover:text-vermilion',
        tone === 'muted' && 'text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

export function MemoryRow({ row, saving, onConfirm, onEdit, onForget, onResume }: {
  row: ProfileMemoryRow;
  saving: boolean;
  onConfirm: (id: string) => void;
  onEdit: (id: string, title: string) => void;
  onForget: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const copy = GLOBAL_ASK_COPY.profile;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== row.title) onEdit(row.id, next);
    setEditing(false);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { setDraft(row.title); setEditing(false); }
  };

  return (
    <li className={cn('group border-b border-divider/60 py-2.5 last:border-0', row.paused && 'opacity-55')}>
      <div className="flex items-baseline gap-2.5">
        <span className="w-7 shrink-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{row.kindLabel}</span>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
            onBlur={commit}
            maxLength={160}
            className="min-w-0 flex-1 border-b border-pine/50 bg-transparent pb-px text-[13.5px] leading-6 text-ink outline-none"
          />
        ) : (
          <span className={cn('min-w-0 flex-1 text-[13.5px] leading-6', row.paused ? 'text-ink-muted line-through decoration-ink-muted/40' : 'text-ink')}>{row.title}</span>
        )}
        {!editing ? (
          <span className="flex shrink-0 items-baseline gap-0.5 opacity-100 transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            {row.paused ? (
              <TextAction onClick={() => onResume(row.id)} tone="pine" disabled={saving}>{copy.resume}</TextAction>
            ) : (
              <>
                <TextAction onClick={() => { setDraft(row.title); setEditing(true); }} disabled={saving}>{copy.edit}</TextAction>
                <TextAction onClick={() => onForget(row.id)} tone="vermilion" disabled={saving}>{copy.forget}</TextAction>
              </>
            )}
          </span>
        ) : null}
      </div>
      {row.guessed && !editing ? (
        <div className="mt-0.5 flex items-baseline gap-1.5 pl-[38px] text-[11px] text-ink-muted">
          <span>{copy.guessed}</span>
          <span aria-hidden>·</span>
          <TextAction onClick={() => onConfirm(row.id)} tone="pine" disabled={saving}>{copy.guessedConfirm}</TextAction>
          <TextAction onClick={() => { setDraft(row.title); setEditing(true); }} disabled={saving}>{copy.guessedDeny}</TextAction>
        </div>
      ) : null}
    </li>
  );
}

export function AddMemoryRow({ saving, onAdd }: { saving: boolean; onAdd: (kind: LearningMemoryKind, title: string) => void }) {
  const copy = GLOBAL_ASK_COPY.profile;
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<LearningMemoryKind>('topic');
  const active = value.trim().length > 0;

  const submit = () => {
    const title = value.trim();
    if (!title) return;
    onAdd(kind, title);
    setValue('');
    setKind('topic');
  };

  return (
    <li className="pt-3">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
        maxLength={160}
        placeholder={copy.addPlaceholder}
        aria-label={copy.addPlaceholder}
        className="w-full border-b border-divider bg-transparent pb-1.5 text-[13.5px] leading-6 text-ink outline-none transition placeholder:text-ink-muted/70 focus:border-pine/50"
      />
      <div className={cn('mt-2 flex items-center justify-between gap-2 text-[11.5px] transition-opacity', active ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        <span className="flex items-baseline gap-1 text-ink-muted" role="radiogroup" aria-label={copy.addKindLabel}>
          <span className="mr-1">{copy.addKindLabel}</span>
          {ADDABLE_KINDS.map((option, index) => (
            <span key={option} className="inline-flex items-baseline">
              {index > 0 ? <span className="mx-1 text-ink-muted/60" aria-hidden>·</span> : null}
              <button
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => setKind(option)}
                className={cn('rounded px-0.5 transition', kind === option ? 'font-semibold text-ink underline decoration-pine decoration-[1.5px] underline-offset-4' : 'hover:text-ink')}
              >
                {copy.kind[option]}
              </button>
            </span>
          ))}
        </span>
        <button type="button" onClick={submit} disabled={saving || !active} className="font-medium text-pine hover:underline disabled:opacity-40">{copy.addSubmit}</button>
      </div>
      {!active ? <p className="mt-1.5 text-[11px] leading-5 text-ink-muted/80">{copy.addHint}</p> : null}
    </li>
  );
}
