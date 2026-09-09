'use client';

/**
 * 闪卡一轮打完：记住率环 + 两个数 + 没记住的那几张正面 + 「没记住的再来一遍」。
 * 和 QuizReport 同一套版式语言（左对齐、hairline、数字用色说话），不贴等级标签。
 */

import type { ReactNode } from 'react';
import { COPY } from '@/lib/ui/copy';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import type { FlashcardItem } from './flashcards-window-model';

interface FlashcardsSummaryProps {
  cards: FlashcardItem[];
  scores: Record<string, 'missed' | 'got'>;
  onReviewMissed: () => void;
  onRestart: () => void;
  /** 访客试听结果分享（只在首轮出现） */
  trialShare?: { sharing: boolean; onShare: () => void };
  nextStep?: ReactNode;
}

const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

export function FlashcardsSummary({ cards, scores, onReviewMissed, onRestart, trialShare, nextStep }: FlashcardsSummaryProps) {
  const total = cards.length;
  const got = cards.filter((card) => scores[card.id] === 'got').length;
  const missed = cards.filter((card) => scores[card.id] === 'missed');
  const rate = total > 0 ? Math.round((got / total) * 100) : 0;
  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-y-auto bg-paper px-6 py-8 md:px-10">
      <div className="mx-auto w-full max-w-[560px]">
        <p className="text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.flashcards.roundSummary(total)}</p>
        <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">{APPS_COPY.flashcards.completeTitle}</h2>

        <div className="mt-7 flex items-center gap-8">
          <div className="relative h-28 w-28 shrink-0">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--mm-divider, #DCE5DF)" strokeWidth="5" />
              <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--mm-pine)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(rate / 100) * RING_C} ${RING_C}`} style={{ transition: 'stroke-dasharray 900ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{rate}%</span>
              <span className="text-[11px] text-ink-muted">{APPS_COPY.flashcards.recallRate}</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 text-[13px]">
            <div>
              <dt className="text-ink-muted">{APPS_COPY.flashcards.gotCount}</dt>
              <dd className="mt-0.5 text-[22px] font-semibold tabular-nums text-pine">{got}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{APPS_COPY.flashcards.missedCount}</dt>
              <dd className={`mt-0.5 text-[22px] font-semibold tabular-nums ${missed.length > 0 ? 'text-vermilion' : 'text-ink-muted'}`}>{missed.length}</dd>
            </div>
          </dl>
        </div>

        {missed.length > 0 ? (
          <div className="mt-7 border-t border-divider-light pt-5">
            <p className="mb-2 text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.flashcards.missedList}</p>
            <ul className="divide-y divide-divider-light">
              {missed.map((card) => (
                <li key={card.id} className="flex gap-3 py-2.5 text-[14px] leading-[1.7] text-ink-secondary">
                  <span className="mt-[0.8em] h-1.5 w-1.5 shrink-0 rounded-full bg-vermilion" aria-hidden />
                  <span className="min-w-0 truncate">{card.front}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {trialShare ? (
          <div className="mt-7 border-t border-divider-light pt-5">
            <p className="text-[14px] font-medium text-ink">{COPY.flashcardsShare.summaryTitle}</p>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-muted">{COPY.flashcardsShare.summaryBody(total)}</p>
            <button type="button" onClick={trialShare.onShare} disabled={trialShare.sharing} className="mt-3 rounded-full bg-pine px-5 py-2 text-[13px] font-medium text-white transition hover:bg-pine-deep disabled:opacity-60">
              {trialShare.sharing ? COPY.flashcardsShare.sharing : COPY.flashcardsShare.open}
            </button>
          </div>
        ) : null}

        <div className="mt-7 flex items-center gap-5">
          {missed.length > 0 ? (
            <button type="button" onClick={onReviewMissed} className="rounded-full bg-ink px-6 py-2.5 text-[13.5px] font-medium text-white transition hover:opacity-85 active:scale-[0.98]">
              {APPS_COPY.flashcards.reviewMissed(missed.length)}
            </button>
          ) : null}
          <button type="button" onClick={onRestart} className="text-[13.5px] text-ink-muted transition hover:text-ink">{APPS_COPY.flashcards.restart}</button>
        </div>
        {nextStep}
      </div>
    </div>
  );
}
