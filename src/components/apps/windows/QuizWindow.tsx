'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { formatQuizActivity, formatQuizCompleteActivity } from '@/components/review-learning-activity';

interface QuizWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string) => void;
}

interface QuizQuestion {
  id: string;
  title?: string;
  stem: string;
  options: string[];
  answer: string;
  explanation?: string;
}

function normalizeQuestions(result: AppExecutionResult | null): QuizQuestion[] {
  if (!result) return [];
  const payload = result.render?.payload as { questions?: Array<Record<string, unknown>> } | undefined;
  const payloadQuestions = Array.isArray(payload?.questions)
    ? payload.questions
        .map((item, index) => ({
          id: typeof item.id === 'string' ? item.id : `quiz-${index + 1}`,
          title: typeof item.title === 'string' ? item.title : `题目 ${index + 1}`,
          stem: typeof item.stem === 'string' ? item.stem : '',
          options: Array.isArray(item.options)
            ? item.options.map((option) => (typeof option === 'string' ? option : '')).filter(Boolean)
            : [],
          answer: typeof item.answer === 'string' ? item.answer : '',
          explanation: typeof item.explanation === 'string' ? item.explanation : '',
        }))
        .filter((question) => question.stem && question.options.length >= 2)
    : [];
  if (payloadQuestions.length > 0) return payloadQuestions;

  return result.cards
    .filter((card) => card.meta?.cardKind === 'quiz')
    .map((card, index) => ({
      id: card.id,
      title: card.title || `题目 ${index + 1}`,
      stem: typeof card.meta?.stem === 'string' ? card.meta.stem : card.body,
      options: Array.isArray(card.meta?.options)
        ? card.meta.options.map((option) => (typeof option === 'string' ? option : '')).filter(Boolean)
        : [],
      answer: typeof card.meta?.answer === 'string' ? card.meta.answer : '',
      explanation: typeof card.meta?.explanation === 'string' ? card.meta.explanation : '',
    }))
    .filter((question) => question.stem && question.options.length >= 2);
}

function normalizeAnswer(answer: string, options: string[]): string {
  const trimmed = answer.trim();
  if (!trimmed) return '';

  // 1. 纯字母匹配 — 仅当 answer 是 "A" / "B." / "C)" 等短模式时才走字母索引
  const letterMatch = trimmed.match(/^([A-Za-z])[.、)\s]*$/);
  if (letterMatch) {
    const letterIndex = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (letterIndex >= 0 && letterIndex < options.length) return options[letterIndex];
  }

  // 2. 精确匹配（忽略大小写）
  const exact = options.find((o) => o.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  // 3. "A. 选项内容" 格式 — answer 带字母前缀，去掉后匹配
  const prefixedMatch = trimmed.match(/^[A-Za-z][.、)\s]+(.+)/);
  if (prefixedMatch) {
    const content = prefixedMatch[1].trim().toLowerCase();
    const found = options.find((o) => {
      const stripped = o.replace(/^[A-Za-z][.、)\s]+/, '').trim();
      return stripped.toLowerCase() === content;
    });
    if (found) return found;
  }

  // 4. 模糊包含匹配 — 处理模型返回选项原文（不带字母前缀）的情况
  //    例如 answer="栈只允许在栈顶插入和删除"，options=["A. 栈只允许在栈顶插入和删除", ...]
  const fuzzy = options.find((o) => {
    const stripped = o.replace(/^[A-Za-z][.、)\s]+/, '').trim();
    return stripped.toLowerCase() === trimmed.toLowerCase()
      || stripped.toLowerCase().includes(trimmed.toLowerCase())
      || trimmed.toLowerCase().includes(stripped.toLowerCase());
  });
  if (fuzzy) return fuzzy;

  return trimmed;
}

/** 去除选项文本的字母前缀（"A. 选项" → "选项"），避免和前端圆形字母标签重复 */
function stripOptionPrefix(text: string): string {
  return text.replace(/^[A-Za-z][.、)\s]+/, '').trim() || text;
}

/* 测验保持安静平涂：用排版和状态区分，不用题目环境光。 */
const QUIZ_SUCCESS = '#2D6A4F';
const QUIZ_WARNING = '#B8842B';
const QUIZ_DANGER = '#B5483C';

export function QuizWindow({ result, onLearningActivity }: QuizWindowProps) {
  const questions = useMemo(() => normalizeQuestions(result), [result]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});
  const [showReport, setShowReport] = useState(false);
  const [startTime] = useState(() => Date.now());
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');
  const [showExplanation, setShowExplanation] = useState(false);

  // Swipe gesture
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const navigateTo = useCallback((newIndex: number, dir: 'left' | 'right') => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSlideDir(dir);
    setShowExplanation(false);
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
    if (index >= questions.length - 1 || isAnimating) return;
    navigateTo(index + 1, 'left');
  }, [index, questions.length, isAnimating, navigateTo]);

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
    return <AppWindowPlaceholder status="loading" appName="课堂测验" />;
  }
  if (questions.length === 0) {
    return <AppWindowPlaceholder status="empty" appName="课堂测验" />;
  }

  const current = questions[Math.min(index, questions.length - 1)];
  const selectedOption = selected[current.id];
  const isSubmitted = Boolean(submitted[current.id]);
  const normalizedAnswer = normalizeAnswer(current.answer, current.options);
  const isCorrect = selectedOption ? selectedOption === normalizedAnswer : false;

  const finishedCount = Object.values(submitted).filter(Boolean).length;
  const correctCount = questions.filter((q) => submitted[q.id] && selected[q.id] === normalizeAnswer(q.answer, q.options)).length;
  const allDone = finishedCount === questions.length;
  const wrongQuestions = questions.filter((q) => submitted[q.id] && selected[q.id] !== normalizeAnswer(q.answer, q.options));
  const accuracy = finishedCount > 0 ? Math.round((correctCount / finishedCount) * 100) : 0;
  const progress = questions.length > 0 ? ((index + 1) / questions.length) * 100 : 0;
  const elapsedMinutes = Math.round((Date.now() - startTime) / 60000);

  const slideClass = slideDir === 'left'
    ? 'translate-x-[-8%] opacity-0 scale-95'
    : slideDir === 'right'
      ? 'translate-x-[8%] opacity-0 scale-95'
      : 'translate-x-0 opacity-100 scale-100';

  // 成绩报告
  if (showReport && allDone) {
    const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : accuracy >= 60 ? 'D' : 'F';
    const gradeColor = accuracy >= 80 ? QUIZ_SUCCESS : accuracy >= 60 ? QUIZ_WARNING : QUIZ_DANGER;
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md text-center">
          {/* Grade badge */}
          <div className="mb-5 inline-flex h-20 w-20 items-center justify-center rounded-full border border-divider bg-white">
            <span className="text-3xl font-semibold" style={{ color: gradeColor }}>{grade}</span>
          </div>

          <h2 className="mb-2 text-2xl font-semibold tracking-[-0.03em] text-ink">测验完成</h2>
          <p className="mb-7 text-sm leading-relaxed text-ink-muted">
            共 {questions.length} 题 · 用时 {elapsedMinutes < 1 ? '<1' : elapsedMinutes} 分钟
          </p>

          {/* Score ring */}
          <div className="relative inline-flex items-center justify-center w-32 h-32 mb-6">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#E8E2D5" strokeWidth="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={gradeColor}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${accuracy * 2.64} 264`}
                style={{ transition: 'stroke-dasharray 1s ease-out' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-semibold text-ink">{accuracy}%</span>
              <span className="text-xs text-ink-muted">正确率</span>
            </div>
          </div>

          {/* Stats */}
          <div className="mb-6 flex items-center justify-center gap-10">
            <div className="text-center">
              <div className="text-xl font-semibold text-ink">{correctCount}</div>
              <div className="mt-1 text-xs text-ink-muted">正确</div>
            </div>
            <div className="h-8 w-px bg-divider" />
            <div className="text-center">
              <div className="text-xl font-semibold text-danger-500">{finishedCount - correctCount}</div>
              <div className="mt-1 text-xs text-ink-muted">错误</div>
            </div>
          </div>

          {/* Wrong questions preview */}
          {wrongQuestions.length > 0 && (
            <div className="mb-6 max-h-[160px] overflow-y-auto px-1">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-ink-muted">错题回顾</p>
              <div className="space-y-1.5">
                {wrongQuestions.map((q) => {
                  const qIndex = questions.indexOf(q);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => { setShowReport(false); setIndex(qIndex); setShowExplanation(true); }}
                      className="w-full rounded-2xl border border-divider bg-white px-4 py-3 text-left transition-colors hover:border-danger-300"
                    >
                      <p className="truncate text-sm text-ink-secondary">
                        <span className="mr-1.5 font-medium text-danger-500">#{qIndex + 1}</span>
                        {q.stem.length > 40 ? q.stem.slice(0, 40) + '...' : q.stem}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col items-center gap-3">
            {wrongQuestions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowReport(false);
                  const firstWrong = questions.findIndex((q) => submitted[q.id] && selected[q.id] !== normalizeAnswer(q.answer, q.options));
                  if (firstWrong >= 0) { setIndex(firstWrong); setShowExplanation(true); }
                }}
                className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85"
              >
                复习错题
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIndex(0);
                setSelected({});
                setSubmitted({});
                setShowReport(false);
                setShowExplanation(false);
              }}
              className="rounded-full px-8 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              重新测验
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
          ← → 切换题目
        </p>
      </div>

      {/* Question area */}
      <div className="relative flex-1 flex items-start justify-center px-4 md:px-12 min-h-0 overflow-y-auto">
        {/* Left arrow */}
        <button
          type="button"
          onClick={goToPrev}
          disabled={index <= 0}
          className="group absolute left-3 top-1/3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-divider bg-white transition-colors duration-200 hover:border-ink-muted disabled:pointer-events-none disabled:opacity-0 md:left-6"
          aria-label="上一题"
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
                  {index + 1} / {questions.length}
                </span>
              </div>
              {isSubmitted && (
                <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium ${
                  isCorrect
                    ? 'border-mint-200 bg-mint-50 text-ink-secondary'
                    : 'border-danger-200 bg-danger-50 text-danger-700'
                }`}>
                  <div className={`h-1.5 w-1.5 rounded-full ${isCorrect ? 'bg-mint-500' : 'bg-danger-500'}`} />
                  {isCorrect ? '正确' : '错误'}
                </div>
              )}
            </div>

            {/* Question stem */}
            <h2 className="mb-6 text-[18px] font-semibold leading-[1.75] tracking-[-0.02em] text-ink md:text-[20px]">
              {current.stem}
            </h2>

            {/* Options */}
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
                      {stripOptionPrefix(option)}
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

            {/* Explanation section (slide down after submit) */}
            {isSubmitted && (showExplanation || current.explanation) && (
              <div className={`mt-6 rounded-2xl border p-4 transition-all duration-300 ${
                isCorrect ? 'border-mint-200 bg-mint-50' : 'border-danger-200 bg-danger-50'
              }`}>
                {!isCorrect && (
                  <p className="mb-2 text-sm font-medium text-danger-700">
                    正确答案：{stripOptionPrefix(normalizedAnswer)}
                  </p>
                )}
                {current.explanation && (
                  <p className="text-[14px] leading-[1.75] text-ink-secondary">{current.explanation}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={goToNext}
          disabled={index >= questions.length - 1}
          className="group absolute right-3 top-1/3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-divider bg-white transition-colors duration-200 hover:border-ink-muted disabled:pointer-events-none disabled:opacity-0 md:right-6"
          aria-label="下一题"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-muted transition-colors group-hover:text-ink" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      <div className="relative flex-shrink-0 px-4 pb-5 pt-2">
        {/* Action button */}
        <div className="flex items-center justify-center gap-3 mb-4">
          {!isSubmitted ? (
            <button
              type="button"
              className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85 active:scale-95 disabled:cursor-not-allowed disabled:bg-divider disabled:text-ink-muted"
              disabled={!selectedOption}
              onClick={() => {
                setSubmitted((prev) => ({ ...prev, [current.id]: true }));
                setShowExplanation(true);
                onLearningActivity?.(formatQuizActivity({
                  index: index + 1,
                  total: questions.length,
                  stem: current.stem,
                  picked: selectedOption || '',
                  answer: normalizedAnswer,
                  correct: isCorrect,
                }));
              }}
            >
              确认答案
            </button>
          ) : (
            <>
              {index < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={goToNext}
                  className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85 active:scale-95"
                >
                  下一题 →
                </button>
              ) : allDone ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowReport(true);
                    onLearningActivity?.(formatQuizCompleteActivity({ correct: correctCount, total: questions.length }));
                  }}
                  className="rounded-full bg-ink px-8 py-2.5 text-sm font-medium text-white transition hover:opacity-85 active:scale-95"
                >
                  查看成绩
                </button>
              ) : null}
            </>
          )}
        </div>

        {/* Progress dots + bar */}
        <div className="flex flex-col items-center gap-2 max-w-[420px] mx-auto">
          {/* Mini dots */}
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {questions.map((q, i) => {
              const done = Boolean(submitted[q.id]);
              const chosen = selected[q.id];
              const ans = normalizeAnswer(q.answer, q.options);
              const ok = done && chosen === ans;
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
                  aria-label={`跳到第 ${i + 1} 题`}
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
              {finishedCount} / {questions.length} 已答
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
