'use client';

import { useState } from 'react';
import { ArrowLeft, Check, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useLearningContext } from '@/hooks/useLearningContext';
import { COPY } from '@/lib/ui/copy';

interface LearningMemoryPanelProps {
  onBack: () => void;
  onResumeThread?: () => void;
}

export function LearningMemoryPanel({ onBack, onResumeThread }: LearningMemoryPanelProps) {
  const context = useLearningContext();
  const [draft, setDraft] = useState('');

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex items-start gap-3 border-b border-divider bg-white px-5 py-4">
        <button type="button" onClick={onBack} className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-divider text-ink-muted hover:text-pine" aria-label={COPY.globalAsk.memoryBack}>
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-ink">{COPY.globalAsk.memoryTitle}</h2>
          <p className="mt-1 max-w-xl text-[12px] leading-5 text-ink-muted">{COPY.globalAsk.memorySubtitle}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-2xl space-y-6">
          {context.activeThread?.status === 'active' ? (
            <section className="rounded-[18px] border border-pine/15 bg-pine-fog px-4 py-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine">{COPY.globalAsk.threadTitle}</p>
              <p className="mt-2 text-[15px] font-semibold text-ink">{context.activeThread.title}</p>
              {context.activeThread.lastSummary ? <p className="mt-1 text-[12.5px] leading-5 text-ink-secondary">{context.activeThread.lastSummary}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {onResumeThread ? <button type="button" onClick={onResumeThread} className="rounded-full bg-pine px-3.5 py-2 text-[11.5px] font-medium text-white">{COPY.globalAsk.threadResume}</button> : null}
                <button
                  type="button"
                  onClick={() => void context.setActiveThread({ ...context.activeThread!, status: 'completed', updatedAt: new Date().toISOString() })}
                  className="rounded-full border border-divider bg-white px-3.5 py-2 text-[11.5px] text-ink-secondary"
                >
                  {COPY.globalAsk.threadComplete}
                </button>
              </div>
            </section>
          ) : null}

          <section>
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={COPY.globalAsk.memoryInput}
                className="min-w-0 flex-1 rounded-xl border border-divider bg-white px-3.5 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-muted focus:border-pine/35"
              />
              <button
                type="button"
                disabled={!draft.trim() || context.saving}
                onClick={() => {
                  const value = draft.trim();
                  if (!value) return;
                  setDraft('');
                  void context.addMemory({ kind: 'preference', title: value, source: 'user' });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-pine px-3.5 text-[12px] font-medium text-white disabled:opacity-40"
              >
                <Plus size={14} />{COPY.globalAsk.memoryAdd}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {context.memories.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-divider bg-white px-4 py-6 text-center text-[12px] leading-5 text-ink-muted">{COPY.globalAsk.memoryEmpty}</div>
              ) : context.memories.slice().reverse().map((memory) => (
                <article key={memory.id} className="flex items-start gap-3 rounded-2xl border border-divider bg-white px-4 py-3.5">
                  <span className={`mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${memory.status === 'active' ? 'bg-pine-mist text-pine' : 'bg-paper-deep text-ink-muted'}`}>
                    {memory.status === 'active' ? <Check size={12} /> : <Pause size={11} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13.5px] leading-5 ${memory.status === 'active' ? 'text-ink' : 'text-ink-muted'}`}>{memory.title}</p>
                    {memory.detail ? <p className="mt-1 text-[11.5px] leading-5 text-ink-muted">{memory.detail}</p> : null}
                    <p className="mt-1.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-muted">{memory.status === 'active' ? COPY.globalAsk.memoryActive : COPY.globalAsk.memoryPaused}</p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void context.updateMemory(memory.id, { status: memory.status === 'active' ? 'paused' : 'active' })}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-pine"
                      aria-label={memory.status === 'active' ? COPY.globalAsk.memoryPause : COPY.globalAsk.memoryResume}
                      title={memory.status === 'active' ? COPY.globalAsk.memoryPause : COPY.globalAsk.memoryResume}
                    >
                      {memory.status === 'active' ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void context.removeMemory(memory.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-vermilion-fog hover:text-vermilion"
                      aria-label={COPY.globalAsk.memoryDelete}
                      title={COPY.globalAsk.memoryDelete}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[12px] font-semibold text-ink-secondary">{COPY.globalAsk.recentTitle}</h3>
            <div className="mt-2 space-y-1.5">
              {context.recentActivities.length === 0 ? (
                <p className="rounded-xl bg-paper-warm px-3 py-3 text-[11.5px] text-ink-muted">{COPY.globalAsk.recentEmpty}</p>
              ) : context.recentActivities.slice(-8).reverse().map((activity) => (
                <div key={activity.id} className="rounded-xl border border-divider bg-white px-3.5 py-3">
                  <p className="text-[12.5px] text-ink-secondary">{activity.title}</p>
                  {activity.detail ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-ink-muted">{activity.detail}</p> : null}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
