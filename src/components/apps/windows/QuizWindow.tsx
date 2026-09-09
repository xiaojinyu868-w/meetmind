'use client';

/**
 * 课堂测验窗口 —— 一份好试卷，不是一叠卡片。
 *
 * 版式原则（2026-09-09 重做）：
 * - 纸面就是窗口：白底、一根 2px 进度线、题号 + 题干 + 选项，没有卡片套卡片、没有 pill 计数
 * - 选项是大而稳的可点面：整行可点、字母圈做状态锚点，选中 / 对 / 错三态只换颜色不弹跳
 * - 一次只见一题；键盘 1–4 选、回车确认或下一题、←→ 翻题（useQuizNavigation）
 * - 反馈就地出现（解析在题目下方生长），不弹层不打断节奏
 * - 「回到课堂」退成页脚一行小字：这是测验，不是引用系统
 * 逻辑（对错判定、自评、记忆观测、报告）全部沿用 quiz-window-model / assessment-events。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuizNavigation } from '@/hooks/useQuizNavigation';
import type { LearningObservationContent } from '@/types/learning-event';
import { buildQuizAttemptObservation } from './quiz-observation';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { formatQuizActivity, formatQuizCompleteActivity } from '@/components/review-learning-activity';
import { APPS_COPY } from '@/lib/ui/copy-apps';
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
import { buildQuizAssessment, type AssessmentDraft } from './assessment-events';
import { NextStepCard, type NextStepCardProps } from './NextStepCard';
import { QuizReport } from './QuizReport';

interface QuizWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string, observation?: LearningObservationContent) => void;
  /** 交卷时把每题的对错 + 证据交给记忆（结构化，见 assessment-events.ts） */
  onAssessment?: (draft: AssessmentDraft) => void;
  /** 完成态里同桌接着说的下一步 */
  nextStep?: NextStepCardProps;
}

type OptionState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dim';

/** 三态只换颜色：选中 = 墨，对 = 松绿，错 = 朱红；其余在已交卷后退灰 */
const OPTION_ROW: Record<OptionState, string> = {
  idle: 'hover:bg-paper-warm',
  selected: 'bg-paper-warm',
  correct: 'bg-pine-fog',
  wrong: 'bg-vermilion-fog',
  dim: 'opacity-55',
};
const OPTION_LETTER: Record<OptionState, string> = {
  idle: 'border-divider text-ink-muted group-hover:border-ink-muted',
  selected: 'border-ink bg-ink text-white',
  correct: 'border-pine bg-pine text-white',
  wrong: 'border-vermilion bg-vermilion text-white',
  dim: 'border-divider text-ink-muted',
};

export function QuizWindow({ result, transcript, onSeek, onLearningActivity, onAssessment, nextStep }: QuizWindowProps) {
  const questions = useMemo(() => normalizeQuizQuestions(result), [result]);
  const [reviewQuestionIds, setReviewQuestionIds] = useState<string[] | null>(null);
  const activeQuestions = useMemo(
    () => reviewQuestionIds ? questions.filter((question) => reviewQuestionIds.includes(question.id)) : questions,
    [questions, reviewQuestionIds],
  );
  const { index, setIndex, slideDir, navigateTo, goToNext, goToPrev, handleTouchStart, handleTouchEnd } = useQuizNavigation(activeQuestions.length);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [showReport, setShowReport] = useState(false);
  const [startTime] = useState(() => Date.now());
  const seenReferences = useRef(new Set<string>());
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  const current = activeQuestions[Math.min(index, activeQuestions.length - 1)];
  const selectedOption = current ? selected[current.id] : undefined;
  const isSubmitted = current ? Boolean(submitted[current.id]) : false;
  const subjective = current ? isSubjectiveQuizQuestion(current) : false;

  // 键盘：1–4 选选项（未交卷时），回车 = 底部主动作。←→ 由 useQuizNavigation 负责
  useEffect(() => {
    if (!current) return;
    const keyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (!subjective && !isSubmitted && /^[1-9]$/.test(event.key)) {
        const option = current.options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          setSelected((prev) => ({ ...prev, [current.id]: option }));
        }
        return;
      }
      if (event.key === 'Enter' && primaryRef.current && !primaryRef.current.disabled) {
        event.preventDefault();
        primaryRef.current.click();
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [current, isSubmitted, subjective]);

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={APPS_COPY.quiz.appName} transcript={transcript} />;
  }
  if (questions.length === 0 || !current) {
    return <AppWindowPlaceholder status="empty" appName={APPS_COPY.quiz.appName} />;
  }

  const normalizedAnswer = normalizeQuizAnswer(current.answer, current.options);
  const isCorrect = isQuizAnswerCorrect(current, selectedOption);

  function recordAttempt(picked: string, selfAssessment?: 'correct' | 'incorrect'): void {
    const key = JSON.stringify([current.id, current.stem, current.options, current.answer]);
    const observation = buildQuizAttemptObservation({ question: current, picked, selfAssessment, referencePreviouslySeen: seenReferences.current.has(key) });
    seenReferences.current.add(key);
    onLearningActivity?.(formatQuizActivity({
      index: index + 1, total: activeQuestions.length, stem: current.stem, picked,
      answer: normalizedAnswer, correct: selfAssessment ? selfAssessment === 'correct' : isQuizAnswerCorrect(current, picked),
    }), observation);
  }

  const finishedCount = activeQuestions.filter((question) => submitted[question.id]).length;
  const correctCount = activeQuestions.filter(
    (question) => submitted[question.id] && isQuizAnswerCorrect(question, selected[question.id]),
  ).length;
  const allDone = finishedCount === activeQuestions.length;
  const wrongQuestions = activeQuestions.filter(
    (question) => submitted[question.id] && !isQuizAnswerCorrect(question, selected[question.id]),
  );
  const firstUnfinishedIndex = activeQuestions.findIndex((question) => !submitted[question.id]);
  const selfRate = (correct: boolean) => {
    if (isSubmitted) return;
    setSelected((prev) => ({ ...prev, [current.id]: correct ? QUIZ_SELF_CORRECT : QUIZ_SELF_WRONG }));
    setSubmitted((prev) => ({ ...prev, [current.id]: true }));
    // 自评不是观测到的作答：observation 里标 learner_self_report，Context 侧不把它当独立答对
    recordAttempt(correct ? APPS_COPY.quiz.selfCorrect : APPS_COPY.quiz.selfWrong, correct ? 'correct' : 'incorrect');
  };
  const resetRound = (ids: string[] | null) => {
    setReviewQuestionIds(ids);
    setIndex(0);
    setSelected({});
    setSubmitted({});
    setRevealed({});
    setShowReport(false);
  };
  const progress = activeQuestions.length > 0 ? (finishedCount / activeQuestions.length) * 100 : 0;
  const elapsedMinutes = Math.round((Date.now() - startTime) / 60000);

  const slideClass = slideDir === 'left'
    ? 'translate-x-[-4%] opacity-0'
    : slideDir === 'right'
      ? 'translate-x-[4%] opacity-0'
      : 'translate-x-0 opacity-100';

  if (showReport && allDone) {
    return (
      <QuizReport
        questions={activeQuestions}
        selected={selected}
        correctCount={correctCount}
        elapsedMinutes={elapsedMinutes}
        wrongQuestions={wrongQuestions}
        onReviewMissed={() => resetRound(wrongQuestions.map((question) => question.id))}
        onRestart={() => resetRound(null)}
        nextStep={nextStep ? <NextStepCard {...nextStep} /> : null}
      />
    );
  }

  const optionStateOf = (option: string): OptionState => {
    const active = selectedOption === option;
    if (!isSubmitted) return active ? 'selected' : 'idle';
    if (option === normalizedAnswer) return 'correct';
    if (active) return 'wrong';
    return 'dim';
  };

  const showKeyboardHint = index === 0 && !isSubmitted && !subjective && !reviewQuestionIds;

  return (
    <div
      className="relative flex h-full min-h-[420px] select-none flex-col overflow-hidden bg-white"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="quiz-window"
    >
      {/* 顶端一根进度线：已完成占比，安静地长 */}
      <div className="h-[2px] w-full bg-divider-light" aria-hidden>
        <div className="h-full bg-pine transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 md:px-10">
        <div className={`mx-auto w-full max-w-[600px] pt-7 pb-6 transition-all duration-200 ease-out ${slideClass}`}>
          {/* 题号行：第 N 题 · 状态 …… 共 M 题 */}
          <div className="mb-4 flex items-baseline justify-between text-[12px] tabular-nums tracking-[0.04em] text-ink-muted">
            <span>
              {APPS_COPY.quiz.questionNo(index + 1)}
              {isSubmitted ? (
                <span className={`ml-3 ${isCorrect ? 'text-pine' : 'text-vermilion'}`}>{isCorrect ? APPS_COPY.quiz.correct : APPS_COPY.quiz.wrong}</span>
              ) : null}
            </span>
            <span>{finishedCount > 0 ? APPS_COPY.quiz.answered(finishedCount, activeQuestions.length) : null}</span>
          </div>

          {/* 题干 */}
          <h2 className="mb-6 text-[19px] font-semibold leading-[1.7] tracking-[-0.015em] text-ink md:text-[21px]">
            {current.stem}
          </h2>

          {subjective ? (
            <div className="space-y-3">
              {!revealed[current.id] ? (
                <p className="border-l-2 border-divider pl-4 text-[14px] leading-[1.75] text-ink-muted">
                  {APPS_COPY.quiz.subjectivePrompt}
                </p>
              ) : (
                <div className="border-t border-divider pt-4">
                  <p className="mb-1.5 text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.quiz.referenceAnswer}</p>
                  <p className="text-[15px] leading-[1.8] text-ink">{current.answer || APPS_COPY.quiz.referenceFallback}</p>
                  {isSubmitted ? (
                    <p className={`mt-3 text-[13px] font-medium ${selectedOption === QUIZ_SELF_CORRECT ? 'text-pine' : 'text-vermilion'}`}>
                      {selectedOption === QUIZ_SELF_CORRECT ? APPS_COPY.quiz.selfCorrect : APPS_COPY.quiz.selfWrong}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <ol className="divide-y divide-divider-light border-y border-divider-light" aria-label={APPS_COPY.quiz.appName}>
              {current.options.map((option, optIdx) => {
                const state = optionStateOf(option);
                const letter = String.fromCharCode(65 + optIdx);
                return (
                  <li key={option}>
                    <button
                      type="button"
                      disabled={isSubmitted}
                      aria-pressed={state === 'selected'}
                      onClick={() => !isSubmitted && setSelected((prev) => ({ ...prev, [current.id]: option }))}
                      className={`group -mx-3 flex w-[calc(100%+1.5rem)] items-start gap-4 rounded-lg px-3 py-3.5 text-left transition-colors duration-200 ${OPTION_ROW[state]} ${isSubmitted ? 'cursor-default' : 'cursor-pointer active:bg-paper-deep'}`}
                    >
                      <span
                        className={`mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums transition-colors duration-200 ${OPTION_LETTER[state]}`}
                        aria-hidden
                      >
                        {state === 'correct' ? '✓' : state === 'wrong' ? '✕' : letter}
                      </span>
                      <span className={`pt-[3px] text-[15.5px] leading-[1.7] ${state === 'correct' ? 'text-ink' : state === 'wrong' ? 'text-vermilion-deep' : state === 'dim' ? 'text-ink-muted' : 'text-ink'}`}>
                        {stripQuizOptionPrefix(option)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {/* 解析：交卷后在题目下方长出来，不套彩色盒子 */}
          {isSubmitted && (current.explanation || (!subjective && !isCorrect)) ? (
            <div className="mt-6 animate-slide-up">
              <p className="mb-1.5 text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.quiz.explanationLabel}</p>
              {!subjective && !isCorrect ? (
                <p className="mb-1.5 text-[14px] font-medium text-vermilion">
                  {APPS_COPY.quiz.correctAnswer(stripQuizOptionPrefix(normalizedAnswer))}
                </p>
              ) : null}
              {current.explanation ? <p className="text-[14.5px] leading-[1.8] text-ink-secondary">{current.explanation}</p> : null}
            </div>
          ) : null}
          {isSubmitted && current.evidence ? (
            <button
              type="button"
              disabled={!onSeek}
              onClick={() => onSeek?.(current.evidence!.startMs)}
              className="mt-5 text-[12px] text-ink-muted/80 transition hover:text-ink disabled:cursor-default"
            >
              {onSeek
                ? APPS_COPY.quiz.returnToEvidenceAt(formatQuizEvidenceTime(current.evidence.startMs))
                : APPS_COPY.quiz.evidenceAt(formatQuizEvidenceTime(current.evidence.startMs))}
            </button>
          ) : null}

          {/* 主动作紧跟内容：选完就在手边，不用去窗口底部找 */}
          <div className="mt-7 flex items-center gap-3">
            {!isSubmitted && (!subjective || !revealed[current.id]) ? (
              <button
                ref={primaryRef}
                type="button"
                className="rounded-full bg-ink px-5 py-2 text-[13.5px] font-medium text-white transition hover:opacity-85 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-divider disabled:text-ink-muted"
                disabled={subjective ? false : !selectedOption}
                onClick={() => {
                  if (subjective) {
                    setRevealed((prev) => ({ ...prev, [current.id]: true }));
                  } else {
                    setSubmitted((prev) => ({ ...prev, [current.id]: true }));
                    recordAttempt(selectedOption || '');
                  }
                }}
              >
                {subjective ? APPS_COPY.quiz.revealReference : APPS_COPY.quiz.confirmAnswer}
              </button>
            ) : subjective && !isSubmitted ? (
              <>
                <span className="text-[12px] text-ink-muted">{APPS_COPY.quiz.selfRate}</span>
                <button ref={primaryRef} type="button" onClick={() => selfRate(true)} className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-85 active:scale-[0.98]">
                  {APPS_COPY.quiz.selfCorrect}
                </button>
                <button type="button" onClick={() => selfRate(false)} className="rounded-full px-3 py-2 text-[13px] font-medium text-ink-secondary transition hover:text-vermilion">
                  {APPS_COPY.quiz.selfWrong}
                </button>
              </>
            ) : index < activeQuestions.length - 1 ? (
              <button ref={primaryRef} type="button" onClick={goToNext} className="rounded-full bg-ink px-5 py-2 text-[13.5px] font-medium text-white transition hover:opacity-85 active:scale-[0.98]">
                {APPS_COPY.quiz.nextQuestion} →
              </button>
            ) : allDone ? (
              <button
                ref={primaryRef}
                type="button"
                onClick={() => {
                  setShowReport(true);
                  onLearningActivity?.(formatQuizCompleteActivity({ correct: correctCount, total: activeQuestions.length }));
                  const assessment = buildQuizAssessment(activeQuestions, selected, submitted);
                  if (assessment) onAssessment?.(assessment);
                }}
                className="rounded-full bg-pine px-5 py-2 text-[13.5px] font-medium text-white transition hover:opacity-90 active:scale-[0.98]"
              >
                {APPS_COPY.quiz.viewResult}
              </button>
            ) : firstUnfinishedIndex >= 0 ? (
              // 走到最后一题却还有跳过的：告诉学生差几题、回到哪一题
              <button ref={primaryRef} type="button" onClick={() => navigateTo(firstUnfinishedIndex, 'right')} className="text-[13px] font-medium text-ink transition hover:text-pine">
                {APPS_COPY.quiz.backToUnfinished(activeQuestions.length - finishedCount, firstUnfinishedIndex + 1)}
              </button>
            ) : null}
          </div>
          {showKeyboardHint ? (
            <p className="mt-2.5 hidden text-[11.5px] text-ink-muted/70 md:block">{APPS_COPY.quiz.keyboardHint}</p>
          ) : null}
        </div>
      </div>

      {/* 底栏只剩定位：上一题 · 题点 · 进度数字 */}
      <div className="flex-shrink-0 border-t border-divider-light px-6 pb-3.5 pt-3 md:px-10">
        <div className="mx-auto flex w-full max-w-[600px] items-center gap-4">
          <button
            type="button"
            onClick={goToPrev}
            disabled={index <= 0}
            className="text-[13px] text-ink-muted transition hover:text-ink disabled:invisible"
          >
            ← {APPS_COPY.quiz.previous}
          </button>

          <div className="flex flex-1 items-center justify-center gap-1.5" aria-hidden>
            {activeQuestions.map((question, i) => {
              const done = Boolean(submitted[question.id]);
              const ok = done && isQuizAnswerCorrect(question, selected[question.id]);
              const isCurrent = i === index;
              const dot = done ? (ok ? 'bg-pine' : 'bg-vermilion') : isCurrent ? 'bg-ink-muted' : 'bg-divider';
              return (
                <button
                  key={question.id}
                  type="button"
                  tabIndex={-1}
                  onClick={() => { if (i !== index) navigateTo(i, i > index ? 'left' : 'right'); }}
                  className={`h-1.5 rounded-full transition-all duration-300 ${dot} ${isCurrent ? 'w-5' : 'w-1.5'}`}
                  aria-label={APPS_COPY.quiz.jumpTo(i + 1)}
                />
              );
            })}
          </div>

          <span className="text-[12px] tabular-nums text-ink-muted">{index + 1} / {activeQuestions.length}</span>
        </div>
      </div>
    </div>
  );
}
