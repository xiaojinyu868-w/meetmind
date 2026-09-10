'use client';

/**
 * 闪卡训练窗口 —— 牌是牌。
 *
 * 2026-09-09 重做：
 * - 一张纸质牌 + 身后的牌堆（FlashcardDeck），真实 3D 翻面；正反面都是纸，不是彩色卡
 * - 翻面前：空格 / 点牌翻面，←→ 或左右滑换牌；翻面后：两个手势级别的动作「再来一次 / 记住了」
 * - 右上角一个进度环（记住 / 没记住两色）
 * - 打完分给「没记住的再来一遍」
 *
 * 2026-09-10 交互打磨：
 * - 打分的牌朝分数方向飞出（记住 = 右 / pine，没记住 = 左 / vermilion），飞出时不再先翻回正面；
 *   下一张从牌堆位置升上来（mm-card-rise），牌堆原地不动——此前是整叠一起淡出、下一张瞬现
 * - 拖动跟手 + 回弹：位移 / 速度阈值与竖向取消在 swipe-model，手指按着时牌染色预告将要发生什么
 * - 键盘：空格翻、翻开后 1 / 2 或 ←→ 打分、没翻开 ←→ 换牌、Z 撤销上一张（app-keys.resolveFlashcardKey）
 * - 快捷键提示只在第一次进入出现一次（keyboard-hints）
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
import { FlashcardDeck, type DeckLeaving } from './FlashcardDeck';
import { FlashcardsSummary } from './FlashcardsSummary';
import { applyScore, flyDirectionOf, undoScore, type MasteryScore, type RoundState } from './flashcard-deck-model';
import { isTypingTarget, resolveFlashcardKey } from './app-keys';
import { useKeyboardHintOnce } from './keyboard-hints';
import { resolveFlashcardSwipe } from './swipe-model';
import { useSwipe } from './use-swipe';
import { MOTION, prefersReducedMotion } from './app-motion';

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

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;
const LEAVE_MS = 240;
const EMPTY_ROUND: RoundState = { scores: {}, history: [] };

/** 右上角小进度环：松绿 = 记住、朱红 = 没记住，剩余留白 */
function ProgressRing({ got, missed, total }: { got: number; missed: number; total: number }) {
  const gotLen = total > 0 ? (got / total) * RING_C : 0;
  const missedLen = total > 0 ? (missed / total) * RING_C : 0;
  return (
    <div className="flex items-center gap-2 text-[12px] tabular-nums text-ink-muted" aria-label={`${got + missed} / ${total}`}>
      <svg width="36" height="36" viewBox="0 0 36 36" className="-rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--mm-divider, #DCE5DF)" strokeWidth="3" />
        <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--mm-vermilion)" strokeWidth="3" strokeDasharray={`${missedLen} ${RING_C}`} strokeDashoffset={-gotLen} className="transition-[stroke-dasharray,stroke-dashoffset] duration-[400ms] ease-out motion-reduce:transition-none" />
        <circle cx="18" cy="18" r={RING_R} fill="none" stroke="var(--mm-pine)" strokeWidth="3" strokeDasharray={`${gotLen} ${RING_C}`} className="transition-[stroke-dasharray] duration-[400ms] ease-out motion-reduce:transition-none" />
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
  const [leaving, setLeaving] = useState<DeckLeaving | null>(null);
  const [round, setRound] = useState<RoundState>(EMPTY_ROUND);
  const [sharingTrial, setSharingTrial] = useState(false);
  const isGuestDemoResult = useMemo(() => isGuestDemoFlashcardsResult(result), [result]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const showKeyboardHint = useKeyboardHintOnce('flashcards');

  const scores = round.scores;
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

  /** 顶牌飞出 → 换到 newIndex（新牌从牌堆升起）；reduced-motion 直接换 */
  const leaveTo = useCallback((newIndex: number, direction: 'left' | 'right', tint?: MasteryScore) => {
    if (leaving) return;
    const commit = () => {
      setIndex(newIndex);
      setFlipped(false);
      setShowHint(false);
      setLeaving(null);
    };
    if (prefersReducedMotion()) { commit(); return; }
    setLeaving({ direction, tint });
    timer.current = setTimeout(commit, LEAVE_MS);
  }, [leaving]);

  const goToPrev = useCallback(() => {
    if (index <= 0) return;
    leaveTo(index - 1, 'right');
  }, [index, leaveTo]);

  const goToNext = useCallback(() => {
    if (index >= activeCards.length - 1) return;
    leaveTo(index + 1, 'left');
  }, [activeCards.length, index, leaveTo]);

  const handleFlip = useCallback(() => {
    if (leaving) return;
    setFlipped((v) => !v);
  }, [leaving]);

  const handleScore = useCallback((value: MasteryScore) => {
    const current = activeCards[Math.min(index, activeCards.length - 1)];
    if (!current || leaving) return;
    const nextRound = applyScore(round, current.id, index, value);
    setRound(nextRound);
    onLearningActivity?.(formatFlashcardActivity({ index: index + 1, total: activeCards.length, front: current.front, rating: value }));
    if (Object.keys(nextRound.scores).length === activeCards.length) {
      const got = Object.values(nextRound.scores).filter((score) => score === 'got').length;
      onLearningActivity?.(formatFlashcardCompleteActivity({ got, total: activeCards.length }));
      const assessment = buildFlashcardsAssessment(activeCards, nextRound.scores);
      if (assessment) onAssessment?.(assessment);
    }
    // 最后一张：飞出后停在原位等结束页接管（allDone 由 scores 决定）
    leaveTo(index < activeCards.length - 1 ? index + 1 : index, flyDirectionOf(value), value);
  }, [activeCards, index, leaveTo, leaving, onAssessment, onLearningActivity, round]);

  const handleUndo = useCallback(() => {
    if (leaving) return;
    const undone = undoScore(round);
    if (!undone) return;
    setRound(undone.state);
    setIndex(undone.index);
    setFlipped(false);
    setShowHint(false);
  }, [leaving, round]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = resolveFlashcardKey(e.key, { flipped, typing: isTypingTarget(e.target as HTMLElement | null) });
      if (!action) return;
      e.preventDefault();
      if (action === 'flip') handleFlip();
      else if (action === 'prev') goToPrev();
      else if (action === 'next') goToNext();
      else if (action === 'got') handleScore('got');
      else if (action === 'missed') handleScore('missed');
      else if (action === 'undo') handleUndo();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [flipped, goToPrev, goToNext, handleFlip, handleScore, handleUndo]);

  // 拖动跟手；松手按阈值判定：翻开的牌右滑记住 / 左滑没记住，没翻开左右换牌
  const swipe = useSwipe({
    disabled: Boolean(leaving),
    onRelease: useCallback((sample) => {
      const action = resolveFlashcardSwipe(sample, flipped);
      if (action.kind === 'score') handleScore(action.value);
      else if (action.kind === 'nav') { if (action.dir === 'next') goToNext(); else goToPrev(); }
    }, [flipped, goToNext, goToPrev, handleScore]),
  });

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
  const allDone = activeCards.length > 0 && Object.keys(scores).length === activeCards.length && !leaving;
  const currentScore = scores[current.id];
  const resetRound = (ids: string[] | null) => {
    setReviewCardIds(ids);
    setIndex(0);
    setFlipped(false);
    setShowHint(false);
    setLeaving(null);
    setRound(EMPTY_ROUND);
  };

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

  const hintVisible = showKeyboardHint && index === 0 && !reviewCardIds && Object.keys(scores).length === 0;
  const canUndo = round.history.length > 0;

  return (
    <div
      key={reviewCardIds ? reviewCardIds.join(',') : 'all'}
      className="mm-app-enter relative flex h-full min-h-[420px] select-none flex-col overflow-hidden bg-paper"
      data-testid="flashcards-window"
    >
      {/* 顶栏：上一张 / 下一张 / 撤销退成文字，右侧进度环 */}
      <div className="flex flex-shrink-0 items-center justify-between px-5 pt-4 md:px-8">
        <div className="flex items-center gap-4 text-[13px] text-ink-muted">
          <button type="button" onClick={goToPrev} disabled={index <= 0 || Boolean(leaving)} className="mm-focus rounded transition hover:text-ink disabled:invisible">← {APPS_COPY.flashcards.previous}</button>
          <button type="button" onClick={goToNext} disabled={index >= activeCards.length - 1 || Boolean(leaving)} className="mm-focus rounded transition hover:text-ink disabled:invisible">{APPS_COPY.flashcards.next} →</button>
          {canUndo ? (
            <button type="button" onClick={handleUndo} disabled={Boolean(leaving)} className="mm-focus mm-app-enter rounded text-[12px] transition hover:text-ink" title={APPS_COPY.flashcards.undoHint}>
              {APPS_COPY.flashcards.undo}
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          {isGuestDemoResult && reviewCardIds === null ? (
            <button type="button" onClick={handleShareTrialResult} disabled={sharingTrial} className="mm-focus rounded text-[12px] font-medium text-pine transition hover:text-pine-deep disabled:opacity-60">
              {sharingTrial ? COPY.flashcardsShare.sharing : COPY.flashcardsShare.open}
            </button>
          ) : null}
          <ProgressRing got={gotCount} missed={missedCount} total={activeCards.length} />
        </div>
      </div>

      {/* 牌：拖动区域是整块牌面所在区，竖向滚动仍交给页面 */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-5 pb-2 pt-3 md:px-10"
        style={{ touchAction: 'pan-y' }}
        {...swipe.handlers}
        onClickCapture={(event) => { if (swipe.movedRef.current) { event.stopPropagation(); event.preventDefault(); } }}
      >
        <FlashcardDeck
          card={current}
          index={index}
          total={activeCards.length}
          flipped={flipped}
          showHint={showHint}
          remaining={activeCards.length - 1 - index}
          dragX={swipe.dx}
          dragging={swipe.dragging}
          leaving={leaving}
          onFlip={handleFlip}
          onShowHint={() => setShowHint(true)}
          onSeek={onSeek}
        />
      </div>

      {/* 底部：翻面前一句提示；翻面后两个大动作（≥48px，手机也够按） */}
      <div className="flex-shrink-0 px-5 pb-5 pt-2 md:px-10">
        <div className="mx-auto flex h-12 w-full max-w-[420px] items-center justify-center gap-3">
          {flipped ? (
            <>
              <button
                type="button"
                onClick={() => handleScore('missed')}
                disabled={Boolean(leaving)}
                className={`mm-press mm-focus mm-app-enter h-12 flex-1 rounded-full border text-[14.5px] font-medium ${
                  currentScore === 'missed' ? 'border-vermilion bg-vermilion-fog text-vermilion' : 'border-vermilion/35 bg-white text-vermilion hover:border-vermilion hover:bg-vermilion-fog'
                }`}
              >
                {APPS_COPY.flashcards.missed}
              </button>
              <button
                type="button"
                onClick={() => handleScore('got')}
                disabled={Boolean(leaving)}
                className={`mm-press mm-focus mm-app-enter h-12 flex-1 rounded-full text-[14.5px] font-medium text-white ${currentScore === 'got' ? 'bg-pine-deep' : 'bg-pine hover:bg-pine-deep'}`}
                style={{ animationDelay: `${MOTION.enterMs / 4}ms` }}
              >
                {APPS_COPY.flashcards.got}
              </button>
            </>
          ) : (
            <p className="text-[12.5px] text-ink-muted">{APPS_COPY.flashcards.recallFirst}</p>
          )}
        </div>
        {hintVisible ? (
          <p className="mx-auto mt-2 w-full max-w-[420px] text-center text-[11.5px] text-ink-muted/70">
            {flipped ? APPS_COPY.flashcards.keyboardHintFlipped : APPS_COPY.flashcards.keyboardHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
