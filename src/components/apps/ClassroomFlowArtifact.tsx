'use client';

import { useMemo } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Clock3, Route } from 'lucide-react';
import { usePersistedClassroomFlow } from '@/hooks/usePersistedClassroomFlow';
import { COPY } from '@/lib/ui/copy';
import type { ClassroomFlowState, ClassroomMoment, ClassroomSignalKind } from '@/types/classroom-flow';

const KIND_LABELS: Record<ClassroomSignalKind, string> = {
  definition: COPY.classroomFlow.kindDefinition,
  formula: COPY.classroomFlow.kindFormula,
  example: COPY.classroomFlow.kindExample,
  question: COPY.classroomFlow.kindQuestion,
  contrast: COPY.classroomFlow.kindContrast,
  conclusion: COPY.classroomFlow.kindConclusion,
  other: COPY.classroomFlow.kindOther,
};

interface ClassroomFlowMatrixEntryProps {
  sessionId: string;
  onOpen: (flow: ClassroomFlowState) => void;
  compact?: boolean;
}

interface ClassroomFlowReviewWorkspaceProps {
  flow: ClassroomFlowState;
  contextTitle?: string;
  onBack: () => void;
  onSeek?: (timeMs: number) => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function buildTimeline(flow: ClassroomFlowState): ClassroomMoment[] {
  const moments = new Map(flow.recent.map((moment) => [moment.id, moment]));
  if (flow.now) moments.set(flow.now.id, flow.now);
  return [...moments.values()].sort((a, b) => a.anchorMs - b.anchorMs);
}

export function ClassroomFlowMatrixEntry({
  sessionId,
  onOpen,
  compact = false,
}: ClassroomFlowMatrixEntryProps) {
  const flow = usePersistedClassroomFlow(sessionId);
  if (!flow) return null;

  const momentCount = flow.recent.length + (flow.now ? 1 : 0);
  return (
    <section className={compact ? 'mb-3' : 'mb-6'} aria-labelledby="classroom-flow-artifact-title">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <h3 id="classroom-flow-artifact-title" className="text-[12px] font-semibold text-ink">
          {COPY.apps.classroomFlowArtifact.sectionTitle}
        </h3>
        <span className="text-[11px] text-pine">{COPY.apps.classroomFlowArtifact.ready}</span>
      </div>
      <button
        type="button"
        onClick={() => onOpen(flow)}
        className="group flex w-full items-center gap-3.5 rounded-[20px] border border-pine/25 bg-white px-4 py-4 text-left shadow-soft transition hover:border-pine/40 active:scale-[0.99]"
        data-testid="classroom-flow-artifact-entry"
      >
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px] bg-pine-mist text-pine" aria-hidden>
          <Route size={21} strokeWidth={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{COPY.apps.classroomFlowArtifact.name}</span>
          <span className="mt-1 block text-[12px] leading-5 text-ink-muted">
            {COPY.apps.classroomFlowArtifact.cardSummary(momentCount, flow.keep.length)}
          </span>
        </span>
        <span className="inline-flex flex-shrink-0 items-center gap-1 text-[12px] font-semibold text-pine">
          {COPY.apps.classroomFlowArtifact.open}
          <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
        </span>
      </button>
    </section>
  );
}

export function ClassroomFlowReviewWorkspace({
  flow,
  contextTitle,
  onBack,
  onSeek,
}: ClassroomFlowReviewWorkspaceProps) {
  const timeline = useMemo(() => buildTimeline(flow), [flow]);
  const title = flow.title || contextTitle || COPY.apps.classroomFlowArtifact.name;

  return (
    <section className="flex h-full min-h-0 flex-col bg-paper" data-testid="classroom-flow-artifact-workspace">
      <header className="flex-shrink-0 border-b border-divider bg-white px-4 py-3 sm:px-6">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-ink-muted transition hover:bg-paper-warm hover:text-ink"
            aria-label={COPY.apps.classroomFlowArtifact.back}
          >
            <ArrowLeft size={17} strokeWidth={1.8} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-pine">
              {COPY.apps.classroomFlowArtifact.ready}
            </p>
            <h2 className="mt-1 truncate text-[20px] font-semibold tracking-[-0.025em] text-ink">{title}</h2>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">
              {COPY.apps.classroomFlowArtifact.reviewSummary(timeline.length, flow.keep.length)}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-[760px]">
          <div className="flex items-center gap-2">
            <Clock3 size={14} className="text-pine" aria-hidden />
            <h3 className="text-[13px] font-semibold text-ink">{COPY.apps.classroomFlowArtifact.timelineTitle}</h3>
          </div>
          <div className="relative mt-4 space-y-1 pl-6 before:absolute before:bottom-4 before:left-[7px] before:top-4 before:w-px before:bg-divider">
            {timeline.map((moment) => (
              <article
                key={moment.id}
                className="relative rounded-[16px] px-3 py-3.5 [contain-intrinsic-size:76px] [content-visibility:auto]"
              >
                <span className="absolute left-[-21px] top-[20px] h-2.5 w-2.5 rounded-full border-2 border-paper bg-pine" aria-hidden />
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium leading-6 text-ink">{moment.title}</p>
                    {moment.summary ? <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">{moment.summary}</p> : null}
                  </div>
                  {onSeek ? (
                    <button type="button" onClick={() => onSeek(moment.anchorMs)} className="cite-ts flex-shrink-0">
                      {formatTime(moment.anchorMs)}
                    </button>
                  ) : (
                    <span className="cite-ts flex-shrink-0">{formatTime(moment.anchorMs)}</span>
                  )}
                </div>
              </article>
            ))}
          </div>

          {flow.keep.length > 0 ? (
            <section className="mt-7 border-t border-divider pt-6">
              <div className="flex items-center gap-2">
                <BookOpen size={15} className="text-vermilion" aria-hidden />
                <h3 className="text-[13px] font-semibold text-ink">{COPY.apps.classroomFlowArtifact.keepTitle}</h3>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {flow.keep.map((item) => (
                  <article key={item.id} className="rounded-[16px] border border-divider bg-white px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-medium text-vermilion">{KIND_LABELS[item.kind]}</span>
                      {onSeek ? (
                        <button type="button" onClick={() => onSeek(item.anchorMs)} className="cite-ts flex-shrink-0">
                          {formatTime(item.anchorMs)}
                        </button>
                      ) : (
                        <span className="cite-ts flex-shrink-0">{formatTime(item.anchorMs)}</span>
                      )}
                    </div>
                    <p className="mt-2 text-[13px] font-medium leading-5 text-ink">{item.text}</p>
                    {item.reason ? <p className="mt-1 text-[12px] leading-5 text-ink-muted">{item.reason}</p> : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
