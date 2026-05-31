'use client';

/**
 * ClassCheckOverlay — 随堂检验弹窗（v2 精致版）
 *
 * 设计理念：
 * - 磨砂玻璃遮罩 + 居中白色卡片，轻盈不压迫
 * - 三阶段：greeting → quiz → result，自然过渡
 * - 选项卡片化、大触区，适合快速作答
 * - 正确/错误反馈明确但不刺眼
 * - 符合 MeetMind v7 设计宪法：95% 克制（米白纸感 + 双签名色 + 极淡 shadow-soft），5% 仪式时刻（pine pulse / vermilion 朱批反馈）
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

export interface ClassCheckQuestion {
  id: string;
  stem: string;
  options: string[];
  answer: string;
  explanation?: string;
}

export interface ClassCheckResult {
  roundIndex: number;
  questions: ClassCheckQuestion[];
  answers: Record<string, string>;
  correctCount: number;
  totalCount: number;
}

interface ClassCheckOverlayProps {
  questions: ClassCheckQuestion[];
  roundIndex: number;
  topic: string;
  greeting: string;
  encouragement: string;
  nextPreview: string;
  onComplete: (result: ClassCheckResult) => void;
}

function normalizeAnswer(answer: string, options: string[]): string {
  const trimmed = answer.trim();
  if (!trimmed) return '';

  const letterMatch = trimmed.match(/^([A-Za-z])[.、)\s]*$/);
  if (letterMatch) {
    const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) return options[idx];
  }

  const exact = options.find((o) => o.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const prefixedMatch = trimmed.match(/^[A-Za-z][.、)\s]+(.+)/);
  if (prefixedMatch) {
    const content = prefixedMatch[1].trim().toLowerCase();
    const found = options.find((o) => o.replace(/^[A-Za-z][.、)\s]+/, '').trim().toLowerCase() === content);
    if (found) return found;
  }

  const fuzzy = options.find((o) => {
    const stripped = o.replace(/^[A-Za-z][.、)\s]+/, '').trim();
    return stripped.toLowerCase() === trimmed.toLowerCase()
      || stripped.toLowerCase().includes(trimmed.toLowerCase())
      || trimmed.toLowerCase().includes(stripped.toLowerCase());
  });
  if (fuzzy) return fuzzy;

  return trimmed;
}

function stripOptionPrefix(text: string): string {
  return text.replace(/^[A-Za-z][.、)\s]+/, '').trim() || text;
}

type Phase = 'greeting' | 'quiz' | 'result';

/** 主色调 */
const ACCENT = '#B5483C';
const ACCENT_LIGHT = '#FBF2EF';
const ACCENT_BORDER = '#F6E6E2';

// ── 通用遮罩容器（提取到顶层，避免父组件 re-render 导致卸载/重建） ──
function Backdrop({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center px-4 py-6"
      style={{
        backgroundColor: 'rgba(35,35,34,0.45)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        opacity: mounted ? 1 : 0,
        transition: 'opacity 0.25s ease-out',
      }}
    >
      {children}
    </div>
  );
}

export function ClassCheckOverlay({
  questions,
  roundIndex,
  topic,
  greeting,
  encouragement,
  nextPreview,
  onComplete,
}: ClassCheckOverlayProps) {
  const [phase, setPhase] = useState<Phase>(greeting ? 'greeting' : 'quiz');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});

  const current = questions[currentIndex];
  const selectedOption = current ? selected[current.id] : undefined;
  const isSubmitted = current ? Boolean(submitted[current.id]) : false;
  const normalizedAnswer = current ? normalizeAnswer(current.answer, current.options) : '';
  const isCorrect = selectedOption === normalizedAnswer;

  const allAnswered = useMemo(
    () => questions.every((q) => submitted[q.id]),
    [questions, submitted]
  );

  const correctCount = useMemo(
    () => questions.filter((q) => selected[q.id] === normalizeAnswer(q.answer, q.options)).length,
    [questions, selected]
  );

  const handleSubmitAnswer = useCallback(() => {
    if (!current || !selectedOption) return;
    setSubmitted((prev) => ({ ...prev, [current.id]: true }));
  }, [current, selectedOption]);

  const handleNext = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else if (allAnswered) {
      setPhase('result');
    }
  }, [allAnswered, currentIndex, questions.length]);

  const handleComplete = useCallback(() => {
    onComplete({
      roundIndex,
      questions,
      answers: selected,
      correctCount,
      totalCount: questions.length,
    });
  }, [correctCount, onComplete, questions, roundIndex, selected]);

  if (questions.length === 0) return null;

  // ── Greeting 阶段 ──
  if (phase === 'greeting') {
    return (
      <Backdrop>
        <div className="w-full max-w-[380px] rounded-3xl bg-white p-8 text-center"
          style={{ animation: 'classcheck-in 0.25s ease-out' }}
        >
          {/* 顶部标记 */}
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ backgroundColor: ACCENT_LIGHT }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="2" width="18" height="16" rx="3" fill={ACCENT} opacity="0.9" />
              <text x="12" y="13" textAnchor="middle" fill="white" fontSize="12" fontWeight="700" fontFamily="system-ui">?</text>
              <line x1="6" y1="18" x2="6" y2="22" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>

          {topic && (
            <p className="mb-2 text-[11px] font-semibold tracking-widest uppercase text-[#8E8B82]">{topic}</p>
          )}

          <p className="text-[15px] leading-[1.8] text-[#1C1B19]">{greeting}</p>

          <button
            type="button"
            onClick={() => setPhase('quiz')}
            className="mt-7 w-full rounded-2xl py-3.5 text-[14px] font-semibold text-white transition-colors"
            style={{ backgroundColor: ACCENT }}
          >
            开始检验
          </button>
        </div>
        <style>{`@keyframes classcheck-in { from { opacity:0; transform:scale(0.95) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); }}`}</style>
      </Backdrop>
    );
  }

  // ── Result 阶段 ──
  if (phase === 'result') {
    const accuracy = Math.round((correctCount / questions.length) * 100);
    const ringColor = accuracy >= 80 ? '#2D4F3E' : accuracy >= 60 ? '#B8842B' : '#B5483C';
    const ringBg = accuracy >= 80 ? '#E6EDE8' : accuracy >= 60 ? '#FBF1DC' : '#F6E6E2';
    const dynamicEncouragement = encouragement || (
      accuracy === 100 ? '完全掌握了，继续保持！'
        : accuracy >= 60 ? '大部分理解了，有个别地方可以再巩固。'
        : '这段内容有些难度，建议回放再听一遍。'
    );
    const wrongQuestions = questions.filter((q) => selected[q.id] !== normalizeAnswer(q.answer, q.options));

    return (
      <Backdrop>
        <div className="w-full max-w-[400px] max-h-[85vh] overflow-y-auto rounded-3xl bg-white p-7 text-center"
          style={{ animation: 'classcheck-in 0.25s ease-out' }}
        >
          {/* 环形得分 */}
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: ringBg }}
          >
            <div className="flex flex-col items-center">
              <span className="text-2xl font-bold leading-none" style={{ color: ringColor }}>
                {correctCount}
              </span>
              <span className="mt-0.5 text-[11px] text-[#8E8B82]">/ {questions.length}</span>
            </div>
          </div>

          {topic && (
            <p className="mb-1 text-[11px] font-semibold tracking-widest uppercase text-[#8E8B82]">{topic}</p>
          )}
          <p className="text-[14px] leading-[1.7] text-[#5C5A55]">{dynamicEncouragement}</p>

          {/* 错题简报 */}
          {wrongQuestions.length > 0 && (
            <div className="mt-5 space-y-2 text-left">
              <p className="text-[11px] font-medium text-[#8E8B82] px-1">需要巩固的题目</p>
              {wrongQuestions.map((q) => (
                <div key={q.id} className="rounded-2xl border border-[#F6E6E2] bg-[#FBF2EF] px-4 py-3">
                  <p className="text-[13px] text-[#1C1B19] leading-relaxed line-clamp-2">{q.stem}</p>
                  <div className="mt-1.5 flex items-start gap-1.5">
                    <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    <p className="text-[12px] text-pine leading-relaxed">{stripOptionPrefix(normalizeAnswer(q.answer, q.options))}</p>
                  </div>
                  {q.explanation && (
                    <p className="mt-1 text-[11px] text-[#8E8B82] leading-relaxed">{q.explanation}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 下一段预告 */}
          {nextPreview && (
            <div className="mt-5 rounded-2xl border border-[#E8E2D5] bg-[#FAF7F2] px-4 py-3 text-left">
              <p className="text-[11px] font-medium text-[#8E8B82] mb-1">接下来注意</p>
              <p className="text-[13px] leading-[1.7] text-[#5C5A55]">{nextPreview}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleComplete}
            className="mt-6 w-full rounded-2xl py-3.5 text-[14px] font-semibold text-white transition-colors"
            style={{ backgroundColor: ACCENT }}
          >
            继续看视频
          </button>
        </div>
        <style>{`@keyframes classcheck-in { from { opacity:0; transform:scale(0.95) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); }}`}</style>
      </Backdrop>
    );
  }

  // ── Quiz 阶段 ──
  const optionLetters = 'ABCDEFGH';

  return (
    <Backdrop>
      <div className="w-full max-w-[440px] max-h-[90vh] overflow-y-auto rounded-3xl bg-white"
        style={{ animation: 'classcheck-in 0.25s ease-out' }}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg"
              style={{ backgroundColor: ACCENT_LIGHT }}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="1" width="12" height="10" rx="2" fill={ACCENT} opacity="0.85" />
                <text x="8" y="8.5" textAnchor="middle" fill="white" fontSize="8" fontWeight="700" fontFamily="system-ui">?</text>
                <line x1="4" y1="11" x2="4" y2="15" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span className="text-[12px] font-medium text-[#5C5A55]">{topic || '随堂检验'}</span>
          </div>
          {/* 进度 pills */}
          <div className="flex items-center gap-1">
            {questions.map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === currentIndex ? 16 : 6,
                  backgroundColor: i < currentIndex
                    ? (submitted[questions[i].id] && selected[questions[i].id] === normalizeAnswer(questions[i].answer, questions[i].options) ? '#2D4F3E' : '#B5483C')
                    : i === currentIndex ? ACCENT : '#E8E2D5',
                }}
              />
            ))}
          </div>
        </div>

        {/* 分隔线 */}
        <div className="mx-5 h-px bg-[#E8E2D5]" />

        {/* 题干区 */}
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[15px] font-semibold leading-[1.7] text-[#1C1B19]">
            {current.stem}
          </h2>
        </div>

        {/* 选项区 */}
        <div className="px-5 pb-3 space-y-2">
          {current.options.map((option, optIdx) => {
            const letter = optionLetters[optIdx] || String(optIdx + 1);
            const active = selectedOption === option;
            const optionCorrect = isSubmitted && option === normalizedAnswer;
            const optionWrong = isSubmitted && active && !isCorrect;
            const isDisabled = isSubmitted;

            // 状态样式
            let borderColor = '#E8E2D5';
            let bgColor = '#FFFFFF';
            let letterBg = '#FAF7F2';
            let letterColor = '#5C5A55';
            let textColor = '#1C1B19';

            if (optionCorrect) {
              borderColor = '#93B5A4';
              bgColor = '#E6EDE8';
              letterBg = '#2D4F3E';
              letterColor = '#FFFFFF';
              textColor = '#1A3327';
            } else if (optionWrong) {
              borderColor = '#D17969';
              bgColor = '#FBF2EF';
              letterBg = '#B5483C';
              letterColor = '#FFFFFF';
              textColor = '#8E3328';
            } else if (active && !isSubmitted) {
              borderColor = ACCENT;
              bgColor = ACCENT_LIGHT;
              letterBg = ACCENT;
              letterColor = '#FFFFFF';
            }

            return (
              <button
                key={option}
                type="button"
                disabled={isDisabled}
                onClick={() => !isDisabled && setSelected((prev) => ({ ...prev, [current.id]: option }))}
                className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all ${isDisabled ? 'cursor-default' : 'cursor-pointer active:scale-[0.98]'}`}
                style={{ borderColor, backgroundColor: bgColor }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold"
                  style={{ backgroundColor: letterBg, color: letterColor }}
                >
                  {letter}
                </span>
                <span className="flex-1 text-[14px] leading-relaxed" style={{ color: textColor }}>
                  {stripOptionPrefix(option)}
                </span>
                {optionCorrect && (
                  <svg className="ml-auto h-5 w-5 shrink-0 text-pine" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                )}
                {optionWrong && (
                  <svg className="ml-auto h-5 w-5 shrink-0 text-vermilion/65" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                )}
              </button>
            );
          })}
        </div>

        {/* 解析区 */}
        {isSubmitted && current.explanation && (
          <div className="mx-5 mb-3">
            <div className={`rounded-2xl px-4 py-3 ${isCorrect ? 'bg-[#E6EDE8] border border-[#93B5A4]' : 'bg-[#FBF2EF] border border-[#D17969]'}`}>
              {!isCorrect && (
                <p className="text-[12px] font-medium text-pine mb-1">
                  正确答案：{stripOptionPrefix(normalizedAnswer)}
                </p>
              )}
              <p className="text-[12px] text-[#5C5A55] leading-relaxed">{current.explanation}</p>
            </div>
          </div>
        )}

        {/* 底栏按钮 */}
        <div className="px-5 pb-5 pt-2">
          {!isSubmitted ? (
            <button
              type="button"
              disabled={!selectedOption}
              onClick={handleSubmitAnswer}
              className="w-full rounded-2xl py-3.5 text-[14px] font-semibold text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ backgroundColor: ACCENT }}
            >
              确认
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              className="w-full rounded-2xl border border-[#E8E2D5] bg-[#FAF7F2] py-3.5 text-[14px] font-semibold text-[#1C1B19] transition-colors hover:bg-[#F2EDE3]"
            >
              {currentIndex < questions.length - 1 ? '下一题' : '查看结果'}
            </button>
          )}
        </div>
      </div>
      <style>{`@keyframes classcheck-in { from { opacity:0; transform:scale(0.95) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); }}`}</style>
    </Backdrop>
  );
}

export default ClassCheckOverlay;
