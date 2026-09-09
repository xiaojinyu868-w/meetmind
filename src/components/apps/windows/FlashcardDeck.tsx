'use client';

/**
 * 闪卡的「牌」：一张纸质卡片 + 身后露出的牌堆。
 *
 * - 正反两面都是纸（白、暖阴影、hairline），背面只多一道松绿顶边——像索引卡的色条，不是彩色底
 * - 翻面是真实的 3D 翻转（rotateY，520ms 弹性曲线），正反面 backface 隐藏
 * - 身后两张牌按剩余数量露出（错位 + 缩放），学生能感到"还有一叠"
 * 纯展示：翻面 / 提示 / 回原话都由父组件控制。
 */

import type { CSSProperties } from 'react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { formatFlashcardEvidenceTime, type FlashcardItem } from './flashcards-window-model';

interface FlashcardDeckProps {
  card: FlashcardItem;
  index: number;
  total: number;
  flipped: boolean;
  showHint: boolean;
  /** 当前牌之后还有几张（决定牌堆露出几层） */
  remaining: number;
  onFlip: () => void;
  onShowHint: () => void;
  onSeek?: (startMs: number) => void;
}

const PAPER = 'rounded-[18px] border border-divider bg-white shadow-[0_1px_2px_rgba(32,49,42,0.05),0_18px_40px_-18px_rgba(32,49,42,0.28)]';

export function FlashcardDeck({ card, index, total, flipped, showHint, remaining, onFlip, onShowHint, onSeek }: FlashcardDeckProps) {
  const faceStyle: CSSProperties = { backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' };
  const counter = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  return (
    <div className="relative w-full max-w-[420px]" style={{ perspective: '1400px' }}>
      {/* 牌堆：最多露两层 */}
      {remaining >= 2 ? <div className={`absolute inset-x-0 top-0 h-full ${PAPER} translate-y-[20px] scale-x-[0.88] opacity-60`} aria-hidden /> : null}
      {remaining >= 1 ? <div className={`absolute inset-x-0 top-0 h-full ${PAPER} translate-y-[10px] scale-x-[0.94] opacity-85`} aria-hidden /> : null}

      <div
        role="button"
        tabIndex={0}
        aria-label={flipped ? card.back : card.front}
        aria-pressed={flipped}
        onClick={onFlip}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onFlip(); } }}
        className="relative cursor-pointer outline-none transition-transform duration-[520ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] focus-visible:[&>*]:ring-2 focus-visible:[&>*]:ring-pine/30"
        style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
      >
        {/* 正面 */}
        <div className={`${PAPER} flex min-h-[280px] flex-col p-6 md:min-h-[300px] md:p-7`} style={faceStyle} aria-hidden={flipped}>
          <div className="flex items-baseline justify-between text-[11px] tracking-[0.08em] text-ink-muted">
            <span className="font-medium">{APPS_COPY.flashcards.frontLabel}</span>
            <span className="tabular-nums">{counter}</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
            <p className="text-[19px] font-medium leading-[1.65] tracking-[-0.01em] text-ink md:text-[21px]">{card.front}</p>
            {card.hint && showHint ? (
              <p className="mt-5 max-w-[92%] text-[13.5px] leading-[1.7] text-ink-secondary">{card.hint}</p>
            ) : null}
          </div>
          <div className="flex items-end justify-between text-[12px] text-ink-muted">
            {card.hint && !showHint ? (
              <button
                type="button"
                tabIndex={flipped ? -1 : 0}
                className="underline decoration-divider underline-offset-4 transition hover:text-ink hover:decoration-ink-muted"
                onClick={(event) => { event.stopPropagation(); onShowHint(); }}
              >
                {APPS_COPY.flashcards.showHint}
              </button>
            ) : <span />}
            <span className="text-ink-muted/70">{APPS_COPY.flashcards.reveal}</span>
          </div>
        </div>

        {/* 背面：同一张纸，多一道松绿顶边 */}
        <div
          className={`${PAPER} absolute inset-0 flex flex-col border-t-[3px] border-t-pine p-6 md:p-7`}
          style={{ ...faceStyle, transform: 'rotateY(180deg)' }}
          aria-hidden={!flipped}
        >
          <div className="flex items-baseline justify-between text-[11px] tracking-[0.08em] text-ink-muted">
            <span className="font-medium text-pine">{APPS_COPY.flashcards.backLabel}</span>
            <span className="tabular-nums">{counter}</span>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
            <p className="text-[18px] leading-[1.75] tracking-[-0.005em] text-ink md:text-[19px]">{card.back}</p>
          </div>
          <div className="flex items-end justify-between text-[12px] text-ink-muted">
            <span className="truncate text-ink-muted/70">{card.front}</span>
            {card.evidence ? (
              <button
                type="button"
                tabIndex={flipped ? 0 : -1}
                disabled={!onSeek}
                className="ml-3 shrink-0 text-ink-muted/70 transition hover:text-ink disabled:cursor-default"
                onClick={(event) => { event.stopPropagation(); onSeek?.(card.evidence!.startMs); }}
              >
                {onSeek
                  ? APPS_COPY.flashcards.returnToEvidenceAt(formatFlashcardEvidenceTime(card.evidence.startMs))
                  : APPS_COPY.flashcards.evidenceAt(formatFlashcardEvidenceTime(card.evidence.startMs))}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
