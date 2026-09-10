'use client';

/**
 * TeachBackCueCards — 要讲的几点 = 手卡。这是讲者唯一需要看字的地方，所以字要大且少：每张只有要点一句话。
 *
 * 开场（TeachBackOpening）：几点在画面中央，评委已经坐好，讲者站上去前看一眼；一个大按钮「开始讲」。
 * 开讲后它们收成画面左侧一列小卡（桌面 220px 宽）或顶部横向条（手机 / 窄容器，可左右滑）：
 * 点一张把它翻过去（"讲过了"——翻牌动效，不做 AI 判定），随时提醒自己讲到哪了；再点翻回来。
 *
 * 从中央收成手卡用 FLIP：窗口在点「开始讲」那一刻量好每一点在中央的位置（data-cue-origin），
 * 手卡挂载后从那里飞到自己的位置（Web Animations，reduced-motion 下不飞）。
 */

import { useLayoutEffect, useRef } from 'react';
import { Check, Mic } from 'lucide-react';
import type { TeachBackTarget } from '@/lib/ai-native/types';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import { prefersReducedMotion } from './app-motion';

/* ── 开场：几点在中央 + 开始讲 ── */

interface OpeningProps {
  targets: TeachBackTarget[];
  onStart: () => void;
  compact: boolean;
}

export function TeachBackOpening({ targets, onStart, compact }: OpeningProps) {
  const copy = APPS_COPY.teachBack;
  return (
    <div className={`mx-auto w-full max-w-[560px] ${compact ? 'px-5 pt-5' : 'px-6 pt-8'}`} data-testid="teach-back-opening">
      <ol className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
        {targets.map((target, index) => (
          <li key={target.id} data-cue-origin={target.id} className="flex gap-4" title={target.why}>
            <span className="mt-[7px] w-6 shrink-0 font-mono text-[12px] leading-none text-ink-muted">{String(index + 1).padStart(2, '0')}</span>
            <p className={`text-ink ${compact ? 'text-[16px] leading-7' : 'text-[17px] leading-8'}`}>{target.point}</p>
          </li>
        ))}
      </ol>
      <div className={`flex justify-center ${compact ? 'mt-7' : 'mt-10'}`}>
        <button
          type="button"
          onClick={onStart}
          className="mm-press mm-focus inline-flex h-12 items-center justify-center gap-2 rounded-full bg-pine px-8 text-[15px] font-medium text-white hover:opacity-90"
          data-testid="teach-back-start"
        >
          <Mic size={16} strokeWidth={2} aria-hidden />
          {copy.startVoice}
        </button>
      </div>
    </div>
  );
}

/* ── 手卡 ── */

interface CueCardsProps {
  targets: TeachBackTarget[];
  flipped: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** 左侧一列（桌面）/ 顶部横向条（手机、窄容器） */
  variant: 'column' | 'strip';
  /** 开场时量好的中央位置：挂载后从那里飞过来；null = 不飞 */
  origins: Map<string, DOMRect> | null;
  /** 复盘里评委正说到的那几点：那几张卡亮一道松绿边 */
  lit?: string[];
}

export function TeachBackCueCards({ targets, flipped, onToggle, variant, origins, lit }: CueCardsProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const flownRef = useRef(false);

  useLayoutEffect(() => {
    if (flownRef.current || !origins || origins.size === 0 || prefersReducedMotion()) return;
    flownRef.current = true;
    const root = rootRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-cue-id]'));
    cards.forEach((card, index) => {
      const origin = origins.get(card.dataset.cueId ?? '');
      if (!origin || typeof card.animate !== 'function') return;
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dx = origin.left - rect.left;
      const dy = origin.top - rect.top;
      const sx = Math.max(0.2, origin.width / rect.width);
      const sy = Math.max(0.2, origin.height / rect.height);
      card.animate(
        [
          { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.35 },
          { transformOrigin: 'top left', transform: 'none', opacity: 1 },
        ],
        { duration: 460, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', delay: index * 40, fill: 'backwards' },
      );
    });
  }, [origins]);

  if (variant === 'strip') {
    return (
      <div ref={rootRef} className="mm-no-scrollbar flex gap-2 overflow-x-auto px-4 py-2.5" data-testid="teach-back-cue-cards" data-variant="strip">
        {targets.map((target, index) => (
          <CueCard key={target.id} target={target} index={index} flipped={flipped.has(target.id)} lit={Boolean(lit?.includes(target.id))} onToggle={onToggle} size="sm" />
        ))}
      </div>
    );
  }
  return (
    <div ref={rootRef} className="flex flex-col gap-2.5" data-testid="teach-back-cue-cards" data-variant="column">
      {targets.map((target, index) => (
        <CueCard key={target.id} target={target} index={index} flipped={flipped.has(target.id)} lit={Boolean(lit?.includes(target.id))} onToggle={onToggle} size="md" />
      ))}
    </div>
  );
}

interface CueCardProps {
  target: TeachBackTarget;
  index: number;
  flipped: boolean;
  lit: boolean;
  onToggle: (id: string) => void;
  size: 'md' | 'sm';
}

function CueCard({ target, index, flipped, lit, onToggle, size }: CueCardProps) {
  const copy = APPS_COPY.teachBack;
  const small = size === 'sm';
  const face = small ? 'rounded-md px-3 py-2' : 'rounded-lg px-3.5 py-3';
  const text = small ? 'text-[13px] leading-5' : 'text-[14px] leading-6';
  return (
    <button
      type="button"
      onClick={() => onToggle(target.id)}
      aria-pressed={flipped}
      title={flipped ? copy.cueFlippedHint : copy.cueHint}
      data-testid={`teach-back-cue-${target.id}`}
      data-cue-id={target.id}
      data-flipped={flipped || undefined}
      data-lit={lit || undefined}
      className={`mm-focus relative shrink-0 rounded-lg text-left [perspective:900px] ${small ? 'w-[172px]' : 'w-full'}`}
    >
      <span
        className={`relative block transition-transform duration-[420ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] [transform-style:preserve-3d] motion-reduce:transition-none ${flipped ? '[transform:rotateY(180deg)]' : ''}`}
      >
        {/* 正面：要点一句话 */}
        <span className={`block bg-card shadow-soft transition-shadow duration-300 [backface-visibility:hidden] ${face} ${lit ? 'ring-1 ring-pine/60' : ''}`}>
          <span className="block font-mono text-[10px] leading-none text-ink-muted">{String(index + 1).padStart(2, '0')}</span>
          <span className={`mt-1.5 block text-ink ${text} ${small ? 'line-clamp-2' : ''}`}>{target.point}</span>
        </span>
        {/* 背面：讲过了 */}
        <span className={`absolute inset-0 block bg-paper-warm [backface-visibility:hidden] [transform:rotateY(180deg)] ${face} ${lit ? 'ring-1 ring-pine/60' : ''}`} aria-hidden>
          <Check size={small ? 12 : 14} strokeWidth={2.2} className="text-pine" />
          <span className={`mt-1 block text-ink-muted ${text} ${small ? 'line-clamp-1' : 'line-clamp-3'}`}>{target.point}</span>
        </span>
      </span>
    </button>
  );
}
