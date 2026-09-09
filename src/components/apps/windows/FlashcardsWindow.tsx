'use client';

/**
 * 闪卡训练窗口 —— 牌是牌。
 *
 * 2026-09-09 重做：
 * - 一张纸质牌 + 身后的牌堆（FlashcardDeck），真实 3D 翻面；正反面都是纸，不是彩色卡
 * - 翻面前：空格 / 点牌翻面，←→ 或左右滑换牌；翻面后：两个手势级别的动作「再来一次 / 记住了」
 *   （键盘 1 / 2；触屏在翻开的牌上左滑 = 再来一次、右滑 = 记住了）
 * - 右上角一个进度环（记住 / 没记住两色），不再有顶部键盘提示 + 底部进度条 + 圆形箭头
 * - 打完分给「没记住的再来一遍」
 * 判分、记忆观测、访客分享逻辑沿用 flashcards-window-model / assessment-events。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { COPY } from '@/lib/ui/copy';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { isGuestDemoFlashcardsResult } from '@/components/classroom/guest-demo-entry';
import { buildFlashcardsTrialShareText } from './flashcards-share-actions';
import { AppWindowPlaceholder } from '@/components/apps/windows/AppWindowPlaceholder';
import { formatFlashcardActivity, formatFlashcardCompleteActivity } from '@/components/review-learning-activity';
import { getFlashcardsFallbackMessage, normalizeFlashcards } from './flashcards-window-model';
import { buildFlashcardsAssessment, type AssessmentDraft } from './assessment-events';
import { NextStepCard, type NextStepCardProps } from './NextStepCard';
import { FlashcardDeck } from './FlashcardDeck';
import { FlashcardsSummary } from './FlashcardsSummary';

interface FlashcardsWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
  onLearningActivity?: (line: string) => void;
  /** 全部打完分时把每张卡的 got / missed + 证据交给记忆（结构化） */
  onAssessment?: (draft: AssessmentDraft) => void;
  /** 完成态里同桌接着说的下一步 */
  nextStep?: NextStepCardProps;
}

type MasteryScore = 'missed' | 'got';

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

/** 右上角小进度环：松绿 = 记住、朱红 = 没记住，剩余留白 */
function ProgressRing({ got, missed, total }: { got: number; missed: number; total: number }) {
  const gotLen = total > 0 ? (got / total) * RING_C : 0;
  const missedLen = total > 0 ? (missed / total) * RING_C : 0;
  return (
    <div className="flex items-center gap-2 text-[12px] tabular-nums text-ink-muted" aria-label={`${got + missed} / ${total}`}>
      <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--mm-divider, #DCE5DF)" strokeWidth="3" />
        <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--mm-vermilion)" strokeWidth="3" strokeDasharray={`${missedLen} ${RING_C}`} strokeDashoffset={-gotLen} style={{ transition: 'stroke-dasharray 400ms ease-out, stroke-dashoffset 400ms ease-out' }} />
        <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--mm-pine)" strokeWidth="3" strokeDasharray={`${gotLen} ${RING_C}`} style={{ transition: 'stroke-dasharray 400ms ease-out' }} />
      </svg>
      <span>{got + missed} / {total}</span>
    </div>
  );
}

export function FlashcardsWindow({ result, transcript, onSeek, onLearningActivity, onAssessment, nextStep }: FlashcardsWindowProps) {
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
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

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
    timer.current = setTimeout(() => {
      setIndex(newIndex);
      setSlideDir('none');
      setIsAnimating(false);
    }, 240);
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
    onLearningActivity?.(formatFlashcardActivity({ index: index + 1, total: activeCards.length, front: current.front, rating: value }));
    if (Object.keys(nextScores).length === activeCards.length) {
      const got = Object.values(nextScores).filter((score) => score === 'got').length;
      onLearningActivity?.(formatFlashcardCompleteActivity({ got, total: activeCards.length }));
      const assessment = buildFlashcardsAssessment(activeCards, nextScores);
      if (assessment) onAssessment?.(assessment);
    }
    if (index < activeCards.length - 1) {
      navigateTo(index + 1, 'left');
    } else {
      setFlipped(false);
    }
  }, [activeCards, index, isAnimating, navigateTo, onAssessment, onLearningActivity, scores]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.key === 'ArrowLeft') goToPrev();
      else if (e.key === 'ArrowRight') goToNext();
      else if (e.key === ' ') { e.preventDefault(); handleFlip(); }
      else if (flipped && e.key === '1') handleScore('missed');
      else if (flipped && e.key === '2') handleScore('got');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flipped, goToPrev, goToNext, handleFlip, handleScore]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStart.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) <= 50) return;
    // 翻开的牌：左滑 = 再来一次，右滑 = 记住了；没翻开：左右滑换牌
    if (flipped) handleScore(deltaX < 0 ? 'missed' : 'got');
    else if (deltaX < 0) goToNext();
    else goToPrev();
  }, [flipped, goToNext, goToPrev, handleScore]);

  if (!result) {
    return <AppWindowPlaceholder status="loading" appName={APPS_COPY.flashcards.appName} transcript={transcript} />;
  }
  if (fallbackMessage) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-paper px-6">
        <p className="max-w-[24rem] text-center text-[15px] leading-7 text-ink-secondary">{fallbackMessage}</p>
      </div>
    );
  }
  if (cards.length === 0) {
    return <AppWindowPlaceholder status="empty" appName={APPS_COPY.flashcards.appName} />;
  }

  const current = activeCards[Math.min(index, activeCards.length - 1)];
  const allDone = activeCards.length > 0 && Object.keys(scores).length === activeCards.length;
  const currentScore = scores[current.id];
  const resetRound = (ids: string[] | null) => {
    setReviewCardIds(ids);
    setIndex(0);
    setFlipped(false);
    setShowHint(false);
    setScores({});
  };

  const slideClass = slideDir === 'left'
    ? '-translate-x-[6%] -rotate-1 opacity-0'
    : slideDir === 'right'
      ? 'translate-x-[6%] rotate-1 opacity-0'
      : 'translate-x-0 rotate-0 opacity-100';

  if (allDone) {
    return (
      <FlashcardsSummary
        cards={activeCards}
        scores={scores}
        onReviewMissed={() => resetRound(activeCards.filter((card) => scores[card.id] === 'missed').map((card) => card.id))}
        onRestart={() => resetRound(null)}
        trialShare={isGuestDemoResult && reviewCardIds === null ? { sharing: sharingTrial, onShare: handleShareTrialResult } : undefined}
        nextStep={nextStep ? <NextStepCard {...nextStep} /> : null}
      />
    );
  }

  const showHintLine = index === 0 && !reviewCardIds && Object.keys(scores).length === 0;

  return (
    <div
      className="relative flex h-full min-h-[420px] select-none flex-col overflow-hidden bg-paper"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      data-testid="flashcards-window"
    >
      {/* 顶栏：上一张 / 下一张退成文字，右侧进度环 */}
      <div className="flex flex-shrink-0 items-center justify-between px-5 pt-4 md:px-8">
        <div className="flex items-center gap-4 text-[13px] text-ink-muted">
          <button type="button" onClick={goToPrev} disabled={index <= 0} className="transition hover:text-ink disabled:invisible">← {APPS_COPY.flashcards.previous}</button>
          <button type="button" onClick={goToNext} disabled={index >= activeCards.length - 1} className="transition hover:text-ink disabled:invisible">{APPS_COPY.flashcards.next} →</button>
        </div>
        <div className="flex items-center gap-4">
          {isGuestDemoResult && reviewCardIds === null ? (
            <button type="button" onClick={handleShareTrialResult} disabled={sharingTrial} className="text-[12px] font-medium text-pine transition hover:text-pine-deep disabled:opacity-60">
              {sharingTrial ? COPY.flashcardsShare.sharing : COPY.flashcardsShare.open}
            </button>
          ) : null}
          <ProgressRing got={gotCount} missed={missedCount} total={activeCards.length} />
        </div>
      </div>

      {/* 牌 */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-2 pt-3 md:px-10">
        <div className={`flex w-full justify-center transition-all duration-[240ms] ease-out ${slideClass}`}>
          <FlashcardDeck
            card={current}
            index={index}
            total={activeCards.length}
            flipped={flipped}
            showHint={showHint}
            remaining={activeCards.length - 1 - index}
            onFlip={handleFlip}
            onShowHint={() => setShowHint(true)}
            onSeek={onSeek}
          />
        </div>
      </div>

      {/* 底部：翻面前一句提示；翻面后两个大动作 */}
      <div className="flex-shrink-0 px-5 pb-5 pt-2 md:px-10">
        <div className="mx-auto flex h-12 w-full max-w-[420px] items-center justify-center gap-3">
          {flipped ? (
            <>
              <button
                type="button"
                onClick={() => handleScore('missed')}
                className={`h-12 flex-1 rounded-full border text-[14.5px] font-medium transition active:scale-[0.98] ${
                  currentScore === 'missed' ? 'border-vermilion bg-vermilion-fog text-vermilion' : 'border-vermilion/35 bg-white text-vermilion hover:border-vermilion hover:bg-vermilion-fog'
                }`}
              >
                {APPS_COPY.flashcards.missed}
              </button>
              <button
                type="button"
                onClick={() => handleScore('got')}
                className={`h-12 flex-1 rounded-full text-[14.5px] font-medium text-white transition active:scale-[0.98] ${currentScore === 'got' ? 'bg-pine-deep' : 'bg-pine hover:bg-pine-deep'}`}
              >
                {APPS_COPY.flashcards.got}
              </button>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-muted">{APPS_COPY.flashcards.recallFirst}</p>
          )}
        </div>
        {showHintLine ? (
          <p className="mx-auto mt-2 hidden w-full max-w-[420px] text-center text-[11.5px] text-ink-muted/70 md:block">
            {flipped ? APPS_COPY.flashcards.keyboardHintFlipped : APPS_COPY.flashcards.keyboardHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
