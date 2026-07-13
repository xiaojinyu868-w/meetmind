'use client';

import React from 'react';
import { BookOpen, CircleDot, Sparkles } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import type { ClassroomFlowState, ClassroomSignalKind } from '@/types/classroom-flow';

export interface ClassroomFlowCanvasProps {
  flow: ClassroomFlowState;
  newItemIds: Set<string>;
  elapsedMs: number;
  isUnderstanding?: boolean;
}

const KIND_LABELS: Record<ClassroomSignalKind, string> = {
  definition: COPY.classroomFlow.kindDefinition,
  formula: COPY.classroomFlow.kindFormula,
  example: COPY.classroomFlow.kindExample,
  question: COPY.classroomFlow.kindQuestion,
  contrast: COPY.classroomFlow.kindContrast,
  conclusion: COPY.classroomFlow.kindConclusion,
  other: COPY.classroomFlow.kindOther,
};

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function EmptyFlow({ elapsedMs, isUnderstanding }: { elapsedMs: number; isUnderstanding: boolean }) {
  return (
    <div className="flex h-full flex-col justify-between px-6 py-7 lg:px-8 lg:py-8">
      <div>
        <div className="flex items-center justify-between gap-4">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-pine">
            {COPY.classroomFlow.eyebrow}
          </p>
          <span className="font-mono text-[11px] tabular-nums text-ink-muted">{formatTime(elapsedMs)}</span>
        </div>
        <h2 className="mt-5 max-w-[28rem] text-[28px] font-semibold tracking-[-0.045em] text-ink lg:text-[34px]">
          {COPY.classroomFlow.listeningTitle}
        </h2>
        <p className="mt-3 max-w-[34rem] text-[14px] leading-[1.8] text-ink-secondary">
          {isUnderstanding ? COPY.classroomFlow.understanding : COPY.classroomFlow.listeningBody}
        </p>
      </div>

      <div className="mt-8 border-t border-divider pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-pine-mist text-pine">
            <Sparkles size={14} strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-[13px] font-medium text-ink">{COPY.classroomFlow.emptyPromiseTitle}</p>
            <p className="mt-1 max-w-[30rem] text-[12.5px] leading-[1.7] text-ink-muted">
              {COPY.classroomFlow.emptyPromiseBody}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ClassroomFlowCanvas({
  flow,
  newItemIds,
  elapsedMs,
  isUnderstanding = false,
}: ClassroomFlowCanvasProps) {
  if (!flow.now) {
    return <EmptyFlow elapsedMs={elapsedMs} isUnderstanding={isUnderstanding} />;
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-5 lg:px-7 lg:py-6">
      <header className="flex items-center justify-between gap-4 border-b border-divider pb-4">
        <div className="flex items-center gap-2">
          <CircleDot size={14} className="text-pine" />
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-pine">
            {COPY.classroomFlow.eyebrow}
          </p>
          {isUnderstanding ? (
            <span className="text-[11.5px] text-ink-muted">{COPY.classroomFlow.refreshing}</span>
          ) : null}
        </div>
        <span className="font-mono text-[11px] tabular-nums text-ink-muted">{formatTime(elapsedMs)}</span>
      </header>

      <section
        className={`mt-5 rounded-[22px] border border-pine/20 bg-pine-mist/55 px-5 py-5 ${
          newItemIds.has(flow.now.id) ? 'animate-[fadeIn_420ms_ease-out]' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11.5px] font-semibold tracking-[0.04em] text-pine">{COPY.classroomFlow.now}</p>
          {flow.now.teachingMove ? (
            <span className="rounded-full border border-pine/15 bg-white/70 px-2.5 py-1 text-[11px] text-pine">
              {flow.now.teachingMove}
            </span>
          ) : null}
        </div>
        <h2 className="mt-3 text-[25px] font-semibold leading-[1.25] tracking-[-0.04em] text-ink lg:text-[30px]">
          {flow.now.title}
        </h2>
        {flow.now.summary ? (
          <p className="mt-3 max-w-[42rem] text-[14px] leading-[1.75] text-ink-secondary">{flow.now.summary}</p>
        ) : null}
      </section>

      {flow.recent.length > 0 ? (
        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold text-ink-secondary">{COPY.classroomFlow.recent}</h3>
            <span className="text-[11.5px] text-ink-muted">{COPY.classroomFlow.recentHint}</span>
          </div>
          <div className="relative mt-3 space-y-1 pl-5 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-divider">
            {flow.recent.map((item) => (
              <article
                key={item.id}
                className={`relative rounded-[16px] px-3 py-3 transition-colors hover:bg-paper-warm/60 ${
                  newItemIds.has(item.id) ? 'animate-[fadeIn_420ms_ease-out]' : ''
                }`}
              >
                <span className="absolute left-[-18px] top-[18px] h-2 w-2 rounded-full border-2 border-white bg-ink-muted" />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium leading-[1.5] text-ink">{item.title}</p>
                    {item.summary ? (
                      <p className="mt-1 text-[12.5px] leading-[1.65] text-ink-muted">{item.summary}</p>
                    ) : null}
                  </div>
                  <span className="flex-shrink-0 font-mono text-[10.5px] tabular-nums text-ink-muted">
                    {formatTime(item.anchorMs)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {flow.keep.length > 0 ? (
        <section className="mt-6 border-t border-divider pt-5">
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-vermilion" />
            <h3 className="text-[12px] font-semibold text-ink-secondary">{COPY.classroomFlow.keep}</h3>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {flow.keep.map((item) => (
              <article
                key={item.id}
                className={`rounded-[16px] border border-divider bg-white px-3.5 py-3.5 ${
                  newItemIds.has(item.id) ? 'animate-[fadeIn_420ms_ease-out]' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10.5px] font-medium text-vermilion">{KIND_LABELS[item.kind]}</span>
                  <span className="font-mono text-[10.5px] tabular-nums text-ink-muted">{formatTime(item.anchorMs)}</span>
                </div>
                <p className="mt-2 text-[13px] font-medium leading-[1.6] text-ink">{item.text}</p>
                {item.reason ? (
                  <p className="mt-1.5 text-[11.5px] leading-[1.6] text-ink-muted">{item.reason}</p>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default ClassroomFlowCanvas;
