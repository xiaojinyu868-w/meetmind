'use client';

/**
 * TeachBackRecord — 评委席下面的对话记录 + 讲完了以后的整场转写与三个动作。
 *
 * 对话记录：评委说完、脚下那段话淡下去之后滑进这里——时间倒序，每条 24px 肖像 + 一两句 13px 灰字 + mm:ss；
 * 被打断没说完的收成一行灰字。默认只露最近几条（RECORD_FOLD_LIMIT），点一下能看全场。
 * 讲完了以后：记录下面出现「整场转写」折叠项（默认收起；点一条有回合的记录会展开并高亮那一段）和
 * 再讲一次 / 只讲没讲清的 / 回到目标。
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { NextStepCard, type NextStepCardProps } from './NextStepCard';
import { formatEvidenceTimestamp } from './teach-back-window-model';
import { foldRecord, formatClock, type RecordEntry, type TranscriptTurn } from './teach-back-room-model';
import { Portrait } from './TeachBackBench';

/* ── 对话记录 ── */

interface RecordProps {
  entries: RecordEntry[];
  compact: boolean;
  /** 点一条（对着你哪一段说的）→ 讲完了以后展开整场转写并高亮那一段 */
  onSelectTurn?: (turnIndex: number) => void;
  /** 复盘条目里可回到课堂原声的证据（entry.id → 时间点） */
  evidence?: Record<string, number[]>;
  /** 复盘条目说的是第几张手卡（entry.id → 卡号，从 1 起） */
  cueNumbers?: Record<string, number[]>;
  onSeek?: (startMs: number) => void;
}

export function TeachBackRecord({ entries, compact, onSelectTurn, evidence, cueNumbers, onSeek }: RecordProps) {
  const copy = APPS_COPY.teachBack;
  const [expanded, setExpanded] = useState(false);
  const { shown, hidden } = foldRecord(entries, expanded);
  if (entries.length === 0) return null;
  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[560px] px-5' : 'max-w-[640px] px-6'}`} data-testid="teach-back-record" data-count={entries.length}>
      <ol className="flex flex-col divide-y divide-divider/70">
        {shown.map((entry) => {
          const clickable = Boolean(onSelectTurn) && entry.turnIndex !== null;
          const marks = evidence?.[entry.id] ?? [];
          const cues = cueNumbers?.[entry.id] ?? [];
          return (
            <li key={entry.id} className="mm-pop-in py-2.5" data-testid="teach-back-record-entry" data-judge={entry.judgeId} data-kind={entry.kind} data-interrupted={entry.interrupted || undefined}>
              <div className="group flex items-start gap-3">
                <Portrait judgeId={entry.judgeId} mood="speaking" size={24} className="mt-0.5" />
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => { if (entry.turnIndex !== null) onSelectTurn?.(entry.turnIndex); }}
                  title={clickable ? copy.jumpToTranscript : undefined}
                  className="mm-focus min-w-0 flex-1 rounded text-left disabled:cursor-default"
                >
                  {entry.interrupted ? (
                    <span className="block truncate text-[13px] leading-6 text-ink-muted" title={entry.text}>{entry.text}…</span>
                  ) : (
                    <span className="block whitespace-pre-wrap text-[13px] leading-6 text-ink-secondary">
                      {cues.length > 0 ? (
                        <span className="mr-2 font-mono text-[11px] text-ink-muted" aria-hidden>{cues.map((n) => String(n).padStart(2, '0')).join(' ')}</span>
                      ) : null}
                      {entry.text}
                    </span>
                  )}
                </button>
                <span className="mt-1 flex shrink-0 items-center gap-2">
                  {marks.map((startMs) => (
                    <button
                      key={startMs}
                      type="button"
                      onClick={() => onSeek?.(startMs)}
                      title={`${copy.backToEvidence} · ${formatEvidenceTimestamp(startMs)}`}
                      aria-label={`${copy.backToEvidence} ${formatEvidenceTimestamp(startMs)}`}
                      className="mm-focus rounded text-[12px] text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                    >
                      ↩
                    </button>
                  ))}
                  <span className="font-mono text-[11px] tabular-nums text-ink-muted">{formatClock(entry.at)}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          title={expanded ? copy.recordCollapse : copy.recordExpand(hidden)}
          aria-label={expanded ? copy.recordCollapse : copy.recordExpand(hidden)}
          className="mm-focus mt-1 inline-flex h-8 items-center gap-1 rounded text-ink-muted transition-colors hover:text-ink"
          data-testid="teach-back-record-toggle"
        >
          {expanded ? <ChevronDown size={14} strokeWidth={2} aria-hidden /> : <ChevronUp size={14} strokeWidth={2} aria-hidden />}
          {!expanded ? <span className="font-mono text-[11px] tabular-nums">+{hidden}</span> : null}
        </button>
      ) : null}
    </div>
  );
}

/* ── 整场转写（讲完了才有；默认收起） ── */

interface TranscriptProps {
  turns: TranscriptTurn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 从记录点过来要高亮的回合 */
  highlight: { turnIndex: number; token: number } | null;
  compact: boolean;
}

export function TeachBackTranscript({ turns, open, onOpenChange, highlight, compact }: TranscriptProps) {
  const copy = APPS_COPY.teachBack;
  const listRef = useRef<HTMLOListElement | null>(null);
  const [flash, setFlash] = useState<number | null>(null);

  useEffect(() => {
    if (!highlight || !open) return undefined;
    const target = listRef.current?.querySelector<HTMLElement>(`[data-turn-index="${highlight.turnIndex}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(highlight.turnIndex);
    const timer = window.setTimeout(() => setFlash((current) => (current === highlight.turnIndex ? null : current)), 2_400);
    return () => window.clearTimeout(timer);
  }, [highlight, open]);

  if (turns.length === 0) return null;
  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[560px] px-5' : 'max-w-[640px] px-6'}`} data-testid="teach-back-transcript" data-open={open || undefined}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className="mm-focus inline-flex h-8 items-center gap-1.5 rounded text-[12px] text-ink-muted transition-colors hover:text-ink"
        data-testid="teach-back-transcript-details"
      >
        <ChevronRight size={13} strokeWidth={2} className={`transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden />
        {copy.fullTranscript}
        <span className="font-mono text-[11px] tabular-nums">{turns.length}</span>
      </button>
      {open ? (
        <ol ref={listRef} className="mm-app-enter mt-2 flex flex-col gap-3 pb-2">
          {turns.map((turn) => (
            <li
              key={turn.turnIndex}
              data-turn-index={turn.turnIndex}
              className={`-mx-2 flex gap-3 rounded px-2 py-1 transition-colors duration-500 motion-reduce:transition-none ${flash === turn.turnIndex ? 'bg-pine-fog' : ''}`}
            >
              <span className="mt-[5px] shrink-0 font-mono text-[11px] leading-none text-ink-muted">{formatClock(turn.startedAt)}</span>
              <p className={`text-ink-secondary ${compact ? 'text-[14px] leading-6' : 'text-[14px] leading-7'}`}>{turn.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/* ── 讲完了以后的三个动作 ── */

interface EndActionsProps {
  onRetry: () => void;
  onReteachUnclear: (() => void) | null;
  onBackToTargets: () => void;
  nextStep?: NextStepCardProps;
  compact: boolean;
}

export function TeachBackEndActions({ onRetry, onReteachUnclear, onBackToTargets, nextStep, compact }: EndActionsProps) {
  const copy = APPS_COPY.teachBack;
  return (
    <div className={`mm-app-enter mx-auto w-full ${compact ? 'max-w-[560px] px-5' : 'max-w-[640px] px-6'}`} data-testid="teach-back-end-actions">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-divider pt-5">
        <button type="button" onClick={onRetry} className="mm-press mm-focus rounded-full bg-pine px-5 py-2.5 text-[13px] font-medium text-white hover:opacity-90">
          {copy.retry}
        </button>
        {onReteachUnclear ? (
          <button type="button" onClick={onReteachUnclear} className="mm-focus rounded text-[13px] font-medium text-pine underline decoration-pine/30 underline-offset-[4px] hover:decoration-pine">
            {copy.reteachUnclear}
          </button>
        ) : null}
        <button type="button" onClick={onBackToTargets} className="mm-focus rounded text-[13px] text-ink-muted transition-colors hover:text-ink">
          {copy.backToTargets}
        </button>
      </div>
      {nextStep ? <NextStepCard {...nextStep} /> : null}
    </div>
  );
}
