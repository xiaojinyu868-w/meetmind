'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { sharedContextCopy } from '@/lib/ui/shared-context-copy';
import { useSharedContext } from '@/hooks/useSharedContext';
import { ContextPortrait } from './ContextPortrait';
import { ContextEvidenceDialog } from './ContextEvidenceDialog';

const field = 'w-full rounded-xl border border-divider bg-card px-4 py-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-pine';
const button = 'rounded-full bg-pine px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40';
const smallButton = 'rounded-full border border-divider px-3 py-1.5 text-xs text-ink-secondary disabled:opacity-40';

export function SharedContextPanel() {

  const [note, setNote] = useState('');
  const [space, setSpace] = useState('personal');
  const [spaceDraft, setSpaceDraft] = useState('personal');
  const context = useSharedContext(space);
  const [task, setTask] = useState('');
  const [appId, setAppId] = useState('');
  const [write, setWrite] = useState(false);
  const c = sharedContextCopy;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await context.append(note.trim(), space)) setNote('');
  }

  return <main className="min-h-screen bg-paper px-5 py-10 text-ink sm:px-10">
    <div className="mx-auto max-w-5xl">
      <Link href="/app" className="text-sm text-pine">← {c.back}</Link>
      <header className="mb-10 mt-10 max-w-2xl">
        <p className="mb-3 text-sm text-pine">{c.subtitle}</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{c.title}</h1>
        <p className="mt-4 leading-7 text-ink-secondary">{c.intro}</p>
      </header>
      {context.isCheckingAuth ? <p role="status">{c.loading}</p> : !context.signedIn ?
        <Link className={button} href="/login">{c.login}</Link> : <>
          {context.error && <p role="alert" className="mb-5 rounded-xl border border-divider bg-card p-4 text-sm text-vermilion">{c.errors[context.error] ?? c.error}</p>}
          <div className="mb-7 flex items-center justify-between gap-4">
            <span className="rounded-full border border-divider px-3 py-1 text-xs text-ink-secondary">{space}</span>
            <button className={smallButton} disabled={context.busy} onClick={() => void context.refresh()}>{c.refresh}</button>
          </div>
          <ContextPortrait key={space} bundle={context.portrait} loading={context.loadingPortrait} busy={context.busy} inspect={(id) => void context.inspectSource(id)} />
          <div className="grid gap-10 md:grid-cols-2">
            <section>
              <details className="mb-8"><summary className="cursor-pointer text-sm font-medium text-pine">{c.supplement}</summary><p className="my-3 text-sm leading-6 text-ink-secondary">{c.supplementHint}</p><form onSubmit={(event) => void save(event)} className="mb-9 rounded-2xl border border-divider bg-card p-5 space-y-3">
                <div><h2 className="text-lg font-medium">{c.addTitle}</h2><p className="mt-1 text-sm leading-6 text-ink-secondary">{c.addBody}</p></div>
                <label htmlFor="context-note" className="sr-only">{c.note}</label>
                <textarea id="context-note" className={`${field} min-h-32 resize-y`} value={note} onChange={(event) => setNote(event.target.value)} placeholder={c.notePlaceholder} maxLength={40_000} required />
                <button className={button} disabled={context.busy || !note.trim() || !space}>{c.save}</button>
              </form>
              </details><h2 className="mb-2 text-lg font-medium">{c.history}</h2><p className="mb-5 text-xs leading-5 text-ink-muted">{c.timelineHint}</p>
              {!context.events.length && <p className="text-sm leading-6 text-ink-secondary">{c.empty}</p>}
              <div className="space-y-3">
                {context.events.filter((event) => event.spaceId === space).map((event) => <article id={`source-${event.id}`} key={event.id} className="scroll-mt-6 rounded-2xl border border-divider bg-card p-5">
                  <p className="mb-3 text-xs text-ink-muted">{new Date(event.occurredAt).toLocaleString()} · {event.appId} · {event.spaceId}</p>
                  {event.source && <h3 className="mb-2 font-medium">{event.source.title}</h3>}
                  <button className="text-sm text-pine underline-offset-4 hover:underline" disabled={context.busy} onClick={() => void context.inspectSource(event.id)}>{c.inspect}</button>
                  <p className="mt-4 text-xs text-pine">{c.status[event.visibility]}{event.visibility === 'active' ? ` · ${c.status[event.status]}` : ''}</p>
                  {event.cleanupPending && <p className="mt-2 text-xs text-ink-muted">{c.cleaning}</p>}
                  {event.visibility !== 'forgotten' && <div className="mt-3 flex gap-2">
                    <button className={smallButton} disabled={context.busy} onClick={() => void context.control(event.id, event.visibility === 'paused' ? 'resume' : 'pause')}>{event.visibility === 'paused' ? c.resume : c.pause}</button>
                    <button className={smallButton} disabled={context.busy} onClick={() => { if (window.confirm(c.forgetQuestion)) void context.control(event.id, 'forget'); }}>{c.forget}</button>
                  </div>}
                </article>)}
              </div>
              {context.nextCursor && <button className={`${smallButton} mt-4`} disabled={context.busy} onClick={() => void context.loadMore()}>{c.more}</button>}
            </section>
            <section>
              <h2 className="mb-4 text-lg font-medium">{c.tryTitle}</h2>
              <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void context.prepare(task, space); }}>
                <label htmlFor="context-task" className="sr-only">{c.task}</label>
                <textarea id="context-task" className={`${field} min-h-32`} value={task} onChange={(event) => setTask(event.target.value)} placeholder={c.taskPlaceholder} maxLength={4_000} required />
                <button className={button} disabled={context.busy || !task.trim() || !space}>{c.prepare}</button>
              </form>
              {context.bundle && <div data-testid="context-task-result" aria-live="polite" className="mt-6 space-y-4 rounded-2xl border border-divider bg-card p-5">
                {context.bundle.degraded && <p className="text-sm leading-6 text-ink-secondary">{c.degraded}</p>}
                <h3 className="font-medium">{c.memories}</h3>
                {!context.bundle.memories.length && <p className="text-sm text-ink-muted">{c.noMemories}</p>}
                {context.bundle.memories.map((memory) => <article key={memory.id} className="border-b border-divider pb-4">
                  <p className="whitespace-pre-wrap text-sm leading-6">{memory.text}</p>
                  <div className="mt-2 flex flex-wrap gap-3">{memory.sourceEventIds.map((id, index) => <button key={id} disabled={context.busy} onClick={() => void context.inspectSource(id)} className="text-xs text-pine">{c.sources} {index + 1}</button>)}</div>
                </article>)}
                {context.bundle.observations.length > 0 && <><h3 className="font-medium">{c.originals}</h3>
                  {context.bundle.observations.map((observation) => <p key={observation.id} className="whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{observation.content}</p>)}
                </>}
              </div>}
              <details className="mt-10 border-t border-divider pt-6">
                <summary className="cursor-pointer font-medium">{c.settings}</summary>
                <form className="mt-4 flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setSpace(spaceDraft); }}>
                  <label className="min-w-0 flex-1 text-xs text-ink-secondary">{c.space}<input className={`${field} mt-2`} value={spaceDraft} onChange={(event) => setSpaceDraft(event.target.value)} pattern="[\w.:\-]{1,120}" maxLength={120} required /></label>
                  <button className={`${smallButton} shrink-0`} disabled={context.busy}>{c.spaceApply}</button>
                </form>
                <h3 className="mt-6 font-medium">{c.developers}</h3>
                <p className="my-4 text-sm leading-6 text-ink-secondary">{c.developerIntro}</p>
                <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void context.grant(appId, space, write); }}>
                  <label htmlFor="context-app" className="text-xs text-ink-secondary">{c.appId}</label>
                  <input id="context-app" className={field} value={appId} onChange={(event) => setAppId(event.target.value)} pattern="[a-z0-9][a-z0-9._\-]{0,59}" required />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} />{c.allowWrite}</label>
                  <button className={smallButton} disabled={context.busy || !appId || !space}>{c.createGrant}</button>
                </form>
                {context.issuedToken && <div className="my-4 rounded-xl border border-divider bg-card p-4">
                  <p className="mb-3 text-sm">{c.tokenNotice}</p><code className="block break-all text-xs">{context.issuedToken}</code>
                  <button className={`${smallButton} mt-3`} onClick={context.dismissToken}>{c.dismiss}</button>
                </div>}
                {!context.grants.length && <p className="mt-4 text-sm text-ink-muted">{c.noGrants}</p>}
                {context.grants.map((grant) => <div key={grant.id} className="mt-4 border-t border-divider pt-3 text-sm">
                  <p>{grant.label} · {grant.spaceIds.join(', ')}</p>
                  <p className="my-2 text-xs text-ink-muted">{c.expires} {new Date(grant.expiresAt).toLocaleDateString()}</p>
                  {grant.revokedAt ? <span className="text-xs text-ink-muted">{c.revoked}</span> : <button className={smallButton} disabled={context.busy} onClick={() => void context.revoke(grant.id)}>{c.revoke}</button>}
                </div>)}
              </details>
            </section>
          </div>
        </>}
    </div>
    <ContextEvidenceDialog source={context.selectedSource} close={context.dismissSource} />
  </main>;
}
