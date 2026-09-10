'use client';

/**
 * TeachBackListenersColumn — 面试间的右边：听你讲的人。
 *
 * 上面是三位听众，一人一行：章鱼家族肖像（两张表情：在听 / 在说）+ 名字 + 一行人设（开场看得见，开讲后变灰）+ 此刻状态词
 * （在听 · 想问 · 在说 · 记了 N 笔 · 说几句）。状态全部来自真实事件，没有点头动画——文字 + 一枚安静的点。
 * 堆叠单栏时收成一条横排（三枚头像 + 状态词）。
 *
 * 下面是反馈流：最新的在最上，`mm:ss · 直言` + 一到三句；正在说的那条左侧一道松绿竖线，文字逐字长；
 * 被打断的收成一行灰字。点一条 → 左边转写滚到那一段。
 * 讲完了以后，反馈流上面长出「复盘」：三位听众各说各的（直言说没讲清的、引导说最稳的 + 下一步、
 * 追问说没讲到的），句子 + 细分割线，没有象限、没有颜色标签、没有分数；下面是 再讲一次 / 只讲没讲清的 / 回到目标。
 */

import { RotateCcw } from 'lucide-react';
import type { TeachBackEvaluationItem, TeachBackJudgeId } from '@/lib/ai-native/types';
import { TEACH_BACK_JUDGE_IDS } from '@/lib/ai-native/teach-back-panel';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { NextStepCard, type NextStepCardProps } from './NextStepCard';
import { formatEvidenceTimestamp } from './teach-back-window-model';
import {
  formatClock,
  shouldShowEntry,
  type FeedbackEntry,
  type ListenerStatus,
  type ReviewBlock,
  type ReviewLine,
} from './teach-back-room-model';
import type { RoomStage } from './TeachBackTranscriptColumn';

function statusWord(status: ListenerStatus, heldCount: number): string {
  const copy = APPS_COPY.teachBack;
  switch (status) {
    case 'speaking': return copy.listenerSpeaking;
    case 'thinking': return copy.listenerThinking;
    case 'noted': return copy.listenerNoted(heldCount);
    case 'closing': return copy.listenerClosing;
    default: return copy.listenerListening;
  }
}

/**
 * 听众肖像：章鱼家族（public/images/octo-buddy/judges/<代号>-<表情>.webp，192px 透明底）。
 * 直言 zhiyan（方框黑眼镜 + 红领结）/ 引导 yindao（圆金边眼镜 + 绿围巾 + 茶杯）/ 追问 zhuiwen（铅笔 + 本子），
 * 每位两张表情：在听 / 记了一笔 → listening；想问 / 在说 → speaking。两张叠放，切换 120ms 交叉淡入，
 * prefers-reduced-motion 下瞬切。不裁圆（裁圆会切掉触手），放在 paper-warm 圆角方底上；直接 <img>，不要 next/image 的模糊占位。
 */
const PORTRAIT_FILE: Record<TeachBackJudgeId, string> = { direct: 'zhiyan', guide: 'yindao', probe: 'zhuiwen' };
type PortraitMood = 'listening' | 'speaking';

export function portraitSrc(judgeId: TeachBackJudgeId, mood: PortraitMood): string {
  return `/images/octo-buddy/judges/${PORTRAIT_FILE[judgeId]}-${mood}.webp`;
}

function portraitMoodOf(status: ListenerStatus): PortraitMood {
  return status === 'speaking' || status === 'thinking' ? 'speaking' : 'listening';
}

const PORTRAIT_SIZE = { lg: 'h-12 w-12 rounded-xl', md: 'h-8 w-8 rounded-lg', sm: 'h-6 w-6 rounded-md' } as const;

function Portrait({ judgeId, mood, size }: { judgeId: TeachBackJudgeId; mood: PortraitMood; size: keyof typeof PORTRAIT_SIZE }) {
  const name = APPS_COPY.teachBack.judges[judgeId].name;
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden bg-paper-warm ${PORTRAIT_SIZE[size]}`} data-mood={mood}>
      {(['listening', 'speaking'] as PortraitMood[]).map((expression) => (
        // eslint-disable-next-line @next/next/no-img-element -- 静态 ≤11KB 透明 webp，直接 <img>：不要 next/image 的模糊占位与尺寸协商
        <img
          key={expression}
          src={portraitSrc(judgeId, expression)}
          alt={expression === mood ? name : ''}
          draggable={false}
          className={`absolute inset-0 h-full w-full object-contain p-0.5 transition-opacity duration-[120ms] ease-linear motion-reduce:transition-none ${expression === mood ? 'opacity-100' : 'opacity-0'}`}
        />
      ))}
    </span>
  );
}

/* ── 听众：三行 / 一条横排 ── */

interface ListenersProps {
  stage: RoomStage;
  statuses: Record<TeachBackJudgeId, ListenerStatus>;
  heldCounts: Record<TeachBackJudgeId, number>;
  variant: 'rows' | 'strip';
}

export function TeachBackListeners({ stage, statuses, heldCounts, variant }: ListenersProps) {
  const copy = APPS_COPY.teachBack;
  if (variant === 'strip') {
    return (
      <div className="flex items-center gap-4 overflow-x-auto px-4 py-2.5" data-testid="teach-back-listeners" data-variant="strip">
        {TEACH_BACK_JUDGE_IDS.map((id) => {
          const status = statuses[id];
          return (
            <div key={id} className="flex shrink-0 items-center gap-2" data-testid={`teach-back-listener-${id}`} data-status={status}>
              <Portrait judgeId={id} mood={portraitMoodOf(status)} size="md" />
              <div className="leading-tight">
                <p className="text-[12px] font-medium text-ink">{copy.judges[id].name}</p>
                <p className={`text-[11px] ${status === 'speaking' ? 'text-pine' : 'text-ink-muted'}`}>{statusWord(status, heldCounts[id])}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="px-5 pt-5" data-testid="teach-back-listeners" data-variant="rows">
      <p className="font-mono text-[11px] uppercase tracking-caps text-ink-muted">{copy.listenersTitle}</p>
      <ul className="mt-3 divide-y divide-divider">
        {TEACH_BACK_JUDGE_IDS.map((id) => {
          const status = statuses[id];
          const speaking = status === 'speaking';
          return (
            <li key={id} className="flex items-center gap-3 py-2.5" data-testid={`teach-back-listener-${id}`} data-status={status}>
              <Portrait judgeId={id} mood={portraitMoodOf(status)} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">{copy.judges[id].name}</p>
                <p className={`truncate text-[12px] ${stage === 'opening' ? 'text-ink-secondary' : 'text-ink-muted'}`}>{copy.judges[id].persona}</p>
              </div>
              <span className={`flex shrink-0 items-center gap-1.5 text-[12px] ${speaking ? 'text-pine' : 'text-ink-muted'}`}>
                {speaking || status === 'thinking' ? <span className={`h-1.5 w-1.5 rounded-full ${speaking ? 'bg-pine' : 'animate-pulse bg-ink-muted motion-reduce:animate-none'}`} aria-hidden /> : null}
                {statusWord(status, heldCounts[id])}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── 反馈流 ── */

interface FeedbackStreamProps {
  entries: FeedbackEntry[];
  activeJudge: TeachBackJudgeId | null;
  /** 实时反馈开着、请求在飞、还没人开口 → 顶上一条细的思考线 */
  thinking: boolean;
  liveFeedback: boolean;
  stage: RoomStage;
  onSelect: (turnIndex: number) => void;
  compact: boolean;
}

export function TeachBackFeedbackStream({ entries, activeJudge, thinking, liveFeedback, stage, onSelect, compact }: FeedbackStreamProps) {
  const copy = APPS_COPY.teachBack;
  const shown = entries.filter(shouldShowEntry);
  const bodySize = compact ? 'text-[14px] leading-6' : 'text-[15px] leading-7';
  return (
    <div data-testid="teach-back-feedback">
      {thinking ? <span className="thinking-strip mb-3 block h-1 w-24 rounded-full" aria-hidden /> : null}
      {shown.length === 0 && !thinking ? (
        <p className="text-[13px] leading-6 text-ink-muted">
          {stage === 'talking' ? (liveFeedback ? copy.feedbackEmptyLive : copy.feedbackEmptyHeld) : ''}
        </p>
      ) : null}
      <ol className="flex flex-col">
        {shown.map((entry) => {
          const speakingNow = entry.state === 'streaming' && !entry.held && activeJudge === entry.judgeId;
          const interrupted = entry.state === 'interrupted';
          const clickable = entry.turnIndex !== null;
          return (
            <li
              key={entry.id}
              className={`mm-pop-in border-l-2 py-3 pl-3 transition-colors ${speakingNow ? 'border-pine' : 'border-transparent'}`}
              data-testid={`teach-back-feedback-${entry.id}`}
              data-judge={entry.judgeId}
              data-state={entry.state}
            >
              <button
                type="button"
                onClick={() => { if (entry.turnIndex !== null) onSelect(entry.turnIndex); }}
                disabled={!clickable}
                title={clickable ? copy.jumpToTranscript : undefined}
                className="mm-focus flex w-full gap-2.5 rounded text-left disabled:cursor-default"
              >
                <Portrait judgeId={entry.judgeId} mood="speaking" size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[12px] text-ink-muted">
                    {formatClock(entry.at)} · <span className={speakingNow ? 'text-pine' : ''}>{copy.judges[entry.judgeId].name}</span>
                  </span>
                  {interrupted ? (
                    <span className="mt-0.5 block text-[13px] text-ink-muted" title={entry.text}>{copy.feedbackInterrupted}</span>
                  ) : (
                    <span className={`mt-1 block text-ink ${bodySize}`}>{entry.text}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── 复盘：evaluate 结果改写成三位听众各自的话 ── */

interface ReviewProps {
  blocks: ReviewBlock[] | null;
  evaluating: boolean;
  evalStage: number;
  evalFailed: boolean;
  rateLimited: boolean;
  teachingChars: number;
  onRetryEval: () => void;
  onSelectTurn: (turnIndex: number) => void;
  onSeek?: (startMs: number) => void;
  /** 复盘朗读中正在说的那位（出声关着 = null）：肖像换 speaking */
  speakingJudge: TeachBackJudgeId | null;
  compact: boolean;
}

function EvidenceMark({ item, onSeek }: { item: TeachBackEvaluationItem; onSeek?: (startMs: number) => void }) {
  if (!item.evidence || !onSeek) return null;
  const startMs = item.evidence.startMs;
  return (
    <button
      type="button"
      onClick={() => onSeek(startMs)}
      title={`${APPS_COPY.teachBack.backToEvidence} · ${formatEvidenceTimestamp(startMs)}`}
      aria-label={`${APPS_COPY.teachBack.backToEvidence} ${formatEvidenceTimestamp(startMs)}`}
      className="ml-2 text-[12px] text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-ink"
    >
      ↩
    </button>
  );
}

/**
 * 复盘里的一句：没讲清的那几条主句是 evaluate 的核对结论（note，基于证据的事实），目标点退成下面一行小字；
 * 没讲到的只有目标点（note 只会是"没讲到"）。可点的（原话里找得到那一段）带一道细下划线。
 */
function ReviewSentence({ line, onSelectTurn, onSeek, size, withNote }: { line: ReviewLine; onSelectTurn: (turnIndex: number) => void; onSeek?: (startMs: number) => void; size: string; withNote: boolean }) {
  const clickable = line.turnIndex !== null;
  const note = withNote ? line.item.note.trim() : '';
  return (
    <div className="group flex items-start" data-testid="teach-back-review-line" data-turn={line.turnIndex ?? undefined}>
      <button
        type="button"
        disabled={!clickable}
        onClick={() => { if (line.turnIndex !== null) onSelectTurn(line.turnIndex); }}
        title={clickable ? APPS_COPY.teachBack.jumpToTranscript : undefined}
        className={`mm-focus min-w-0 flex-1 rounded text-left ${clickable ? '' : 'cursor-default'}`}
      >
        <span className={`text-ink ${size} ${clickable ? 'underline decoration-divider underline-offset-[4px] group-hover:decoration-ink' : ''}`}>{note || line.item.point}</span>
        {note ? <span className="mt-0.5 block text-[12px] leading-5 text-ink-muted">{line.item.point}</span> : null}
      </button>
      <EvidenceMark item={line.item} onSeek={onSeek} />
    </div>
  );
}

export function TeachBackReview({ blocks, evaluating, evalStage, evalFailed, rateLimited, teachingChars, onRetryEval, onSelectTurn, onSeek, speakingJudge, compact }: ReviewProps) {
  const copy = APPS_COPY.teachBack;
  const size = compact ? 'text-[14px] leading-6' : 'text-[15px] leading-7';
  if (evaluating || evalFailed) {
    const stageCopy = [copy.evaluating, copy.evaluatingStage2, copy.evaluatingStage3][Math.min(evalStage, 2)];
    return (
      <section className="pb-5" data-testid="teach-back-evaluating">
        <p className="font-mono text-[11px] uppercase tracking-caps text-ink-muted">{copy.reviewTitle}</p>
        {evalFailed ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-[13px] leading-6 text-ink-secondary">{rateLimited ? copy.evalRateLimited : copy.evalFailed}</p>
            <p className="text-[12px] text-ink-muted">{copy.yourTeachingStats(teachingChars)}</p>
            <button type="button" onClick={onRetryEval} className="mm-focus inline-flex w-fit items-center gap-1.5 rounded text-[13px] font-medium text-pine">
              <RotateCcw size={13} strokeWidth={2} aria-hidden />
              {copy.retryEval}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <span className="thinking-strip block h-1 w-24 rounded-full" aria-hidden />
            <p className="text-[13px] leading-6 text-ink-secondary">{stageCopy}</p>
          </div>
        )}
      </section>
    );
  }
  if (!blocks) return null;
  return (
    <section className="mm-stagger pb-5" data-testid="teach-back-review">
      <p className="font-mono text-[11px] uppercase tracking-caps text-ink-muted">{copy.reviewTitle}</p>
      <div className="mt-2 divide-y divide-divider">
        {blocks.map((block) => (
          <div key={block.judgeId} className="flex gap-3 py-4" data-testid={`teach-back-review-${block.judgeId}`}>
            <Portrait judgeId={block.judgeId} mood={speakingJudge === block.judgeId ? 'speaking' : 'listening'} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-ink">{copy.judges[block.judgeId].name}</p>
              <div className={`mt-1 flex flex-col gap-1.5 ${size}`}>
                {block.kind === 'unclear' ? (
                  block.lines.length === 0
                    ? <p className="text-ink">{copy.reviewUnclearNone}</p>
                    : (
                      <>
                        <p className="text-ink">{copy.reviewUnclearLead(block.lines.length)}</p>
                        {block.lines.map((line) => <ReviewSentence key={line.item.targetId} line={line} onSelectTurn={onSelectTurn} onSeek={onSeek} size={size} withNote />)}
                      </>
                    )
                ) : null}
                {block.kind === 'steady' ? (
                  <>
                    {block.lines[0] ? (
                      <p className="text-ink">{copy.reviewSteady(block.lines[0].item.point)}<EvidenceMark item={block.lines[0].item} onSeek={onSeek} /></p>
                    ) : null}
                    {block.next ? <p className="text-ink">{copy.reviewNext(block.next.item.point)}</p> : null}
                    {!block.lines[0] && !block.next ? <p className="text-ink">{copy.reviewSteadyNone}</p> : null}
                  </>
                ) : null}
                {block.kind === 'uncovered' ? (
                  block.lines.length === 0
                    ? <p className="text-ink">{copy.reviewUncoveredNone}</p>
                    : (
                      <>
                        <p className="text-ink">{copy.reviewUncoveredLead}</p>
                        {block.lines.map((line) => <ReviewSentence key={line.item.targetId} line={line} onSelectTurn={onSelectTurn} onSeek={onSeek} size={size} withNote={false} />)}
                      </>
                    )
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 讲完了以后的三个动作 ── */

interface EndActionsProps {
  onRetry: () => void;
  onReteachUnclear: (() => void) | null;
  onBackToTargets: () => void;
  nextStep?: NextStepCardProps;
}

export function TeachBackEndActions({ onRetry, onReteachUnclear, onBackToTargets, nextStep }: EndActionsProps) {
  const copy = APPS_COPY.teachBack;
  return (
    <div className="border-t border-divider pt-4 pb-5" data-testid="teach-back-end-actions">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button type="button" onClick={onRetry} className="mm-press mm-focus rounded-full bg-pine px-5 py-2.5 text-[13px] font-medium text-white">
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
