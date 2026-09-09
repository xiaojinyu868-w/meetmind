'use client';

import { useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import type { UserContextBundle } from '@/types/context';

interface Props {
  bundle: UserContextBundle | null;
  loading: boolean;
  busy: boolean;
  inspect: (id: string) => void;
}

export function ContextPortrait({ bundle, loading, busy, inspect }: Props) {
  const c = COPY.sharedContext;
  const [expanded, setExpanded] = useState(false);
  const sources = new Map(bundle?.sources.map((source) => [source.id, source]));
  const memories = [...(bundle?.memories ?? [])].sort((a, b) => {
    const latest = (ids: string[]): number => Math.max(0, ...ids.map((id) => Date.parse(sources.get(id)?.occurredAt ?? '') || 0));
    return latest(b.sourceEventIds) - latest(a.sourceEventIds);
  });
  return <section aria-labelledby="portrait-heading" className="mb-12">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="mb-2 text-xs tracking-widest text-pine">{c.subtitle}</p>
        <h2 id="portrait-heading" className="text-2xl font-semibold tracking-tight">{c.portraitHeading}</h2></div>
      <p className="max-w-sm text-xs leading-5 text-ink-muted">{c.portraitHint}</p>
    </div>
    <div data-testid="context-portrait" aria-live="polite">
      {loading ? <p role="status" className="rounded-3xl border border-divider bg-card px-7 py-14 text-ink-secondary">{c.portraitLoading}</p> :
        !bundle ? <p className="rounded-3xl border border-divider bg-card p-7 text-ink-secondary">{c.portraitUnavailable}</p> : <>
          {bundle.degraded && <p className="mb-4 rounded-2xl border border-divider p-4 text-sm text-ink-secondary">{c.degraded}</p>}
          {bundle.pendingEventIds.length > 0 && <p className="mb-4 text-sm text-ink-muted">{c.portraitPending}</p>}
          {bundle.memories.length === 0 ? <div className="rounded-3xl border border-divider bg-card px-7 py-12 sm:px-10">
            <div aria-hidden="true" className="mb-6 flex h-12 w-12 items-center justify-center rounded-full border border-pine text-2xl text-pine">◎</div>
            <h3 className="text-xl font-medium">{c.portraitEmpty}</h3><p className="mt-3 max-w-lg text-sm leading-7 text-ink-secondary">{c.portraitEmptyBody}</p>
          </div> : <div className="grid gap-4 md:grid-cols-2">
            {(expanded ? memories : memories.slice(0, 3)).map((memory, index) => <article key={memory.id}
              className={`flex flex-col rounded-3xl border border-divider bg-card p-6 sm:p-8 ${index === 0 ? 'md:col-span-2' : ''}`}>
              <p className="mb-4 text-xs text-pine">{index === 0 ? c.latestUnderstanding : c.connections}</p>
              <p className={`whitespace-pre-wrap break-words leading-relaxed ${index === 0 ? 'max-w-3xl text-xl sm:text-2xl' : 'text-base'}`}>{memory.text.split(/\s+\|\s+(?:When:|Involving:)/)[0]}</p>
              {/\s+\|\s+(?:When:|Involving:)/.test(memory.text) && <details className="mt-3 text-xs leading-6 text-ink-muted"><summary className="cursor-pointer">{c.memoryDetail}</summary><p className="mt-2 break-words">{memory.text}</p></details>}
              <div className="mt-6 flex flex-wrap gap-2 border-t border-divider pt-4">
                {memory.sourceEventIds.map((id) => {
                  const source = sources.get(id);
                  return <button key={id} disabled={busy} onClick={() => inspect(id)}
                    className="max-w-full truncate rounded-full border border-divider px-3 py-1.5 text-xs text-pine hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-pine disabled:opacity-40">
                    {source?.source?.title ?? c.sources}{source ? ` · ${new Date(source.occurredAt).toLocaleDateString()}` : ''}
                  </button>;
                })}
              </div>
            </article>)}
          </div>}
          {!expanded && memories.length > 3 && <button className="mt-4 rounded-full border border-divider px-4 py-2 text-sm text-pine" onClick={() => setExpanded(true)}>{c.moreUnderstanding(memories.length - 3)}</button>}
        </>}
    </div>
  </section>;
}
