'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  applyReviewPaneDrag,
  getDefaultReviewPaneLayout,
  restoreReviewPane,
  type ReviewPaneDivider,
  type ReviewPaneLayout,
  type ReviewPaneMode,
} from './desktop-video-review-layout-model';

interface ReviewThreePaneLayoutProps {
  mode: ReviewPaneMode;
  source: ReactNode;
  workspace: ReactNode;
  tutor: ReactNode;
  sourceLabel?: string;
  workspaceLabel?: string;
  tutorLabel?: string;
  storageKey: string;
}

const RAIL_PX = 46;
const DIVIDER_PX = 8;

function readStoredLayout(storageKey: string, mode: ReviewPaneMode): ReviewPaneLayout {
  if (typeof window === 'undefined') return getDefaultReviewPaneLayout(mode);
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return getDefaultReviewPaneLayout(mode);
    const parsed = JSON.parse(raw) as Partial<ReviewPaneLayout>;
    if (typeof parsed.source !== 'number' || typeof parsed.workspace !== 'number' || typeof parsed.tutor !== 'number') {
      return getDefaultReviewPaneLayout(mode);
    }
    return {
      source: parsed.source,
      workspace: parsed.workspace,
      tutor: parsed.tutor,
      workspaceCollapsed: parsed.workspaceCollapsed === true,
      tutorCollapsed: parsed.tutorCollapsed === true,
    };
  } catch {
    return getDefaultReviewPaneLayout(mode);
  }
}

function PaneRail({ label, onRestore }: { label: string; onRestore: () => void }) {
  return (
    <button
      type="button"
      onClick={onRestore}
      className="flex h-full w-full items-center justify-center border-l border-divider bg-canvas text-[12px] font-medium tracking-[0.08em] text-ink-muted transition hover:bg-white hover:text-ink"
      title={`展开${label}`}
      aria-label={`展开${label}`}
    >
      <span className="[writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}

export function ReviewThreePaneLayout({
  mode,
  source,
  workspace,
  tutor,
  sourceLabel = '证据',
  workspaceLabel = '学习',
  tutorLabel = '同桌',
  storageKey,
}: ReviewThreePaneLayoutProps) {
  const [layout, setLayout] = useState<ReviewPaneLayout>(() => readStoredLayout(storageKey, mode));
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ divider: ReviewPaneDivider; startX: number; startLayout: ReviewPaneLayout } | null>(null);

  const persist = useCallback((next: ReviewPaneLayout) => {
    setLayout(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    }
  }, [storageKey]);

  const startDrag = useCallback((divider: ReviewPaneDivider, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { divider, startX: event.clientX, startLayout: layout };
  }, [layout]);

  const onDragMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    const width = rootRef.current?.getBoundingClientRect().width || 0;
    if (!drag || width <= 0) return;
    const deltaPercent = ((event.clientX - drag.startX) / width) * 100;
    persist(applyReviewPaneDrag(drag.startLayout, drag.divider, deltaPercent, mode));
  }, [mode, persist]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const gridTemplateColumns = useMemo(() => {
    const workspaceColumn = layout.workspaceCollapsed ? `${RAIL_PX}px` : `minmax(260px, ${layout.workspace}fr)`;
    const tutorColumn = layout.tutorCollapsed ? `${RAIL_PX}px` : `minmax(280px, ${layout.tutor}fr)`;
    return `minmax(320px, ${layout.source}fr) ${DIVIDER_PX}px ${workspaceColumn} ${DIVIDER_PX}px ${tutorColumn}`;
  }, [layout]);

  return (
    <div
      ref={rootRef}
      className="grid min-h-0 flex-1 overflow-hidden bg-white"
      style={{ gridTemplateColumns }}
      data-review-pane-mode={mode}
    >
      <section className="min-w-0 min-h-0 overflow-hidden bg-white" aria-label={sourceLabel}>
        {source}
      </section>

      <button
        type="button"
        className="group flex cursor-col-resize items-stretch justify-center bg-white transition hover:bg-canvas"
        onPointerDown={(event) => startDrag('source-workspace', event)}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="拖拽调整证据和学习区宽度"
      >
        <span className="my-3 w-px rounded-full bg-divider transition group-hover:bg-ink-muted" />
      </button>

      <section className={cn('min-w-0 min-h-0 overflow-hidden bg-white', layout.workspaceCollapsed && 'w-full')} aria-label={workspaceLabel}>
        {layout.workspaceCollapsed ? (
          <PaneRail label={workspaceLabel} onRestore={() => persist(restoreReviewPane(layout, 'workspace', mode))} />
        ) : workspace}
      </section>

      <button
        type="button"
        className="group flex cursor-col-resize items-stretch justify-center bg-white transition hover:bg-canvas"
        onPointerDown={(event) => startDrag('workspace-tutor', event)}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="拖拽调整学习区和同桌宽度"
      >
        <span className="my-3 w-px rounded-full bg-divider transition group-hover:bg-ink-muted" />
      </button>

      <aside className="min-w-0 min-h-0 overflow-hidden bg-white" aria-label={tutorLabel}>
        {layout.tutorCollapsed ? (
          <PaneRail label={tutorLabel} onRestore={() => persist(restoreReviewPane(layout, 'tutor', mode))} />
        ) : tutor}
      </aside>
    </div>
  );
}
