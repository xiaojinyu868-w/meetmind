'use client';

/**
 * 闪卡的「牌」：一张纸质卡片 + 身后露出的牌堆。
 *
 * - 正反两面都是纸（白、暖阴影、hairline），背面只多一道松绿顶边——像索引卡的色条，不是彩色底
 * - 翻面是真实的 3D 翻转（rotateY，520ms 弹性曲线）：翻到一半时牌轻轻抬起（scale 1.035）、下方的
 *   投影随之散开又收回——纸离开桌面再落回去的层次；正反面 backface 隐藏
 * - 正反面用同一格 grid 叠放：牌高 = 两面里较高的那面，长解释不再溢出牌面；长文自动缩字（faceFontSize）
 * - 身后两张牌按剩余数量露出（错位 + 缩放）；顶牌换张时新牌从牌堆位置升上来（mm-card-rise）
 * - 拖动跟手（dragX → 位移 + 轻旋转），翻开的牌拖动时染色：右 = pine（记住）/ 左 = vermilion（没记住）；
 *   松手成立飞出（leaving），不成立回弹（transition）
 * 纯展示：翻面 / 提示 / 回原话 / 手势判定都由父组件控制。
 */

import { useEffect, useRef, type CSSProperties } from 'react';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { formatFlashcardEvidenceTime, type FlashcardItem } from './flashcards-window-model';
import { dragTransform, flyOutTransform, swipeProgress } from './swipe-model';
import { faceFontSize } from './flashcard-deck-model';
import { prefersReducedMotion } from './app-motion';
import { MathText } from './MathText';

export interface DeckLeaving {
  direction: 'left' | 'right';
  /** 打分飞出时染色；换牌飞出不染 */
  tint?: 'got' | 'missed';
}

interface FlashcardDeckProps {
  card: FlashcardItem;
  index: number;
  total: number;
  flipped: boolean;
  showHint: boolean;
  /** 当前牌之后还有几张（决定牌堆露出几层） */
  remaining: number;
  /** 手指 / 鼠标正在拖：横向位移（px） */
  dragX?: number;
  dragging?: boolean;
  /** 正在飞出 */
  leaving?: DeckLeaving | null;
  onFlip: () => void;
  onShowHint: () => void;
  onSeek?: (startMs: number) => void;
}

const PAPER = 'rounded-[18px] border border-divider bg-white shadow-[0_1px_2px_rgba(32,49,42,0.05),0_18px_40px_-18px_rgba(32,49,42,0.28)]';
const FLIP_MS = 520;

export function FlashcardDeck({ card, index, total, flipped, showHint, remaining, dragX = 0, dragging = false, leaving = null, onFlip, onShowHint, onSeek }: FlashcardDeckProps) {
  const faceStyle: CSSProperties = { backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', gridArea: '1 / 1' };
  const counter = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  const liftRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);

  // 翻面时牌抬起再落回：抬起放在外层（与内层 rotateY 的 transition 不打架），投影层同步散开
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (prefersReducedMotion() || typeof liftRef.current?.animate !== 'function') return;
    liftRef.current.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.035)', offset: 0.5 }, { transform: 'scale(1)' }],
      { duration: FLIP_MS, easing: 'ease-in-out' },
    );
    shadowRef.current?.animate(
      [{ opacity: 0.5, transform: 'translateY(12px) scale(0.94)' }, { opacity: 0.85, transform: 'translateY(26px) scale(1.04)', offset: 0.5 }, { opacity: 0.5, transform: 'translateY(12px) scale(0.94)' }],
      { duration: FLIP_MS, easing: 'ease-in-out' },
    );
  }, [flipped]);

  const width = 420;
  const drag = dragTransform(dragX, width);
  const fly = leaving ? flyOutTransform(leaving.direction, width) : null;
  const topTransform = fly
    ? `translateX(${fly.x}px) rotate(${fly.rotateDeg}deg)`
    : dragging
      ? `translateX(${drag.x}px) rotate(${drag.rotateDeg}deg)`
      : 'translateX(0) rotate(0deg)';
  const topTransition = dragging ? 'none' : fly ? 'transform 260ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 240ms ease-in' : 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)';
  // 翻开的牌拖动时染色：右 pine / 左 vermilion；飞出时按分数染满
  const progress = flipped && dragging ? swipeProgress(dragX, width) : 0;
  const tintColor = leaving?.tint
    ? (leaving.tint === 'got' ? 'var(--mm-pine)' : 'var(--mm-vermilion)')
    : progress > 0 ? 'var(--mm-pine)' : 'var(--mm-vermilion)';
  const tintOpacity = leaving?.tint ? 0.16 : Math.abs(progress) * 0.14;
  const frontSize = faceFontSize(card.front);
  const backSize = faceFontSize(card.back, true);

  return (
    <div className="relative w-full max-w-[420px]" style={{ perspective: '1200px' }}>
      {/* 牌堆：最多露两层；顶牌飞走时它们原地不动，新顶牌从这里升上来 */}
      {remaining >= 2 ? <div className={`absolute inset-x-0 top-0 h-full ${PAPER} translate-y-[20px] scale-[0.92] opacity-60 transition-transform duration-[260ms] motion-reduce:transition-none`} aria-hidden /> : null}
      {remaining >= 1 ? <div className={`absolute inset-x-0 top-0 h-full ${PAPER} translate-y-[10px] scale-[0.96] opacity-85 transition-transform duration-[260ms] motion-reduce:transition-none`} aria-hidden /> : null}

      {/* 顶牌：key 随牌变——新牌从牌堆位置升上来 */}
      <div
        key={card.id}
        className="mm-card-rise relative"
        style={{ transform: topTransform, transition: topTransition, opacity: fly ? 0 : 1, willChange: dragging ? 'transform' : undefined }}
      >
        {/* 翻面时散开又收回的投影层（跟着顶牌走） */}
        <div ref={shadowRef} aria-hidden className="pointer-events-none absolute inset-x-10 bottom-2 top-6 rounded-[24px] bg-ink/10 blur-2xl" style={{ opacity: 0.5, transform: 'translateY(12px) scale(0.94)' }} />
        <div ref={liftRef} className="relative">
          <div
            role="button"
            tabIndex={0}
            aria-label={flipped ? card.back : card.front}
            aria-pressed={flipped}
            onClick={onFlip}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onFlip(); } }}
            className="mm-focus grid cursor-pointer rounded-[18px] outline-none transition-transform duration-[520ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
            style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
          >
            {/* 正面 */}
            <div className={`${PAPER} flex min-h-[280px] flex-col p-6 md:min-h-[300px] md:p-7`} style={faceStyle} aria-hidden={flipped}>
              <div className="flex items-baseline justify-between text-[11px] tracking-[0.08em] text-ink-muted">
                <span className="font-medium">{APPS_COPY.flashcards.frontLabel}</span>
                <span className="tabular-nums">{counter}</span>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                <p className="font-medium leading-[1.65] tracking-[-0.01em] text-ink" style={{ fontSize: frontSize }}>
                  <MathText text={card.front} />
                </p>
                {card.hint && showHint ? (
                  <p className="mm-app-enter mt-5 max-w-[92%] text-[13.5px] leading-[1.7] text-ink-secondary">{card.hint}</p>
                ) : null}
              </div>
              <div className="flex items-end justify-between text-[12px] text-ink-muted">
                {card.hint && !showHint ? (
                  <button
                    type="button"
                    tabIndex={flipped ? -1 : 0}
                    className="mm-focus rounded underline decoration-divider underline-offset-4 transition hover:text-ink hover:decoration-ink-muted"
                    onClick={(event) => { event.stopPropagation(); onShowHint(); }}
                  >
                    {APPS_COPY.flashcards.showHint}
                  </button>
                ) : <span />}
                <span className="text-ink-muted/70">{APPS_COPY.flashcards.reveal}</span>
              </div>
            </div>

            {/* 背面：同一张纸，多一道松绿顶边；与正面叠在同一格，牌高取两面较高者 */}
            <div
              className={`${PAPER} flex min-h-[280px] flex-col border-t-[3px] border-t-pine p-6 md:min-h-[300px] md:p-7`}
              style={{ ...faceStyle, transform: 'rotateY(180deg)' }}
              aria-hidden={!flipped}
            >
              <div className="flex items-baseline justify-between text-[11px] tracking-[0.08em] text-ink-muted">
                <span className="font-medium text-pine">{APPS_COPY.flashcards.backLabel}</span>
                <span className="tabular-nums">{counter}</span>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                <p className="leading-[1.75] tracking-[-0.005em] text-ink" style={{ fontSize: backSize }}>
                  <MathText text={card.back} />
                </p>
              </div>
              <div className="flex items-end justify-between text-[12px] text-ink-muted">
                <span className="truncate text-ink-muted/70">{card.front}</span>
                {card.evidence ? (
                  <button
                    type="button"
                    tabIndex={flipped ? 0 : -1}
                    disabled={!onSeek}
                    className="mm-focus ml-3 shrink-0 rounded text-ink-muted/70 transition hover:text-ink disabled:cursor-default"
                    onClick={(event) => { event.stopPropagation(); onSeek?.(card.evidence!.startMs); }}
                  >
                    {onSeek
                      ? APPS_COPY.flashcards.returnToEvidenceAt(formatFlashcardEvidenceTime(card.evidence.startMs))
                      : APPS_COPY.flashcards.evidenceAt(formatFlashcardEvidenceTime(card.evidence.startMs))}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {/* 打分染色：拖动时随进度，飞出时染满 */}
        {tintOpacity > 0 ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[18px]" style={{ background: tintColor, opacity: tintOpacity, transition: dragging ? 'none' : 'opacity 200ms ease' }} />
        ) : null}
      </div>
    </div>
  );
}
