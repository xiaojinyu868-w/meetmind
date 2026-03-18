'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';

interface QuizWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
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

/* 题目色调 — 每道题有不同的环境光 */
const QUESTION_THEMES = [
  { accent: '#6366f1', glow: 'rgba(99,102,241,0.12)', bg: 'from-[#1a1f35] to-[#0d1117]' },
  { accent: '#3b82f6', glow: 'rgba(59,130,246,0.12)', bg: 'from-[#1a2332] to-[#0d1117]' },
  { accent: '#8b5cf6', glow: 'rgba(139,92,246,0.12)', bg: 'from-[#2a1f35] to-[#0d1117]' },
  { accent: '#06b6d4', glow: 'rgba(6,182,212,0.12)', bg: 'from-[#122830] to-[#0d1117]' },
  { accent: '#f59e0b', glow: 'rgba(245,158,11,0.12)', bg: 'from-[#2a2520] to-[#0d1117]' },
];

export function QuizWindow({ result }: QuizWindowProps) {
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
    return <AppWindowPlaceholder status="loading" appName="测验工坊" />;
  }
  if (questions.length === 0) {
    return <AppWindowPlaceholder status="empty" appName="测验工坊" />;
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
  const theme = QUESTION_THEMES[index % QUESTION_THEMES.length];

  const slideClass = slideDir === 'left'
    ? 'translate-x-[-8%] opacity-0 scale-95'
    : slideDir === 'right'
      ? 'translate-x-[8%] opacity-0 scale-95'
      : 'translate-x-0 opacity-100 scale-100';

  // 成绩报告
  if (showReport && allDone) {
    const grade = accuracy >= 90 ? 'A' : accuracy >= 80 ? 'B' : accuracy >= 70 ? 'C' : accuracy >= 60 ? 'D' : 'F';
    const gradeColor = accuracy >= 80 ? '#10b981' : accuracy >= 60 ? '#f59e0b' : '#ef4444';
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center p-6 bg-[#0d1117]">
        {/* Ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-20"
            style={{ background: `radial-gradient(circle, ${gradeColor} 0%, transparent 70%)` }} />
        </div>

        <div className="relative text-center z-10 w-full max-w-sm">
          {/* Grade badge */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-4"
            style={{ background: `linear-gradient(135deg, ${gradeColor}30, transparent)`, border: `2px solid ${gradeColor}40` }}>
            <span className="text-3xl font-black" style={{ color: gradeColor }}>{grade}</span>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">测验完成</h2>
          <p className="text-white/40 text-sm mb-6">
            共 {questions.length} 题 · 用时 {elapsedMinutes < 1 ? '<1' : elapsedMinutes} 分钟
          </p>

          {/* Score ring */}
          <div className="relative inline-flex items-center justify-center w-32 h-32 mb-6">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={gradeColor}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${accuracy * 2.64} 264`}
                style={{ transition: 'stroke-dasharray 1s ease-out' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-white">{accuracy}%</span>
              <span className="text-xs text-white/40">正确率</span>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-10 mb-6">
            <div className="text-center">
              <div className="text-xl font-bold text-[#787774]">{correctCount}</div>
              <div className="text-xs text-white/40 mt-0.5">正确</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-center">
              <div className="text-xl font-bold text-rose-400">{finishedCount - correctCount}</div>
              <div className="text-xs text-white/40 mt-0.5">错误</div>
            </div>
          </div>

          {/* Wrong questions preview */}
          {wrongQuestions.length > 0 && (
            <div className="mb-6 max-h-[160px] overflow-y-auto px-1">
              <p className="text-xs text-white/30 mb-2 uppercase tracking-wider">错题回顾</p>
              <div className="space-y-1.5">
                {wrongQuestions.map((q) => {
                  const qIndex = questions.indexOf(q);
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => { setShowReport(false); setIndex(qIndex); setShowExplanation(true); }}
                      className="w-full rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-left hover:bg-rose-500/15 transition-colors"
                    >
                      <p className="text-sm text-white/80 truncate">
                        <span className="text-rose-400 font-medium mr-1.5">#{qIndex + 1}</span>
                        {q.stem.length > 40 ? q.stem.slice(0, 40) + '...' : q.stem}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3 items-center">
            {wrongQuestions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowReport(false);
                  const firstWrong = questions.findIndex((q) => submitted[q.id] && selected[q.id] !== normalizeAnswer(q.answer, q.options));
                  if (firstWrong >= 0) { setIndex(firstWrong); setShowExplanation(true); }
                }}
                className="rounded-full bg-white/10 border border-white/10 px-8 py-2.5 text-sm font-medium text-white hover:bg-white/15 transition-all"
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
              className="rounded-full px-8 py-2.5 text-sm text-white/50 hover:text-white/80 transition-colors"
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
      className="relative flex h-full min-h-[420px] flex-col select-none overflow-hidden bg-[#0d1117]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="quiz-window"
    >
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none transition-all duration-700" style={{
        background: `radial-gradient(ellipse 600px 400px at 50% 35%, ${theme.glow}, transparent 70%)`,
      }} />

      {/* Top: keyboard hint (desktop only) */}
      <div className="relative flex-shrink-0 pt-3 pb-1 text-center hidden md:block">
        <p className="text-[11px] text-white/25 tracking-wider">
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
          className="absolute left-3 md:left-6 top-1/3 z-10 group flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-0 disabled:pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}
          aria-label="上一题"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-white/50 group-hover:text-white transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Card container with slide animation */}
        <div className={`w-full max-w-[420px] py-4 transition-all duration-250 ease-out ${slideClass}`}>
          {/* Question card */}
          <div
            className={`rounded-[20px] bg-gradient-to-br ${theme.bg} p-6 md:p-7`}
            style={{
              boxShadow: `0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.05)`,
            }}
          >
            {/* Question number badge */}
            <div className="flex items-center gap-2 mb-5">
              <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1"
                style={{ background: `${theme.accent}15`, border: `1px solid ${theme.accent}25` }}>
                <span className="text-[11px] font-semibold tracking-wider" style={{ color: theme.accent }}>
                  {index + 1} / {questions.length}
                </span>
              </div>
              {isSubmitted && (
                <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  isCorrect
                    ? 'bg-[#232322]/15 text-[#787774] border border-[#D1F4E0]/20'
                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isCorrect ? 'bg-[#D1F4E0]' : 'bg-rose-400'}`} />
                  {isCorrect ? '正确' : '错误'}
                </div>
              )}
            </div>

            {/* Question stem */}
            <h2 className="text-[16px] md:text-[18px] font-semibold leading-[1.7] text-white/90 tracking-wide mb-6">
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

                let optionStyle = 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.15]';
                let letterStyle = 'bg-white/10 text-white/60';

                if (optionCorrect) {
                  optionStyle = 'bg-[#232322]/15 border-[#D1F4E0]/30';
                  letterStyle = 'bg-[#232322] text-white';
                } else if (optionWrong) {
                  optionStyle = 'bg-rose-500/15 border-rose-500/30';
                  letterStyle = 'bg-rose-500 text-white';
                } else if (active && !isSubmitted) {
                  optionStyle = `border-[${theme.accent}] bg-[${theme.accent}]/10`;
                  letterStyle = `bg-[${theme.accent}] text-white`;
                }

                // Use inline styles for dynamic accent color
                const inlineStyle: React.CSSProperties = {};
                const inlineLetterStyle: React.CSSProperties = {};
                if (active && !isSubmitted && !optionCorrect && !optionWrong) {
                  optionStyle = 'border-transparent';
                  inlineStyle.background = `${theme.accent}15`;
                  inlineStyle.borderColor = `${theme.accent}50`;
                  inlineLetterStyle.background = theme.accent;
                  inlineLetterStyle.color = '#fff';
                  letterStyle = '';
                }

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
                    <span className={`text-[14px] md:text-[15px] leading-relaxed ${
                      optionCorrect ? 'text-[#D1F4E0]' : optionWrong ? 'text-rose-300' : 'text-white/80'
                    }`}>
                      {stripOptionPrefix(option)}
                    </span>
                    {/* Correct/wrong indicator */}
                    {optionCorrect && (
                      <svg className="ml-auto h-5 w-5 shrink-0 text-[#787774]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                    {optionWrong && (
                      <svg className="ml-auto h-5 w-5 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Explanation section (slide down after submit) */}
            {isSubmitted && (showExplanation || current.explanation) && (
              <div className={`mt-5 rounded-xl p-4 transition-all duration-300 ${
                isCorrect ? 'bg-[#232322]/10 border border-[#D1F4E0]/15' : 'bg-rose-500/10 border border-rose-500/15'
              }`}>
                {!isCorrect && (
                  <p className="text-sm text-rose-400 font-medium mb-1.5">
                    正确答案：{stripOptionPrefix(normalizedAnswer)}
                  </p>
                )}
                {current.explanation && (
                  <p className="text-[13px] text-white/60 leading-relaxed">{current.explanation}</p>
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
          className="absolute right-3 md:right-6 top-1/3 z-10 group flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-0 disabled:pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}
          aria-label="下一题"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-white/50 group-hover:text-white transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
              className="rounded-full px-8 py-2.5 text-sm font-medium transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: selectedOption ? `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)` : 'rgba(255,255,255,0.04)',
                color: selectedOption ? '#fff' : 'rgba(255,255,255,0.3)',
                boxShadow: selectedOption ? `0 4px 20px ${theme.accent}40` : 'none',
              }}
              disabled={!selectedOption}
              onClick={() => {
                setSubmitted((prev) => ({ ...prev, [current.id]: true }));
                setShowExplanation(true);
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
                  className="rounded-full px-8 py-2.5 text-sm font-medium text-white transition-all duration-200 active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent}cc)`,
                    boxShadow: `0 4px 20px ${theme.accent}40`,
                  }}
                >
                  下一题 →
                </button>
              ) : allDone ? (
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  className="rounded-full px-8 py-2.5 text-sm font-medium text-white transition-all duration-200 active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, #10b981, #059669)`,
                    boxShadow: `0 4px 20px rgba(16,185,129,0.4)`,
                  }}
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
              let dotColor = 'bg-white/10';
              if (done) dotColor = ok ? 'bg-[#232322]' : 'bg-rose-500';
              else if (isCurrent) dotColor = '';
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => { if (i !== index) navigateTo(i, i > index ? 'left' : 'right'); }}
                  className={`h-2 rounded-full transition-all duration-300 ${dotColor} ${isCurrent ? 'w-6' : 'w-2'}`}
                  style={isCurrent && !done ? { background: theme.accent } : undefined}
                  aria-label={`跳到第 ${i + 1} 题`}
                />
              );
            })}
          </div>

          {/* Thin progress bar */}
          <div className="w-full flex items-center gap-3">
            <div className="flex-1 h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent}cc)`,
                }}
              />
            </div>
            <span className="text-[11px] text-white/30 tabular-nums whitespace-nowrap tracking-wider">
              {finishedCount} / {questions.length} 已答
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
