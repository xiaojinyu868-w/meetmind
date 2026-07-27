'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { formatQuizActivity, formatQuizCompleteActivity } from '@/components/review-learning-activity';
import { COPY } from '@/lib/ui/copy';
import {
  formatQuizEvidenceTime,
  isQuizAnswerCorrect,
  isSubjectiveQuizQuestion,
  normalizeQuizAnswer,
  normalizeQuizQuestions,
  QUIZ_SELF_CORRECT,
  QUIZ_SELF_WRONG,
  stripQuizOptionPrefix,
} from './quiz-window-model';

interface QuizWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string) => void;
}

/* 测验保持安静平涂：用排版和状态区分，不用题目环境光。 */
const QUIZ_SUCCESS = 'var(--mm-pine)';

export function QuizWindow({ result, onSeek, onLearningActivity }: QuizWindowProps) {
  const questions = useMemo(() => normalizeQuizQuestions(result), [result]);
  const [reviewQuestionIds, setReviewQuestionIds] = useState<string[] | null>(null);
  const activeQuestions = useMemo(
    () => reviewQuestionIds ? questions.filter((question) => reviewQuestionIds.includes(question.id)) : questions,
    [questions, reviewQuestionIds],
  );
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [showReport, setShowReport] = useState(false);
  const [startTime] = useState(() => Date.now());
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');

  // Swipe gesture
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const navigateTo = useCallback((newIndex: number, dir: 'left' | 'right') => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSlideDir(dir);
    setTimeout(() => {
      setIndex(newIndex);
      setSlideDir('none');
      setIsAnimating(false);
    }, 250);
  }, [isAnimating]);

  const goToPrev = useCallback(() => {
    if (index <= 0 || isAnimating) return;
    navigateTo(index - 1, 'right');
  }, [index, isAnimating, navigateTo]);

  const goToNext = useCallback(() => {
    if (index >= activeQuestions.length - 1 || isAnimating) return;
    navigateTo(index + 1, 'left');
  }, [activeQuestions.length, index, isAnimating, navigateTo]);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.key === 'ArrowLeft') goToPrev();
      else if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrev, goToNext]);

  // Touch swipe
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
      if (deltaX < 0) goToNext();
      else goToPrev();
    }
  }, [goToNext, goToPrev]);

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={COPY.apps.quiz.appName} />;
  }
  if (questions.length === 0) {
    return <AppWindowPlaceholder status="empty" appName={COPY.apps.quiz.appName} />;
  }

  const current = activeQuestions[Math.min(index, activeQuestions.length - 1)];
  const selectedOption = selected[current.id];
  const isSubmitted = Boolean(submitted[current.id]);
  const subjective = isSubjectiveQuizQuestion(current);
  const normalizedAnswer = normalizeQuizAnswer(current.answer, current.options);
  const isCorrect = isQuizAnswerCorrect(current, selectedOption);

  const finishedCount = activeQuestions.filter((question) => submitted[question.id]).length;
  const correctCount = activeQuestions.filter(
    (question) => submitted[question.id] && isQuizAnswerCorrect(question, selected[question.id]),
  ).length;
  const allDone = finishedCount === activeQuestions.length;
  const wrongQuestions = activeQuestions.filter(
    (question) => submitted[question.id] && !isQuizAnswerCorrect(question, selected[question.id]),
  );
  const accuracy = finishedCount > 0 ? Math.round((correctCount / finishedCount) * 100) : 0;
  const progress = activeQuestions.length > 0 ? ((index + 1) / activeQuestions.length) * 100 : 0;
  const elapsedMinutes = Math.round((Date.now() - startTime) / 60000);

  const slideClass = slideDir === 'left'
    ? 'translate-x-[-8%] opacity-0 scale-95'
    : slideDir === 'right'
      ? 'translate-x-[8%] opacity-0 scale-95'
      : 'translate-x-0 opacity-100 scale-100';

  // 本轮回顾：呈现学习信号，不给学生贴 A-F 等级标签。
  if (showReport && allDone) {
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-5 h-1 w-12 rounded-full bg-pine" aria-hidden />
          <h2 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-ink">{COPY.apps.quiz.completeTitle}</h2>
          <p className="mb-7 text-sm leading-relaxed text-ink-muted">
            {COPY.apps.quiz.completeMeta(activeQuestions.length, elapsedMinutes < 1 ? '<1' : String(elapsedMinutes))}
          </p>

          <div className="relative inline-flex items-center justify-center w-32 h-32 mb-6">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#E8E2D5" strokeWidth="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={QUIZ_SUCCESS}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${accuracy * 2.64} 264`}
                style={{ transition: 'stroke-dasharray 1s ease-out' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-ink">{accuracy}%</span>
              <span className="text-xs text-ink-muted">{COPY.apps.quiz.recallRate}</span>
            </div>
          </div>

          {/* Stats */}
          <div className="mb-6 flex items-center justify-center gap-10">
            <div className="text-center">
              <div className="text-xl font-semibold text-ink">{correctCount}</div>
              <div className="mt-1 text-xs text-ink-muted">{COPY.apps.quiz.solidCount}</div>
            </div>
            <div className="h-8 w-px bg-divider" />
            <div className="text-center">
              <div className="text-xl font-semibold text-danger-500">{finishedCount - correctCount}</div>
              <div className="mt-1 text-xs text-ink-muted">{COPY.apps.quiz.revisitCount}</div>
            </div>
          </div>

          {/* Wrong questions preview */}
          {wrongQuestions.length > 0 && (
            <div className="mb-6 max-h-[160px] overflow-y-auto px-1">
              <p className="mb-3 text-xs font-medium tracking-wider text-ink-muted">{COPY.apps.quiz.missedReview}</p>
              <div className="space-y-1.5">
                {wrongQuestions.map((question) => (
                  <p key={question.id} className="truncate rounded-2xl border border-divider bg-white px-4 py-3 text-left text-sm text-ink-secondary">
                    {question.stem.length > 52 ? `${question.stem.slice(0, 52)}…` : question.stem}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col items-center gap-3">
            {wrongQuestions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const missedIds = wrongQuestions.map((question) => question.id);
                  setReviewQuestionIds(missedIds);
                  setShowReport(false);
                  setIndex(0);
                  setSelected({});
                  setSubmitted({});
                  setRevealed({});
                }}
                className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85"
              >
                {COPY.apps.quiz.reviewMissed(wrongQuestions.length)}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setReviewQuestionIds(null);
                setIndex(0);
                setSelected({});
                setSubmitted({});
                setRevealed({});
                setShowReport(false);
              }}
              className="rounded-full px-8 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              {COPY.apps.quiz.restart}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-[420px] select-none flex-col overflow-hidden bg-canvas"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="quiz-window"
    >
      {/* Top: keyboard hint (desktop only) */}
      <div className="relative flex-shrink-0 pt-3 pb-1 text-center hidden md:block">
        <p className="text-[12px] tracking-wide text-ink-muted">
          {COPY.apps.quiz.keyboardHint}
        </p>
      </div>

      {/* Question area */}
      <div className="relative flex-1 flex items-start justify-center px-4 md:px-12 min-h-0 overflow-y-auto">
        {/* Left arrow */}
        <button
          type="button"
          onClick={goToPrev}
          disabled={index <= 0}
          className="group absolute left-3 top-1/3 z-10 hidden h-11 w-11 items-center justify-center rounded-full border border-divider bg-white transition-colors duration-200 hover:border-ink-muted disabled:pointer-events-none disabled:opacity-0 md:left-6 md:flex"
          aria-label={COPY.apps.quiz.previous}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-muted transition-colors group-hover:text-ink" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Card container with slide animation */}
        <div className={`w-full max-w-[420px] py-4 transition-all duration-200 ease-out ${slideClass}`}>
          {/* Question card */}
          <div className="rounded-3xl border border-divider bg-white p-6 md:p-7">
            {/* Question number badge */}
            <div className="flex items-center gap-2 mb-5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-divider bg-canvas px-3 py-1.5">
                <span className="text-[12px] font-semibold tracking-wide text-ink-secondary">
                  {index + 1} / {activeQuestions.length}
                </span>
              </div>
              {isSubmitted && (
                <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium ${
                  isCorrect
                    ? 'border-mint-200 bg-mint-50 text-ink-secondary'
                    : 'border-danger-200 bg-danger-50 text-danger-700'
                }`}>
                  <div className={`h-1.5 w-1.5 rounded-full ${isCorrect ? 'bg-mint-500' : 'bg-danger-500'}`} />
                  {isCorrect ? COPY.apps.quiz.correct : COPY.apps.quiz.wrong}
                </div>
              )}
            </div>

            {/* Question stem */}
            <h2 className="mb-6 text-[18px] font-semibold leading-[1.75] tracking-[-0.02em] text-ink md:text-[20px]">
              {current.stem}
            </h2>

            {/* 简答 / 填空：无选项，先想后对照参考答案（不做花哨自评，仅一次轻量标记） */}
            {subjective ? (
              <div className="space-y-3">
                {!revealed[current.id] ? (
                  <p className="rounded-2xl border border-dashed border-divider bg-canvas px-4 py-4 text-[14px] leading-[1.7] text-ink-muted">
                    {COPY.apps.quiz.subjectivePrompt}
                  </p>
                ) : (
                  <div className="rounded-2xl border border-mint-200 bg-mint-50 p-4">
                    <p className="mb-1.5 text-[12px] font-medium tracking-wider text-ink-muted">{COPY.apps.quiz.referenceAnswer}</p>
                    <p className="text-[15px] leading-[1.75] text-ink">{current.answer || COPY.apps.quiz.referenceFallback}</p>
                    <div className="mt-3 flex items-center gap-2 border-t border-mint-200 pt-3">
                      <span className="text-[13px] text-ink-muted">{COPY.apps.quiz.selfRate}</span>
                      <button
                        type="button"
                        disabled={isSubmitted}
                        onClick={() => {
                          if (isSubmitted) return;
                          setSelected((prev) => ({ ...prev, [current.id]: QUIZ_SELF_CORRECT }));
                          setSubmitted((prev) => ({ ...prev, [current.id]: true }));
                          onLearningActivity?.(formatQuizActivity({
                            index: index + 1,
                            total: activeQuestions.length,
                            stem: current.stem,
                            picked: COPY.apps.quiz.selfCorrect,
                            answer: current.answer,
                            correct: true,
                          }));
                        }}
                        className={`rounded-full border px-3 py-1 text-[13px] transition disabled:cursor-default ${selectedOption === QUIZ_SELF_CORRECT ? 'border-mint-500 bg-mint-500 text-white' : 'border-divider text-ink-secondary hover:border-mint-300'}`}
                      >
                        {COPY.apps.quiz.selfCorrect}
                      </button>
                      <button
                        type="button"
                        disabled={isSubmitted}
                        onClick={() => {
                          if (isSubmitted) return;
                          setSelected((prev) => ({ ...prev, [current.id]: QUIZ_SELF_WRONG }));
                          setSubmitted((prev) => ({ ...prev, [current.id]: true }));
                          onLearningActivity?.(formatQuizActivity({
                            index: index + 1,
                            total: activeQuestions.length,
                            stem: current.stem,
                            picked: COPY.apps.quiz.selfWrong,
                            answer: current.answer,
                            correct: false,
                          }));
                        }}
                        className={`rounded-full border px-3 py-1 text-[13px] transition disabled:cursor-default ${selectedOption === QUIZ_SELF_WRONG ? 'border-danger-300 bg-danger-500 text-white' : 'border-divider text-ink-secondary hover:border-danger-300'}`}
                      >
                        {COPY.apps.quiz.selfWrong}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
            <div className="space-y-2.5">
              {current.options.map((option, optIdx) => {
                const active = selectedOption === option;
                const optionCorrect = isSubmitted && option === normalizedAnswer;
                const optionWrong = isSubmitted && active && !isCorrect;
                const optionLetter = String.fromCharCode(65 + optIdx);
                const isDisabled = isSubmitted;

                let optionStyle = 'border-divider bg-white hover:border-ink-muted hover:bg-canvas';
                let letterStyle = 'bg-canvas text-ink-muted';

                if (optionCorrect) {
                  optionStyle = 'border-mint-200 bg-mint-50';
                  letterStyle = 'bg-ink text-white';
                } else if (optionWrong) {
                  optionStyle = 'border-danger-200 bg-danger-50';
                  letterStyle = 'bg-danger-500 text-white';
                } else if (active && !isSubmitted) {
                  optionStyle = 'border-ink bg-canvas';
                  letterStyle = 'bg-ink text-white';
                }

                const inlineStyle: React.CSSProperties = {};
                const inlineLetterStyle: React.CSSProperties = {};

                return (
                  <button
                    key={option}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => !isDisabled && setSelected((prev) => ({ ...prev, [current.id]: option }))}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 active:scale-[0.98] ${optionStyle} ${isDisabled ? 'cursor-default' : 'cursor-pointer'}`}
                    style={{ ...inlineStyle, border: inlineStyle.borderColor ? `1px solid ${inlineStyle.borderColor}` : undefined }}
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-200 ${letterStyle}`}
                      style={inlineLetterStyle}
                    >
                      {optionLetter}
                    </span>
                    <span className={`text-[15px] leading-[1.7] ${
                      optionCorrect ? 'text-ink' : optionWrong ? 'text-danger-700' : 'text-ink-secondary'
                    }`}>
                      {stripQuizOptionPrefix(option)}
                    </span>
                    {/* Correct/wrong indicator */}
                    {optionCorrect && (
                      <svg className="ml-auto h-5 w-5 shrink-0 text-ink-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {optionWrong && (
                      <svg className="ml-auto h-5 w-5 shrink-0 text-danger-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
            )}

            {/* Explanation section (slide down after submit) */}
            {isSubmitted && current.explanation && (
              <div className={`mt-6 rounded-2xl border p-4 transition-all duration-300 ${
                isCorrect ? 'border-mint-200 bg-mint-50' : 'border-divider bg-canvas'
              }`}>
                {!subjective && !isCorrect && (
                  <p className="mb-2 text-sm font-medium text-danger-700">
                    {COPY.apps.quiz.correctAnswer(stripQuizOptionPrefix(normalizedAnswer))}
                  </p>
                )}
                <p className="text-[14px] leading-[1.75] text-ink-secondary">{current.explanation}</p>
              </div>
            )}
            {isSubmitted && current.evidence && (
              <button
                type="button"
                disabled={!onSeek}
                onClick={() => onSeek?.(current.evidence!.startMs)}
                className="mt-4 text-[12px] text-ink-muted transition hover:text-ink disabled:cursor-default"
              >
                {onSeek
                  ? COPY.apps.quiz.returnToEvidenceAt(formatQuizEvidenceTime(current.evidence.startMs))
                  : COPY.apps.quiz.evidenceAt(formatQuizEvidenceTime(current.evidence.startMs))}
              </button>
            )}
          </div>
        </div>

        {/* 提交后只保留底部主动作，避免同屏出现两个“下一题”。 */}
        {!isSubmitted && (
          <button
            type="button"
            onClick={goToNext}
            disabled={index >= activeQuestions.length - 1}
            className="group absolute right-3 top-1/3 z-10 hidden h-11 w-11 items-center justify-center rounded-full border border-divider bg-white transition-colors duration-200 hover:border-ink-muted disabled:pointer-events-none disabled:opacity-0 md:right-6 md:flex"
            aria-label={COPY.apps.quiz.next}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-muted transition-colors group-hover:text-ink" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>

      {/* Bottom controls */}
      <div className="relative flex-shrink-0 px-4 pb-5 pt-2">
        {/* Action button */}
        <div className="flex items-center justify-center gap-3 mb-4">
          {!isSubmitted && (!subjective || !revealed[current.id]) ? (
            <button
              type="button"
              className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85 active:scale-95 disabled:cursor-not-allowed disabled:bg-divider disabled:text-ink-muted"
              disabled={subjective ? false : !selectedOption}
              onClick={() => {
                if (subjective) {
                  setRevealed((prev) => ({ ...prev, [current.id]: true }));
                } else {
                  setSubmitted((prev) => ({ ...prev, [current.id]: true }));
                  onLearningActivity?.(formatQuizActivity({
                    index: index + 1,
                    total: activeQuestions.length,
                    stem: current.stem,
                    picked: selectedOption || '',
                    answer: normalizedAnswer,
                    correct: isCorrect,
                  }));
                }
              }}
            >
              {subjective ? COPY.apps.quiz.revealReference : COPY.apps.quiz.confirmAnswer}
            </button>
          ) : isSubmitted ? (
            <>
              {index < activeQuestions.length - 1 ? (
                <button
                  type="button"
                  onClick={goToNext}
                  className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85 active:scale-95"
                >
                  {COPY.apps.quiz.nextQuestion}
                </button>
              ) : allDone ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowReport(true);
                    onLearningActivity?.(formatQuizCompleteActivity({ correct: correctCount, total: activeQuestions.length }));
                  }}
                  className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85 active:scale-95"
                >
                  {COPY.apps.quiz.viewResult}
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Progress dots + bar */}
        <div className="flex flex-col items-center gap-2 max-w-[420px] mx-auto">
          {/* Mini dots */}
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {activeQuestions.map((q, i) => {
              const done = Boolean(submitted[q.id]);
              const ok = done && isQuizAnswerCorrect(q, selected[q.id]);
              const isCurrent = i === index;
              let dotColor = 'bg-divider';
              if (done) dotColor = ok ? 'bg-ink' : 'bg-danger-500';
              else if (isCurrent) dotColor = 'bg-ink-muted';
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => { if (i !== index) navigateTo(i, i > index ? 'left' : 'right'); }}
                  className={`h-2 rounded-full transition-all duration-300 ${dotColor} ${isCurrent ? 'w-6' : 'w-2'}`}
                  aria-label={COPY.apps.quiz.jumpTo(i + 1)}
                />
              );
            })}
          </div>

          {/* Thin progress bar */}
          <div className="w-full flex items-center gap-3">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-divider">
              <div
                className="h-full rounded-full bg-ink transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="whitespace-nowrap text-[12px] tabular-nums tracking-wide text-ink-muted">
              {COPY.apps.quiz.answered(finishedCount, activeQuestions.length)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
