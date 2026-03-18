'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';

interface FlashcardsWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
}

interface FlashcardItem {
  id: string;
  title?: string;
  front: string;
  back: string;
  hint?: string;
}

function normalizeCards(result: AppExecutionResult | null): FlashcardItem[] {
  if (!result) return [];
  const payload = result.render?.payload as { cards?: Array<Record<string, unknown>> } | undefined;
  const cardsFromPayload = Array.isArray(payload?.cards)
    ? payload.cards
        .map((item, index) => ({
          id: typeof item.id === 'string' ? item.id : `payload-card-${index + 1}`,
          title: typeof item.title === 'string' ? item.title : `闪卡 ${index + 1}`,
          front: typeof item.front === 'string' ? item.front : '',
          back: typeof item.back === 'string' ? item.back : '',
          hint: typeof item.hint === 'string' ? item.hint : undefined,
        }))
        .filter((item) => item.front && item.back)
    : [];

  if (cardsFromPayload.length > 0) return cardsFromPayload;

  return result.cards
    .filter((card) => card.meta?.cardKind === 'flashcard')
    .map((card, index) => ({
      id: card.id,
      title: card.title || `闪卡 ${index + 1}`,
      front: typeof card.meta?.front === 'string' ? card.meta.front : card.body,
      back: typeof card.meta?.back === 'string' ? card.meta.back : '',
      hint: typeof card.meta?.hint === 'string' ? card.meta.hint : undefined,
    }))
    .filter((item) => item.front && item.back);
}

type MasteryScore = 'missed' | 'got';

/* 卡片渐变色调 — 根据索引循环，营造视觉多样性 */
const CARD_THEMES = [
  { bg: 'from-[#1a1f35] to-[#0d1117]', accent: '#6366f1', glow: 'rgba(99,102,241,0.15)' },
  { bg: 'from-[#1a2332] to-[#0d1117]', accent: '#3b82f6', glow: 'rgba(59,130,246,0.15)' },
  { bg: 'from-[#1a2f2a] to-[#0d1117]', accent: '#10b981', glow: 'rgba(16,185,129,0.15)' },
  { bg: 'from-[#2a1f35] to-[#0d1117]', accent: '#8b5cf6', glow: 'rgba(139,92,246,0.15)' },
  { bg: 'from-[#2a2520] to-[#0d1117]', accent: '#f59e0b', glow: 'rgba(245,158,11,0.15)' },
];

export function FlashcardsWindow({ result }: FlashcardsWindowProps) {
  const cards = useMemo(() => normalizeCards(result), [result]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');
  const [scores, setScores] = useState<Record<string, MasteryScore>>({});

  // Swipe gesture
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const missedCount = useMemo(() => Object.values(scores).filter((s) => s === 'missed').length, [scores]);
  const gotCount = useMemo(() => Object.values(scores).filter((s) => s === 'got').length, [scores]);

  const navigateTo = useCallback((newIndex: number, dir: 'left' | 'right') => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSlideDir(dir);
    setFlipped(false);
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
    if (index >= cards.length - 1 || isAnimating) return;
    navigateTo(index + 1, 'left');
  }, [index, cards.length, isAnimating, navigateTo]);

  const handleFlip = useCallback(() => {
    if (isAnimating) return;
    setFlipped((v) => !v);
  }, [isAnimating]);

  const handleScore = useCallback((value: MasteryScore) => {
    const current = cards[Math.min(index, cards.length - 1)];
    if (!current || isAnimating) return;
    setScores((prev) => ({ ...prev, [current.id]: value }));
    if (index < cards.length - 1) {
      navigateTo(index + 1, 'left');
    } else {
      setFlipped(false);
    }
  }, [cards, index, isAnimating, navigateTo]);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrev();
      else if (e.key === 'ArrowRight') goToNext();
      else if (e.key === ' ') { e.preventDefault(); handleFlip(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToPrev, goToNext, handleFlip]);

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
    return <AppWindowPlaceholder status="loading" appName="闪卡训练" />;
  }
  if (cards.length === 0) {
    return <AppWindowPlaceholder status="empty" appName="闪卡训练" />;
  }

  const current = cards[Math.min(index, cards.length - 1)];
  const progress = cards.length > 0 ? ((index + 1) / cards.length) * 100 : 0;
  const allDone = Object.keys(scores).length === cards.length;
  const theme = CARD_THEMES[index % CARD_THEMES.length];
  const currentScore = scores[current.id];

  // Slide animation class
  const slideClass = slideDir === 'left'
    ? 'translate-x-[-8%] opacity-0 scale-95'
    : slideDir === 'right'
      ? 'translate-x-[8%] opacity-0 scale-95'
      : 'translate-x-0 opacity-100 scale-100';

  // Summary screen
  if (allDone) {
    const accuracy = cards.length > 0 ? Math.round((gotCount / cards.length) * 100) : 0;
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center p-6">
        {/* Ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-20"
            style={{ background: `radial-gradient(circle, ${accuracy >= 70 ? '#10b981' : '#f59e0b'} 0%, transparent 70%)` }} />
        </div>

        <div className="relative text-center z-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-6"
            style={{ background: `linear-gradient(135deg, ${accuracy >= 70 ? '#10b98130' : '#f59e0b30'}, transparent)` }}>
            <span className="text-4xl">{accuracy >= 80 ? '🎯' : accuracy >= 50 ? '💪' : '📚'}</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">训练完成</h2>
          <p className="text-white/40 text-sm mb-8">共 {cards.length} 张闪卡</p>

          {/* Score ring */}
          <div className="relative inline-flex items-center justify-center w-32 h-32 mb-8">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={accuracy >= 70 ? '#10b981' : '#f59e0b'}
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${accuracy * 2.64} 264`}
                style={{ transition: 'stroke-dasharray 1s ease-out' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-white">{accuracy}%</span>
              <span className="text-xs text-white/40">正确率</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-10 mb-8">
            <div className="text-center">
              <div className="text-xl font-bold text-[#787774]">{gotCount}</div>
              <div className="text-xs text-white/40 mt-0.5">已掌握</div>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div className="text-center">
              <div className="text-xl font-bold text-rose-400">{missedCount}</div>
              <div className="text-xs text-white/40 mt-0.5">待加强</div>
            </div>
          </div>

          <div className="flex flex-col gap-3 items-center">
            {missedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  const firstMissed = cards.findIndex((c) => scores[c.id] === 'missed');
                  if (firstMissed >= 0) { setIndex(firstMissed); setFlipped(false); setScores({}); }
                }}
                className="rounded-full bg-white/10 border border-white/10 px-8 py-2.5 text-sm font-medium text-white hover:bg-white/15 transition-all"
              >
                复习薄弱项
              </button>
            )}
            <button
              type="button"
              onClick={() => { setIndex(0); setFlipped(false); setScores({}); }}
              className="rounded-full px-8 py-2.5 text-sm text-white/50 hover:text-white/80 transition-colors"
            >
              重新开始
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-[420px] flex-col select-none overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="flashcards-window"
    >
      {/* Ambient background glow */}
      <div className="absolute inset-0 pointer-events-none transition-all duration-700" style={{
        background: `radial-gradient(ellipse 600px 400px at 50% 40%, ${theme.glow}, transparent 70%)`,
      }} />

      {/* Top: keyboard hint (desktop only) */}
      <div className="relative flex-shrink-0 pt-3 pb-1 text-center hidden md:block">
        <p className="text-[11px] text-white/25 tracking-wider">
          SPACE 翻转 &nbsp;&middot;&nbsp; ← → 切换
        </p>
      </div>

      {/* Card area */}
      <div className="relative flex-1 flex items-center justify-center px-4 md:px-12 min-h-0">
        {/* Left arrow */}
        <button
          type="button"
          onClick={goToPrev}
          disabled={index <= 0}
          className="absolute left-3 md:left-6 z-10 group flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-0 disabled:pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}
          aria-label="上一张"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-white/50 group-hover:text-white transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Card container with slide animation */}
        <div className={`w-full max-w-[380px] transition-all duration-250 ease-out ${slideClass}`}>
          {/* 3D flip wrapper */}
          <div
            className="cursor-pointer"
            style={{ perspective: '1200px' }}
            onClick={handleFlip}
          >
            <div
              className="relative transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={{
                transformStyle: 'preserve-3d',
                transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              }}
            >
              {/* Front face */}
              <div
                className={`rounded-[20px] bg-gradient-to-br ${theme.bg} p-7 md:p-8`}
                style={{
                  backfaceVisibility: 'hidden',
                  boxShadow: `0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.05)`,
                }}
              >
                <div className="min-h-[220px] md:min-h-[240px] flex flex-col justify-center items-center text-center">
                  <p className="text-[17px] md:text-xl font-semibold leading-[1.7] text-white/90 tracking-wide">
                    {current.front}
                  </p>
                  {current.hint && (
                    <p className="mt-5 text-[13px] text-white/30 leading-relaxed max-w-[90%]">
                      💡 {current.hint}
                    </p>
                  )}
                </div>
                <div className="mt-3 text-center">
                  <span className="text-[11px] text-white/20 tracking-wide uppercase">点击翻转</span>
                </div>
              </div>

              {/* Back face */}
              <div
                className="absolute inset-0 rounded-[20px] bg-gradient-to-br from-[#0a2520] to-[#0d1117] p-7 md:p-8"
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                  boxShadow: `0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(16,185,129,0.15), inset 0 1px 0 rgba(16,185,129,0.1)`,
                }}
              >
                <div className="min-h-[220px] md:min-h-[240px] flex flex-col justify-center items-center text-center">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-[#232322]/10 px-3 py-1 mb-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#D1F4E0]" />
                    <span className="text-[11px] font-medium text-[#787774] tracking-wide uppercase">答案</span>
                  </div>
                  <p className="text-[17px] md:text-xl font-semibold leading-[1.7] text-white/90 tracking-wide">
                    {current.back}
                  </p>
                </div>
                <div className="mt-3 text-center">
                  <span className="text-[11px] text-white/20 tracking-wide uppercase">点击翻转</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={goToNext}
          disabled={index >= cards.length - 1}
          className="absolute right-3 md:right-6 z-10 group flex h-11 w-11 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-0 disabled:pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}
          aria-label="下一张"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-white/50 group-hover:text-white transition-colors" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      <div className="relative flex-shrink-0 px-4 pb-5 pt-2">
        {/* Score buttons */}
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums" style={{ color: '#f87171', minWidth: '20px', textAlign: 'right' }}>{missedCount}</span>
            <button
              type="button"
              onClick={() => handleScore('missed')}
              className={`group relative rounded-full px-6 py-2.5 text-sm font-medium transition-all duration-200 active:scale-95 ${
                currentScore === 'missed'
                  ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/30'
                  : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-rose-300'
              }`}
            >
              没掌握
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleScore('got')}
              className={`group relative rounded-full px-6 py-2.5 text-sm font-medium transition-all duration-200 active:scale-95 ${
                currentScore === 'got'
                  ? 'bg-[#232322]/20 text-[#D1F4E0] ring-1 ring-[#D1F4E0]/30'
                  : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-[#D1F4E0]'
              }`}
            >
              掌握了
            </button>
            <span className="text-sm font-semibold tabular-nums" style={{ color: '#34d399', minWidth: '20px' }}>{gotCount}</span>
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3 max-w-[400px] mx-auto">
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
            {index + 1} / {cards.length}
          </span>
        </div>
      </div>
    </div>
  );
}
