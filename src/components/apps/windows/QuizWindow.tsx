'use client';

/**
 * 课堂测验窗口 —— 一份好试卷，不是一叠卡片。
 *
 * 版式原则（2026-09-09 重做）：
 * - 纸面就是窗口：白底、一根 2px 进度线、题号 + 题干 + 选项，没有卡片套卡片、没有 pill 计数
 * - 选项是大而稳的可点面：整行可点、字母圈做状态锚点，选中 / 对 / 错三态只换颜色不弹跳
 * - 一次只见一题；键盘 1–4 选、回车 / 空格确认或下一题、←→ 翻题（useQuizNavigation + app-keys）
 * - 反馈就地出现（解析在题目下方生长），不弹层不打断节奏
 * - 「回到课堂」退成页脚一行小字：这是测验，不是引用系统
 *
 * 交互打磨（2026-09-10）：
 * - 题与题之间两段式切换：离场 150ms（useQuizNavigation）→ 换题 → 进场 220ms（mm-app-enter），新题不再"弹出来"
 * - 交卷揭示：错的先染红，正确项 90ms 后浮出，勾 / 叉一笔画出（QuizOptionMark）
 * - 选项按下 scale 0.98 / 只在有 hover 的设备给 hover 底色（触屏不留 sticky hover）/ pine 焦点环 / 整行 ≥52px
 * - 快捷键提示只出现一次（keyboard-hints）；禁用的「确认答案」说清为什么（title）
 * - 触屏左右滑走 swipe-model 阈值与竖向取消
 * - 结束页圆环从 0 画到答稳率，逐题可点回看；「只练需要回看的」进度线归零 + 内容重新进场
 * 逻辑（对错判定、自评、记忆观测、报告）全部沿用 quiz-window-model / assessment-events。
 *
 * 多选题（2026-09-11 内容层）：type=multiple 的题点选项是切换而不是替换，选中的集合存在同一个 selected 字段里
 * （quiz-answer 的连接符），交卷时集合完全一致才算对；题号旁一枚「多选」小字是唯一的形态提示，其余版式与单选同一套。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuizNavigation } from '@/hooks/useQuizNavigation';
import type { LearningObservationContent } from '@/types/learning-event';
import { buildQuizAttemptObservation } from './quiz-observation';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { formatQuizActivity, formatQuizCompleteActivity } from '@/components/review-learning-activity';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import {
  correctOptionsOf,
  formatQuizAnswerForDisplay,
  formatQuizEvidenceTime,
  isMultipleQuizQuestion,
  isQuizAnswerCorrect,
  isSubjectiveQuizQuestion,
  normalizeQuizQuestions,
  QUIZ_SELF_CORRECT,
  QUIZ_SELF_WRONG,
  selectedOptionsOf,
  stripQuizOptionPrefix,
  toggleMultipleSelection,
} from './quiz-window-model';
import { buildQuizAssessment, type AssessmentDraft } from './assessment-events';
import { NextStepCard, type NextStepCardProps } from './NextStepCard';
import { QuizReport } from './QuizReport';
import { QuizOptionMark, type QuizMarkState } from './QuizOptionMark';
import { MathText } from './MathText';
import { isTypingTarget, resolveQuizKey } from './app-keys';
import { useKeyboardHintOnce } from './keyboard-hints';
import { resolveSwipe } from './swipe-model';
import { useSwipe } from './use-swipe';

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

type OptionState = QuizMarkState;

/** 三态只换颜色：选中 = 墨，对 = 松绿，错 = 朱红；其余在已交卷后退灰 */
const OPTION_ROW: Record<OptionState, string> = {
  idle: 'mm-hover-warm',
  selected: 'bg-paper-warm',
  correct: 'bg-pine-fog',
  wrong: 'bg-vermilion-fog',
  dim: 'opacity-55',
};

const PRIMARY_BTN = 'mm-press mm-focus rounded-full bg-ink px-5 py-2 text-[13.5px] font-medium text-white hover:opacity-85 disabled:cursor-not-allowed disabled:bg-divider disabled:text-ink-muted';

export function QuizWindow({ result, transcript, onSeek, onLearningActivity, onAssessment, nextStep }: QuizWindowProps) {
  const questions = useMemo(() => normalizeQuizQuestions(result), [result]);
  const [reviewQuestionIds, setReviewQuestionIds] = useState<string[] | null>(null);
  const activeQuestions = useMemo(
    () => reviewQuestionIds ? questions.filter((question) => reviewQuestionIds.includes(question.id)) : questions,
    [questions, reviewQuestionIds],
  );
  const { index, setIndex, slideDir, navigateTo, goToNext, goToPrev } = useQuizNavigation(activeQuestions.length);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [showReport, setShowReport] = useState(false);
  /** 从结束页点某题回看：正文只读，底部多一条「回到结果」 */
  const [reviewingFromReport, setReviewingFromReport] = useState(false);
  const [startTime] = useState(() => Date.now());
  const seenReferences = useRef(new Set<string>());
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const showKeyboardHint = useKeyboardHintOnce('quiz');

  const current = activeQuestions[Math.min(index, activeQuestions.length - 1)];
  const selectedOption = current ? selected[current.id] : undefined;
  const isSubmitted = current ? Boolean(submitted[current.id]) : false;
  const subjective = current ? isSubjectiveQuizQuestion(current) : false;
  const multiple = current ? isMultipleQuizQuestion(current) : false;

  /** 点 / 按数字键选一个选项：单选替换，多选切换（空集合回到未选，主按钮随之禁用） */
  const pickOption = useCallback((question: typeof current, option: string) => {
    if (!question) return;
    setSelected((prev) => {
      const next = { ...prev };
      if (isMultipleQuizQuestion(question)) {
        const toggled = toggleMultipleSelection(prev[question.id], option);
        if (toggled) next[question.id] = toggled;
        else delete next[question.id];
      } else {
        next[question.id] = option;
      }
      return next;
    });
  }, []);

  // 换题 / 换轮时正文重新进场（key 变化 → 重挂载 → mm-app-enter）
  const enterKey = `${reviewQuestionIds ? reviewQuestionIds.join(',') : 'all'}:${index}`;

  // 键盘：1–4 选选项（未交卷时），回车 / 空格 = 底部主动作。←→ 由 useQuizNavigation 负责
  useEffect(() => {
    if (!current) return;
    const keyDown = (event: KeyboardEvent): void => {
      const action = resolveQuizKey(event.key, {
        optionCount: current.options.length,
        subjective,
        submitted: isSubmitted,
        typing: isTypingTarget(event.target as HTMLElement | null),
      });
      if (!action) return;
      if (action.type === 'select') {
        event.preventDefault();
        const option = current.options[action.index];
        if (option) pickOption(current, option);
        return;
      }
      if (primaryRef.current && !primaryRef.current.disabled) {
        event.preventDefault();
        primaryRef.current.click();
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [current, isSubmitted, pickOption, subjective]);

  // 触屏左右滑翻题：阈值 / 竖向取消见 swipe-model
  const swipe = useSwipe({
    onRelease: useCallback((sample) => {
      const direction = resolveSwipe(sample);
      if (direction === 'left') goToNext();
      else if (direction === 'right') goToPrev();
    }, [goToNext, goToPrev]),
  });

  if (!result) {
    return <AppWindowPlaceholder status="loading" appKey="quiz" appName={APPS_COPY.quiz.appName} transcript={transcript} />;
  }
  if (questions.length === 0 || !current) {
    return <AppWindowPlaceholder status="empty" appKey="quiz" appName={APPS_COPY.quiz.appName} />;
  }

  const correctOptions = correctOptionsOf(current);
  const chosenOptions = selectedOptionsOf(current, selectedOption);
  const answerDisplay = formatQuizAnswerForDisplay(current);
  const isCorrect = isQuizAnswerCorrect(current, selectedOption);

  function recordAttempt(picked: string, selfAssessment?: 'correct' | 'incorrect'): void {
    const key = JSON.stringify([current.id, current.stem, current.options, current.answer]);
    const observation = buildQuizAttemptObservation({ question: current, picked, selfAssessment, referencePreviouslySeen: seenReferences.current.has(key) });
    seenReferences.current.add(key);
    onLearningActivity?.(formatQuizActivity({
      index: index + 1, total: activeQuestions.length, stem: current.stem,
      picked: multiple ? selectedOptionsOf(current, picked).map(stripQuizOptionPrefix).join('、') : picked,
      answer: answerDisplay, correct: selfAssessment ? selfAssessment === 'correct' : isQuizAnswerCorrect(current, picked),
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
    setReviewingFromReport(false);
  };
  const openReport = () => {
    setShowReport(true);
    setReviewingFromReport(false);
  };
  const progress = activeQuestions.length > 0 ? (finishedCount / activeQuestions.length) * 100 : 0;
  const elapsedMinutes = Math.round((Date.now() - startTime) / 60000);

  const exitClass = slideDir === 'left'
    ? 'translate-x-[-3%] opacity-0'
    : slideDir === 'right'
      ? 'translate-x-[3%] opacity-0'
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
        onReviewQuestion={(questionIndex) => { setShowReport(false); setReviewingFromReport(true); setIndex(questionIndex); }}
        nextStep={nextStep ? <NextStepCard {...nextStep} /> : null}
      />
    );
  }

  const optionStateOf = (option: string): OptionState => {
    const active = chosenOptions.includes(option);
    if (!isSubmitted) return active ? 'selected' : 'idle';
    if (correctOptions.includes(option)) return 'correct';
    if (active) return 'wrong';
    return 'dim';
  };
  // 揭示先后：选错时正确项晚 90ms 浮出，让"你选的错了"先被看见
  const revealDelayOf = (state: OptionState): number => (state === 'correct' && !isCorrect ? 90 : 0);

  const hintVisible = showKeyboardHint && index === 0 && !isSubmitted && !subjective && !reviewQuestionIds;

  return (
    <div
      className="relative flex h-full min-h-[420px] select-none flex-col overflow-hidden bg-white"
      style={{ touchAction: 'pan-y' }}
      {...swipe.handlers}
      data-testid="quiz-window"
    >
      {/* 顶端一根进度线：已完成占比，安静地长（换轮时同样过渡着归零） */}
      <div className="h-[2px] w-full bg-divider-light" aria-hidden>
        <div className="h-full bg-pine transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 md:px-10">
        <div className={`mx-auto w-full max-w-[600px] pt-7 pb-6 transition-[opacity,transform] duration-150 ease-in motion-reduce:transition-none ${exitClass}`}>
          <div key={enterKey} className="mm-app-enter">
            {/* 题号行：第 N 题 · 状态 …… 共 M 题 */}
            <div className="mb-4 flex items-baseline justify-between text-[12px] tabular-nums tracking-[0.04em] text-ink-muted">
              <span>
                {APPS_COPY.quiz.questionNo(index + 1)}
                {multiple ? <span className="ml-2 text-ink-muted/80">{APPS_COPY.quiz.multipleHint}</span> : null}
                {isSubmitted ? (
                  <span className={`ml-3 ${isCorrect ? 'text-pine' : 'text-vermilion'}`}>{isCorrect ? APPS_COPY.quiz.correct : APPS_COPY.quiz.wrong}</span>
                ) : null}
              </span>
              <span>{finishedCount > 0 ? APPS_COPY.quiz.answered(finishedCount, activeQuestions.length) : null}</span>
            </div>

            {/* 题干 */}
            {/* 题干 / 选项 / 解析都可能夹着 $…$ 行内 TeX（v2 prompt 允许数学题用公式），走 MathText 与闪卡同一渲染 */}
            <h2 className="mb-6 text-[19px] font-semibold leading-[1.7] tracking-[-0.015em] text-ink md:text-[21px]">
              <MathText text={current.stem} />
            </h2>

            {subjective ? (
              <div className="space-y-3">
                {!revealed[current.id] ? (
                  <p className="border-l-2 border-divider pl-4 text-[14px] leading-[1.75] text-ink-muted">
                    {APPS_COPY.quiz.subjectivePrompt}
                  </p>
                ) : (
                  <div className="mm-app-enter border-t border-divider pt-4">
                    <p className="mb-1.5 text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.quiz.referenceAnswer}</p>
                    <p className="text-[15px] leading-[1.8] text-ink"><MathText text={current.answer || APPS_COPY.quiz.referenceFallback} /></p>
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
                  const delay = revealDelayOf(state);
                  return (
                    <li key={option}>
                      <button
                        type="button"
                        disabled={isSubmitted}
                        aria-pressed={state === 'selected'}
                        onClick={() => !isSubmitted && pickOption(current, option)}
                        className={`group mm-press mm-focus-inset -mx-3 flex min-h-[52px] w-[calc(100%+1.5rem)] items-start gap-4 rounded-lg px-3 py-3.5 text-left ${OPTION_ROW[state]} ${isSubmitted ? 'cursor-default' : 'cursor-pointer'}`}
                        style={delay ? { transitionDelay: `${delay}ms` } : undefined}
                      >
                        <QuizOptionMark state={state} letter={letter} delayMs={delay} />
                        <span className={`pt-[3px] text-[15.5px] leading-[1.7] transition-colors duration-[280ms] motion-reduce:transition-none ${state === 'correct' ? 'text-ink' : state === 'wrong' ? 'text-vermilion-deep' : state === 'dim' ? 'text-ink-muted' : 'text-ink'}`}>
                          <MathText text={stripQuizOptionPrefix(option)} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}

            {/* 解析：交卷后在题目下方长出来，不套彩色盒子 */}
            {isSubmitted && (current.explanation || (!subjective && !isCorrect)) ? (
              <div className="mt-6 animate-slide-up motion-reduce:animate-none">
                <p className="mb-1.5 text-[12px] tracking-[0.04em] text-ink-muted">{APPS_COPY.quiz.explanationLabel}</p>
                {!subjective && !isCorrect ? (
                  <p className="mb-1.5 text-[14px] font-medium text-vermilion">
                    <MathText text={APPS_COPY.quiz.correctAnswer(answerDisplay)} />
                  </p>
                ) : null}
                {current.explanation ? <p className="text-[14.5px] leading-[1.8] text-ink-secondary"><MathText text={current.explanation} /></p> : null}
              </div>
            ) : null}
            {isSubmitted && current.evidence ? (
              <button
                type="button"
                disabled={!onSeek}
                onClick={() => onSeek?.(current.evidence!.startMs)}
                className="mm-focus mt-5 rounded text-[12px] text-ink-muted/80 transition hover:text-ink disabled:cursor-default"
              >
                {onSeek
                  ? APPS_COPY.quiz.returnToEvidenceAt(formatQuizEvidenceTime(current.evidence.startMs))
                  : APPS_COPY.quiz.evidenceAt(formatQuizEvidenceTime(current.evidence.startMs))}
              </button>
            ) : null}

            {/* 主动作紧跟内容：选完就在手边，不用去窗口底部找 */}
            <div className="mt-7 flex min-h-[38px] items-center gap-3">
              {reviewingFromReport && allDone ? (
                <button ref={primaryRef} type="button" onClick={openReport} className={PRIMARY_BTN}>
                  {APPS_COPY.quiz.backToReport}
                </button>
              ) : !isSubmitted && (!subjective || !revealed[current.id]) ? (
                <button
                  ref={primaryRef}
                  type="button"
                  className={PRIMARY_BTN}
                  disabled={subjective ? false : !selectedOption}
                  title={!subjective && !selectedOption ? APPS_COPY.quiz.pickFirst : undefined}
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
                  <button ref={primaryRef} type="button" onClick={() => selfRate(true)} className="mm-press mm-focus rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white hover:opacity-85">
                    {APPS_COPY.quiz.selfCorrect}
                  </button>
                  <button type="button" onClick={() => selfRate(false)} className="mm-press mm-focus rounded-full px-3 py-2 text-[13px] font-medium text-ink-secondary hover:text-vermilion">
                    {APPS_COPY.quiz.selfWrong}
                  </button>
                </>
              ) : index < activeQuestions.length - 1 ? (
                <button ref={primaryRef} type="button" onClick={goToNext} className={PRIMARY_BTN}>
                  {APPS_COPY.quiz.nextQuestion} →
                </button>
              ) : allDone ? (
                <button
                  ref={primaryRef}
                  type="button"
                  onClick={() => {
                    openReport();
                    onLearningActivity?.(formatQuizCompleteActivity({ correct: correctCount, total: activeQuestions.length }));
                    const assessment = buildQuizAssessment(activeQuestions, selected, submitted);
                    if (assessment) onAssessment?.(assessment);
                  }}
                  className="mm-press mm-focus rounded-full bg-pine px-5 py-2 text-[13.5px] font-medium text-white hover:opacity-90"
                >
                  {APPS_COPY.quiz.viewResult}
                </button>
              ) : firstUnfinishedIndex >= 0 ? (
                // 走到最后一题却还有跳过的：告诉学生差几题、回到哪一题
                <button ref={primaryRef} type="button" onClick={() => navigateTo(firstUnfinishedIndex, 'right')} className="mm-focus rounded text-[13px] font-medium text-ink transition hover:text-pine">
                  {APPS_COPY.quiz.backToUnfinished(activeQuestions.length - finishedCount, firstUnfinishedIndex + 1)}
                </button>
              ) : null}
            </div>
            {hintVisible ? (
              <p className="mt-2.5 text-[11.5px] text-ink-muted/70">{APPS_COPY.quiz.keyboardHint}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* 底栏只剩定位：上一题 · 题点 · 进度数字 */}
      <div className="flex-shrink-0 border-t border-divider-light px-5 pb-3.5 pt-3 md:px-10">
        <div className="mx-auto flex w-full max-w-[600px] items-center gap-4">
          <button
            type="button"
            onClick={goToPrev}
            disabled={index <= 0}
            className="mm-focus rounded text-[13px] text-ink-muted transition hover:text-ink disabled:invisible"
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
                  className={`h-1.5 rounded-full transition-all duration-300 motion-reduce:transition-none ${dot} ${isCurrent ? 'w-5' : 'w-1.5'}`}
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
