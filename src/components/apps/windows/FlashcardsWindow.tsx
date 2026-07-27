'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { COPY } from '@/lib/ui/copy';
import { isGuestDemoFlashcardsResult } from '@/components/classroom/guest-demo-entry';
import { buildFlashcardsTrialShareText } from './flashcards-share-actions';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { formatFlashcardActivity, formatFlashcardCompleteActivity } from '@/components/review-learning-activity';
import {
  formatFlashcardEvidenceTime,
  getFlashcardsFallbackMessage,
  normalizeFlashcards,
} from './flashcards-window-model';

interface FlashcardsWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string) => void;
}

type MasteryScore = 'missed' | 'got';

export function FlashcardsWindow({ result, onSeek, onLearningActivity }: FlashcardsWindowProps) {
  const cards = useMemo(() => normalizeFlashcards(result), [result]);
  const fallbackMessage = useMemo(() => getFlashcardsFallbackMessage(result), [result]);
  const [reviewCardIds, setReviewCardIds] = useState<string[] | null>(null);
  const activeCards = useMemo(
    () => reviewCardIds ? cards.filter((card) => reviewCardIds.includes(card.id)) : cards,
    [cards, reviewCardIds],
  );
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');
  const [scores, setScores] = useState<Record<string, MasteryScore>>({});
  const [sharingTrial, setSharingTrial] = useState(false);
  const isGuestDemoResult = useMemo(() => isGuestDemoFlashcardsResult(result), [result]);

  // Swipe gesture
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const missedCount = useMemo(() => Object.values(scores).filter((s) => s === 'missed').length, [scores]);
  const gotCount = useMemo(() => Object.values(scores).filter((s) => s === 'got').length, [scores]);
  const trialShareText = useMemo(
    () => buildFlashcardsTrialShareText(cards, { gotCount, total: cards.length }),
    [cards, gotCount],
  );

  const handleShareTrialResult = useCallback(async () => {
    if (!isGuestDemoResult || sharingTrial) return;
    setSharingTrial(true);
    try {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (nav.share) {
        await nav.share({ title: COPY.flashcardsShare.title, text: trialShareText });
        return;
      }
      await navigator.clipboard.writeText(trialShareText);
      toast.success(COPY.flashcardsShare.copied);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(trialShareText);
        toast.success(COPY.flashcardsShare.copied);
      } catch {
        toast.error(COPY.flashcardsShare.failed);
      }
    } finally {
      setSharingTrial(false);
    }
  }, [isGuestDemoResult, sharingTrial, trialShareText]);

  const navigateTo = useCallback((newIndex: number, dir: 'left' | 'right') => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSlideDir(dir);
    setFlipped(false);
    setShowHint(false);
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
    if (index >= activeCards.length - 1 || isAnimating) return;
    navigateTo(index + 1, 'left');
  }, [activeCards.length, index, isAnimating, navigateTo]);

  const handleFlip = useCallback(() => {
    if (isAnimating) return;
    setFlipped((v) => !v);
  }, [isAnimating]);

  const handleScore = useCallback((value: MasteryScore) => {
    const current = activeCards[Math.min(index, activeCards.length - 1)];
    if (!current || isAnimating) return;
    const nextScores = { ...scores, [current.id]: value };
    setScores(nextScores);
    onLearningActivity?.(formatFlashcardActivity({
      index: index + 1,
      total: activeCards.length,
      front: current.front,
      rating: value,
    }));
    if (Object.keys(nextScores).length === activeCards.length) {
      const got = Object.values(nextScores).filter((score) => score === 'got').length;
      onLearningActivity?.(formatFlashcardCompleteActivity({ got, total: activeCards.length }));
    }
    if (index < activeCards.length - 1) {
      navigateTo(index + 1, 'left');
    } else {
      setFlipped(false);
    }
  }, [activeCards, index, isAnimating, navigateTo, onLearningActivity, scores]);

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
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
    return <AppWindowPlaceholder status="loading" appName={COPY.apps.flashcards.appName} />;
  }
  if (fallbackMessage) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-paper px-6">
        <p className="max-w-[24rem] text-center text-[15px] leading-7 text-ink-secondary">
          {fallbackMessage}
        </p>
      </div>
    );
  }
  if (cards.length === 0) {
    return <AppWindowPlaceholder status="empty" appName={COPY.apps.flashcards.appName} />;
  }

  const current = activeCards[Math.min(index, activeCards.length - 1)];
  const progress = activeCards.length > 0 ? ((index + 1) / activeCards.length) * 100 : 0;
  const allDone = activeCards.length > 0 && Object.keys(scores).length === activeCards.length;
  const currentScore = scores[current.id];

  // Slide animation class
  const slideClass = slideDir === 'left'
    ? 'translate-x-[-8%] opacity-0 scale-95'
    : slideDir === 'right'
      ? 'translate-x-[8%] opacity-0 scale-95'
      : 'translate-x-0 opacity-100 scale-100';

  // Summary screen
  if (allDone) {
    const recallRate = activeCards.length > 0 ? Math.round((gotCount / activeCards.length) * 100) : 0;
    return (
      <div className="flex h-full min-h-[420px] flex-col items-center justify-center overflow-hidden bg-paper p-6">
        <div className="text-center">
          <div className="mx-auto mb-6 h-1 w-12 rounded-full bg-pine" aria-hidden />
          <h2 className="mb-1 text-2xl font-bold text-ink">{COPY.apps.flashcards.completeTitle}</h2>
          <p className="mb-8 text-sm text-ink-muted">{COPY.apps.flashcards.roundSummary(activeCards.length)}</p>

          {/* Score ring */}
          <div className="relative inline-flex items-center justify-center w-32 h-32 mb-8">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#DCE5DF" strokeWidth="6" />
              <circle cx="50" cy="50" r="42" fill="none" stroke="#2F6B55"
                strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${recallRate * 2.64} 264`}
                style={{ transition: 'stroke-dasharray 1s ease-out' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-ink">{recallRate}%</span>
              <span className="text-xs text-ink-muted">{COPY.apps.flashcards.recallRate}</span>
            </div>
          </div>

          <div className="flex items-center justify-center gap-10 mb-8">
            <div className="text-center">
              <div className="text-xl font-bold text-pine">{gotCount}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{COPY.apps.flashcards.gotCount}</div>
            </div>
            <div className="h-8 w-px bg-divider" />
            <div className="text-center">
              <div className="text-xl font-bold text-vermilion">{missedCount}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{COPY.apps.flashcards.missedCount}</div>
            </div>
          </div>

          {isGuestDemoResult && reviewCardIds === null && (
            <div className="mb-5 w-full max-w-[320px] rounded-[20px] border border-divider bg-white p-4 text-left shadow-soft">
              <p className="text-sm font-semibold text-ink">{COPY.flashcardsShare.summaryTitle}</p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">{COPY.flashcardsShare.summaryBody(activeCards.length)}</p>
              <button
                type="button"
                onClick={handleShareTrialResult}
                disabled={sharingTrial}
                className="mt-3 w-full rounded-full bg-pine px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-pine/90 active:scale-[0.99] disabled:opacity-60"
              >
                {sharingTrial ? COPY.flashcardsShare.sharing : COPY.flashcardsShare.open}
              </button>
            </div>
          )}

          <div className="flex flex-col gap-3 items-center">
            {missedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  const missedIds = activeCards.filter((card) => scores[card.id] === 'missed').map((card) => card.id);
                  setReviewCardIds(missedIds);
                  setIndex(0);
                  setFlipped(false);
                  setShowHint(false);
                  setScores({});
                }}
                className="rounded-full border border-pine/25 bg-pine-mist px-8 py-2.5 text-sm font-medium text-pine transition-all hover:bg-pine/15"
              >
                {COPY.apps.flashcards.reviewMissed(missedCount)}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setReviewCardIds(null); setIndex(0); setFlipped(false); setShowHint(false); setScores({}); }}
              className="rounded-full px-8 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              {COPY.apps.flashcards.restart}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full min-h-[420px] flex-col select-none overflow-hidden bg-paper"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="flashcards-window"
    >
      {isGuestDemoResult && reviewCardIds === null && (
        <button
          type="button"
          onClick={handleShareTrialResult}
          disabled={sharingTrial}
          className="absolute right-4 top-3 z-20 rounded-full border border-pine/15 bg-white px-3 py-1.5 text-[12px] font-medium text-pine shadow-soft transition hover:bg-pine-mist active:scale-[0.99] disabled:opacity-60"
        >
          {sharingTrial ? COPY.flashcardsShare.sharing : COPY.flashcardsShare.open}
        </button>
      )}

      {/* Top: keyboard hint (desktop only) */}
      <div className="relative flex-shrink-0 pt-3 pb-1 text-center hidden md:block">
        <p className="text-[11px] tracking-wider text-ink-muted">
          {COPY.apps.flashcards.keyboardHint}
        </p>
      </div>

      {/* Card area */}
      <div className="relative flex-1 flex items-center justify-center px-4 md:px-12 min-h-0">
        {/* Left arrow */}
        <button
          type="button"
          onClick={goToPrev}
          disabled={index <= 0}
          className="group absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-divider bg-white/90 shadow-soft transition-all duration-200 disabled:pointer-events-none disabled:opacity-0 md:left-6"
          aria-label={COPY.apps.flashcards.previous}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-muted transition-colors group-hover:text-ink" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                className="rounded-[20px] border border-divider bg-white p-7 shadow-card md:p-8"
                aria-hidden={flipped}
                style={{
                  backfaceVisibility: 'hidden',
                }}
              >
                <div className="min-h-[220px] md:min-h-[240px] flex flex-col justify-center items-center text-center">
                  <p className="text-[17px] font-semibold leading-[1.7] tracking-wide text-ink md:text-xl">
                    {current.front}
                  </p>
                  {current.hint ? (
                    showHint ? (
                      <p className="mt-5 max-w-[90%] border-l border-vermilion/60 pl-3 text-left text-[13px] leading-relaxed text-ink-muted">
                        {current.hint}
                      </p>
                    ) : (
                      <button
                        type="button"
                        tabIndex={flipped ? -1 : 0}
                        className="mt-5 rounded-full border border-divider bg-paper px-3 py-1.5 text-[12px] text-ink-muted transition hover:border-pine/25 hover:text-pine"
                        onClick={(event) => {
                          event.stopPropagation();
                          setShowHint(true);
                        }}
                      >
                        {COPY.apps.flashcards.showHint}
                      </button>
                    )
                  ) : null}
                </div>
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    tabIndex={flipped ? -1 : 0}
                    className="rounded-full px-3 py-1.5 text-[11px] tracking-wide text-ink-muted transition hover:bg-paper-warm hover:text-pine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pine/30"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleFlip();
                    }}
                  >
                    {COPY.apps.flashcards.reveal}
                  </button>
                </div>
              </div>

              {/* Back face */}
              <div
                className="absolute inset-0 rounded-[20px] border border-pine/25 bg-pine-fog p-7 shadow-card md:p-8"
                aria-hidden={!flipped}
                style={{
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                }}
              >
                <div className="min-h-[220px] md:min-h-[240px] flex flex-col justify-center items-center text-center">
                  <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/75 px-3 py-1 ring-1 ring-pine/10">
                    <div className="h-1.5 w-1.5 rounded-full bg-pine" />
                    <span className="text-[11px] font-medium tracking-wide text-pine">{COPY.apps.flashcards.answer}</span>
                  </div>
                  <p className="text-[17px] font-semibold leading-[1.7] tracking-wide text-ink md:text-xl">
                    {current.back}
                  </p>
                </div>
                <div className="mt-3 text-center">
                  {current.evidence ? (
                    <button
                      type="button"
                      tabIndex={flipped ? 0 : -1}
                      className="text-[11px] tracking-wide text-pine/70 transition hover:text-pine"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSeek?.(current.evidence!.startMs);
                      }}
                      disabled={!onSeek}
                    >
                      {onSeek
                        ? COPY.apps.flashcards.returnToEvidenceAt(formatFlashcardEvidenceTime(current.evidence.startMs))
                        : COPY.apps.flashcards.evidenceAt(formatFlashcardEvidenceTime(current.evidence.startMs))}
                    </button>
                  ) : (
                    <span className="text-[11px] tracking-wide text-ink-muted">{COPY.apps.flashcards.reveal}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={goToNext}
          disabled={index >= activeCards.length - 1}
          className="group absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-divider bg-white/90 shadow-soft transition-all duration-200 disabled:pointer-events-none disabled:opacity-0 md:right-6"
          aria-label={COPY.apps.flashcards.next}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-ink-muted transition-colors group-hover:text-ink" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Bottom controls */}
      <div className="relative flex-shrink-0 px-4 pb-5 pt-2">
        {flipped ? (
          <div className="mb-4 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => handleScore('missed')}
              className={`min-h-11 rounded-full border px-6 text-sm font-medium transition active:scale-95 ${
                currentScore === 'missed'
                  ? 'border-vermilion/45 bg-vermilion-mist text-vermilion'
                  : 'border-divider bg-white text-ink-secondary hover:border-vermilion/35 hover:text-vermilion'
              }`}
            >
              {COPY.apps.flashcards.missed}
            </button>
            <button
              type="button"
              onClick={() => handleScore('got')}
              className={`min-h-11 rounded-full border px-6 text-sm font-medium transition active:scale-95 ${
                currentScore === 'got'
                  ? 'border-pine bg-pine text-white'
                  : 'border-divider bg-white text-ink-secondary hover:border-pine/45 hover:text-pine'
              }`}
            >
              {COPY.apps.flashcards.got}
            </button>
          </div>
        ) : (
          <p className="mb-4 text-center text-[12px] text-ink-muted">{COPY.apps.flashcards.recallFirst}</p>
        )}

        {/* Progress */}
        <div className="flex items-center gap-3 max-w-[400px] mx-auto">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-divider/70">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progress}%`,
                background: '#2F6B55',
              }}
            />
          </div>
          <span className="whitespace-nowrap text-[11px] tabular-nums tracking-wider text-ink-muted">
              {index + 1} / {activeCards.length}
          </span>
        </div>
      </div>
    </div>
  );
}
