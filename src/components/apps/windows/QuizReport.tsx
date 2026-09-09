'use client';

/**
 * 测验完成页：一眼看懂这一轮 —— 答稳率环 + 两个数 + 错题按题号回看。
 * 呈现学习信号，不给学生贴 A–F 等级；错题列表是试卷上的题号行，不是一叠 pill。
 */

import type { ReactNode } from 'react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { isQuizAnswerCorrect, type QuizQuestion } from './quiz-window-model';

interface QuizReportProps {
  questions: QuizQuestion[];
  selected: Record<string, string>;
  correctCount: number;
  elapsedMinutes: number;
  wrongQuestions: QuizQuestion[];
  onReviewMissed: () => void;
  onRestart: () => void;
  nextStep?: ReactNode;
}

const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

export function QuizReport({ questions, selected, correctCount, elapsedMinutes, wrongQuestions, onReviewMissed, onRestart, nextStep }: QuizReportProps) {
  const total = questions.length;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-y-auto bg-white px-6 py-8 md:px-10">
      <div className="mx-auto w-full max-w-[600px]">
        <p className="text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.quiz.completeMeta(total, elapsedMinutes < 1 ? '<1' : String(elapsedMinutes))}</p>
        <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">{APPS_COPY.quiz.completeTitle}</h2>

        <div className="mt-7 flex items-center gap-8">
          <div className="relative h-28 w-28 shrink-0">
            <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r={RING_R} fill="none" stroke="var(--mm-divider, #DCE5DF)" strokeWidth="5" />
              <circle
                cx="50" cy="50" r={RING_R} fill="none" stroke="var(--mm-pine)" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={`${(accuracy / 100) * RING_C} ${RING_C}`}
                style={{ transition: 'stroke-dasharray 900ms cubic-bezier(0.16, 1, 0.3, 1)' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[26px] font-semibold tabular-nums tracking-[-0.02em] text-ink">{accuracy}%</span>
              <span className="text-[11px] text-ink-muted">{APPS_COPY.quiz.recallRate}</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 text-[13px]">
            <div>
              <dt className="text-ink-muted">{APPS_COPY.quiz.solidCount}</dt>
              <dd className="mt-0.5 text-[22px] font-semibold tabular-nums text-pine">{correctCount}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{APPS_COPY.quiz.revisitCount}</dt>
              <dd className={`mt-0.5 text-[22px] font-semibold tabular-nums ${wrongQuestions.length > 0 ? 'text-vermilion' : 'text-ink-muted'}`}>{total - correctCount}</dd>
            </div>
          </dl>
        </div>

        {/* 全卷一览：每题一个点，错的朱红——像老师批过的卷面 */}
        <ol className="mt-7 flex flex-wrap gap-1.5" aria-label={APPS_COPY.quiz.completeTitle}>
          {questions.map((question, i) => {
            const ok = isQuizAnswerCorrect(question, selected[question.id]);
            return (
              <li
                key={question.id}
                className={`flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] font-medium tabular-nums ${ok ? 'bg-pine-fog text-pine' : 'bg-vermilion-fog text-vermilion'}`}
                title={question.stem}
              >
                {i + 1}
              </li>
            );
          })}
        </ol>

        {wrongQuestions.length > 0 ? (
          <div className="mt-7 border-t border-divider-light pt-5">
            <p className="mb-2 text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.quiz.missedReview}</p>
            <ol className="divide-y divide-divider-light">
              {wrongQuestions.map((question) => (
                <li key={question.id} className="flex gap-3 py-2.5 text-[14px] leading-[1.7] text-ink-secondary">
                  <span className="shrink-0 tabular-nums text-vermilion">{questions.indexOf(question) + 1}.</span>
                  <span className="min-w-0 truncate">{question.stem}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className="mt-7 flex items-center gap-5">
          {wrongQuestions.length > 0 ? (
            <button type="button" onClick={onReviewMissed} className="rounded-full bg-ink px-6 py-2.5 text-[13.5px] font-medium text-white transition hover:opacity-85 active:scale-[0.98]">
              {APPS_COPY.quiz.reviewMissed(wrongQuestions.length)}
            </button>
          ) : null}
          <button type="button" onClick={onRestart} className="text-[13.5px] text-ink-muted transition hover:text-ink">
            {APPS_COPY.quiz.restart}
          </button>
        </div>
        {nextStep}
      </div>
    </div>
  );
}
