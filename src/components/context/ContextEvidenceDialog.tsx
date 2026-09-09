'use client';

import { useEffect, useRef } from 'react';
import { COPY } from '@/lib/ui/copy';
import type { ContextEventRecord } from '@/types/context';

export function ContextEvidenceDialog({ source, close }: { source: ContextEventRecord | null; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const c = COPY.sharedContext;
  useEffect(() => {
    if (source && !dialog.current?.open) dialog.current?.showModal();
    if (!source && dialog.current?.open) dialog.current?.close();
  }, [source]);
  return <dialog ref={dialog} onCancel={close} aria-labelledby="context-source-title"
    className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-3xl border border-divider bg-card p-6 text-ink backdrop:bg-black/30 sm:p-8">
    {source && <aside aria-live="polite">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h3 id="context-source-title" className="text-lg font-medium">{source.source?.title ?? c.history}</h3>
        <button onClick={close} className="shrink-0 rounded-full border border-divider px-3 py-1.5 text-xs text-pine">{c.closeSource}</button>
      </div>
      <p className="mb-4 text-xs text-ink-muted">{source.appId} · {new Date(source.occurredAt).toLocaleString()} · {c.status[source.visibility]}</p>
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{source.content ?? c.forgotten}</p>
    </aside>}
  </dialog>;
}
