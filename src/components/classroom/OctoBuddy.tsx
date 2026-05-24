'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';

export type OctoBuddyMood = 'idle' | 'listening' | 'thinking' | 'happy' | 'surprised' | 'love' | 'angry' | 'sleeping';
type OctoBuddyMotion = 'breathe' | 'peek' | 'wiggle' | 'hop' | 'nudge' | 'celebrate' | 'dragging';

export interface OctoBuddySpriteProps {
  mood?: OctoBuddyMood;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export interface OctoBuddyFloatingButtonProps {
  mood?: OctoBuddyMood;
  label?: string;
  sublabel?: string;
  onClick: () => void;
  className?: string;
}

const POSITION_KEY = 'octo-buddy-floating-position';
const BUDDY_SIZE = 142;

const SIZE_CLASS: Record<NonNullable<OctoBuddySpriteProps['size']>, string> = {
  sm: 'h-10 w-10',
  md: 'h-14 w-14',
  lg: 'h-[124px] w-[124px]',
};

const MOOD_ASSET: Record<OctoBuddyMood, string> = {
  idle: '/images/octo-buddy/idle.png',
  listening: '/images/octo-buddy/excited.png',
  thinking: '/images/octo-buddy/thinking.png',
  happy: '/images/octo-buddy/happy.png',
  surprised: '/images/octo-buddy/surprised.png',
  love: '/images/octo-buddy/love.png',
  angry: '/images/octo-buddy/surprised.png',
  sleeping: '/images/octo-buddy/sleeping.png',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readInitialPosition(): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 24, y: 24 };
  const fallback = {
    x: Math.max(24, window.innerWidth - BUDDY_SIZE - 24),
    y: Math.max(24, window.innerHeight - BUDDY_SIZE - 24),
  };
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return fallback;
    return {
      x: clamp(parsed.x, 12, Math.max(12, window.innerWidth - BUDDY_SIZE)),
      y: clamp(parsed.y, 12, Math.max(12, window.innerHeight - BUDDY_SIZE)),
    };
  } catch {
    return fallback;
  }
}

function persistPosition(position: { x: number; y: number }): void {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // ignore
  }
}

function isHardOverride(mood: OctoBuddyMood): boolean {
  return mood === 'listening' || mood === 'thinking';
}

function showBurst(mood: OctoBuddyMood): boolean {
  return mood === 'happy' || mood === 'love' || mood === 'surprised';
}

function pickAmbientMotion(idleFor: number): OctoBuddyMotion {
  if (idleFor > 90_000) return 'breathe';
  if (idleFor > 50_000) return 'nudge';
  const motions: OctoBuddyMotion[] = idleFor > 24_000
    ? ['peek', 'wiggle', 'nudge']
    : ['peek', 'wiggle', 'hop'];
  return motions[Math.floor(Math.random() * motions.length)] ?? 'peek';
}

export function OctoBuddySprite({ mood = 'idle', size = 'md', className }: OctoBuddySpriteProps) {
  return (
    <span
      className={cn(
        'octo-buddy-sprite relative inline-flex items-center justify-center overflow-visible bg-transparent',
        SIZE_CLASS[size],
        className,
      )}
      aria-hidden
    >
      <img
        src={MOOD_ASSET[mood]}
        alt=""
        className="octo-buddy-image h-full w-full object-contain"
        draggable={false}
        style={{ imageRendering: 'pixelated' }}
      />
    </span>
  );
}

export function OctoBuddyFloatingButton({
  mood = 'idle',
  label = COPY.octoBuddy[mood],
  onClick,
  className,
}: OctoBuddyFloatingButtonProps) {
  const [position, setPosition] = React.useState<{ x: number; y: number } | null>(null);
  const [reactionMood, setReactionMood] = React.useState<OctoBuddyMood | null>(null);
  const [idleMood, setIdleMood] = React.useState<OctoBuddyMood>('idle');
  const [motion, setMotion] = React.useState<OctoBuddyMotion>('breathe');
  const [speech, setSpeech] = React.useState<string | null>(null);
  const clickIntensityRef = React.useRef(0);
  const lastInteractionAtRef = React.useRef(Date.now());
  const reactionTimerRef = React.useRef<number | null>(null);
  const decayTimerRef = React.useRef<number | null>(null);
  const speechTimerRef = React.useRef<number | null>(null);
  const openTapTimerRef = React.useRef<number | null>(null);
  const ambientTimerRef = React.useRef<number | null>(null);
  const ambientResetTimerRef = React.useRef<number | null>(null);
  const lastPositionRef = React.useRef<{ x: number; y: number } | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  React.useEffect(() => {
    const initialPosition = readInitialPosition();
    lastPositionRef.current = initialPosition;
    setPosition(initialPosition);
  }, []);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (isHardOverride(mood)) {
        setIdleMood('idle');
        return;
      }
      const idleFor = Date.now() - lastInteractionAtRef.current;
      if (idleFor > 90_000) {
        setIdleMood('sleeping');
      } else if (idleFor > 50_000) {
        setIdleMood('thinking');
      } else if (idleFor > 24_000) {
        setIdleMood('love');
      } else {
        setIdleMood('idle');
      }
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [mood]);

  React.useEffect(() => {
    ambientTimerRef.current = window.setInterval(() => {
      if (isHardOverride(mood) || reactionMood || dragRef.current) return;
      const idleFor = Date.now() - lastInteractionAtRef.current;
      const nextMotion = pickAmbientMotion(idleFor);
      setMotion(nextMotion);
      if (ambientResetTimerRef.current) window.clearTimeout(ambientResetTimerRef.current);
      ambientResetTimerRef.current = window.setTimeout(() => setMotion('breathe'), nextMotion === 'hop' ? 900 : 1500);
    }, 5_800);
    return () => {
      if (ambientTimerRef.current) window.clearInterval(ambientTimerRef.current);
      if (ambientResetTimerRef.current) window.clearTimeout(ambientResetTimerRef.current);
    };
  }, [mood, reactionMood]);

  React.useEffect(() => () => {
    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    if (openTapTimerRef.current) window.clearTimeout(openTapTimerRef.current);
  }, []);

  const updatePosition = React.useCallback((next: { x: number; y: number }) => {
    const clamped = {
      x: clamp(next.x, 12, Math.max(12, window.innerWidth - BUDDY_SIZE)),
      y: clamp(next.y, 12, Math.max(12, window.innerHeight - BUDDY_SIZE)),
    };
    lastPositionRef.current = clamped;
    setPosition(clamped);
    return clamped;
  }, []);

  const showSpeech = React.useCallback((line: string, duration = 1800) => {
    setSpeech(line);
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    speechTimerRef.current = window.setTimeout(() => setSpeech(null), duration);
  }, []);

  const touch = React.useCallback(() => {
    lastInteractionAtRef.current = Date.now();
    setIdleMood('idle');
  }, []);

  const reactToTap = React.useCallback(() => {
    if (isHardOverride(mood)) return;
    touch();
    clickIntensityRef.current += 1;
    if (decayTimerRef.current) window.clearTimeout(decayTimerRef.current);
    decayTimerRef.current = window.setTimeout(() => {
      clickIntensityRef.current = Math.max(0, clickIntensityRef.current - 1);
    }, 1600);

    const nextMood: OctoBuddyMood = idleMood === 'sleeping'
      ? 'surprised'
      : clickIntensityRef.current <= 1
        ? 'happy'
        : clickIntensityRef.current === 2
          ? 'love'
          : clickIntensityRef.current >= 4
            ? 'angry'
            : 'surprised';

    const speechLine = idleMood === 'sleeping'
      ? COPY.octoBuddy.wakeLine
      : nextMood === 'angry'
        ? COPY.octoBuddy.patAngry
        : nextMood === 'surprised'
          ? COPY.octoBuddy.patSurprised
          : nextMood === 'love'
            ? COPY.octoBuddy.patLove
            : COPY.octoBuddy.patHappy;

    setReactionMood(nextMood);
    setMotion(nextMood === 'angry' ? 'nudge' : nextMood === 'love' ? 'celebrate' : 'hop');
    showSpeech(speechLine, nextMood === 'angry' ? 2400 : 1800);
    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = window.setTimeout(() => {
      setReactionMood(null);
      setMotion('breathe');
    }, nextMood === 'angry' ? 3000 : 2400);
  }, [idleMood, mood, showSpeech, touch]);

  const handlePointerEnter = () => {
    if (isHardOverride(mood) || dragRef.current) return;
    touch();
    setMotion('peek');
    showSpeech(COPY.octoBuddy.hoverLine, 1200);
  };

  const handlePointerLeave = () => {
    if (dragRef.current) return;
    setMotion('breathe');
  };

  const handlePetTap = React.useCallback(() => {
    reactToTap();
    if (openTapTimerRef.current) {
      window.clearTimeout(openTapTimerRef.current);
      openTapTimerRef.current = null;
      onClick();
      return;
    }
    openTapTimerRef.current = window.setTimeout(() => {
      openTapTimerRef.current = null;
    }, 280);
  }, [onClick, reactToTap]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!position) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touch();
    setMotion('dragging');
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    updatePosition({ x: drag.originX + dx, y: drag.originY + dy });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setMotion('breathe');
    if (lastPositionRef.current) persistPosition(lastPositionRef.current);
    if (!drag.moved) {
      handlePetTap();
    }
  };

  const style = position
    ? { left: position.x, top: position.y }
    : { right: 24, bottom: 24 };
  const effectiveMood = isHardOverride(mood) ? mood : reactionMood ?? idleMood ?? mood;
  const burstVisible = showBurst(effectiveMood);
  const sleepVisible = effectiveMood === 'sleeping';

  return (
    <button
      type="button"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        dragRef.current = null;
        setMotion('breathe');
      }}
      className={cn(
        'octo-buddy-fab group fixed z-[80] hidden touch-none select-none items-center justify-center border-0 bg-transparent p-0 text-left outline-none transition active:scale-[0.98] lg:flex',
        className,
      )}
      data-mood={effectiveMood}
      data-motion={motion}
      style={style}
      aria-label={`${label}，${COPY.octoBuddy.openPanel}`}
      title={COPY.octoBuddy.dragHint}
    >
      <span className="octo-buddy-aura" aria-hidden />
      <span className="octo-buddy-ground" aria-hidden />
      <span className="octo-buddy-listen-ring octo-buddy-listen-ring-a" aria-hidden />
      <span className="octo-buddy-listen-ring octo-buddy-listen-ring-b" aria-hidden />
      <span className="octo-buddy-orbit octo-buddy-orbit-a" aria-hidden />
      <span className="octo-buddy-orbit octo-buddy-orbit-b" aria-hidden />
      <OctoBuddySprite mood={effectiveMood} size="lg" />
      <span className={cn('octo-buddy-speech', speech && 'octo-buddy-speech-on')} aria-hidden>
        {speech}
      </span>
      <span className={cn('octo-buddy-burst', burstVisible && 'octo-buddy-burst-on')} aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className={cn('octo-buddy-sleep-dust', sleepVisible && 'octo-buddy-sleep-dust-on')} aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <style jsx global>{`
        .octo-buddy-fab {
          height: 142px;
          width: 142px;
          cursor: grab;
        }
        .octo-buddy-fab:active {
          cursor: grabbing;
        }
        .octo-buddy-sprite {
          transform-origin: 50% 76%;
          animation: octoBreath 3.4s ease-in-out infinite;
          filter: drop-shadow(0 16px 18px rgba(30, 27, 54, 0.18));
          position: relative;
          z-index: 3;
        }
        .octo-buddy-image {
          transform-origin: 50% 74%;
        }
        .octo-buddy-ground {
          position: absolute;
          left: 28px;
          right: 28px;
          bottom: 10px;
          height: 16px;
          border-radius: 999px;
          background: rgba(35, 35, 34, 0.12);
          filter: blur(8px);
          transform-origin: center;
          animation: octoGround 3.4s ease-in-out infinite;
          z-index: 0;
        }
        .octo-buddy-aura {
          position: absolute;
          inset: 14px;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(233, 213, 255, 0.28), rgba(219, 234, 254, 0.12) 48%, transparent 72%);
          opacity: 0;
          transform: scale(0.92);
          z-index: 0;
        }
        .octo-buddy-listen-ring {
          position: absolute;
          inset: 9px;
          border: 1px solid rgba(108, 92, 231, 0.22);
          border-radius: 999px;
          opacity: 0;
          z-index: 1;
        }
        .octo-buddy-orbit {
          position: absolute;
          height: 7px;
          width: 7px;
          border-radius: 2px;
          background: rgba(124, 88, 255, 0.52);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.62);
          opacity: 0;
          z-index: 2;
        }
        .octo-buddy-orbit-a { left: 24px; top: 34px; }
        .octo-buddy-orbit-b { right: 23px; top: 48px; height: 5px; width: 5px; background: rgba(72, 177, 255, 0.52); }
        .octo-buddy-speech {
          pointer-events: none;
          position: absolute;
          left: -4px;
          top: -10px;
          z-index: 5;
          max-width: 118px;
          border: 1px solid rgba(233, 233, 231, 0.92);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.94);
          color: #232322;
          font-size: 11px;
          font-weight: 600;
          line-height: 1.25;
          opacity: 0;
          padding: 6px 8px;
          transform: translateY(4px) scale(0.96);
          transition: opacity 160ms ease, transform 160ms ease;
          white-space: nowrap;
        }
        .octo-buddy-speech-on {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
        .octo-buddy-burst,
        .octo-buddy-sleep-dust {
          pointer-events: none;
          position: absolute;
          inset: 0;
          z-index: 4;
        }
        .octo-buddy-burst span,
        .octo-buddy-sleep-dust span {
          position: absolute;
          display: block;
          height: 8px;
          width: 8px;
          border-radius: 2px;
          opacity: 0;
        }
        .octo-buddy-burst span { background: #8B5CF6; }
        .octo-buddy-burst span:nth-child(1) { left: 30px; top: 30px; }
        .octo-buddy-burst span:nth-child(2) { right: 28px; top: 28px; background: #60A5FA; }
        .octo-buddy-burst span:nth-child(3) { left: 26px; bottom: 42px; background: #F0ABFC; }
        .octo-buddy-burst span:nth-child(4) { right: 30px; bottom: 38px; height: 6px; width: 6px; background: #A78BFA; }
        .octo-buddy-sleep-dust span {
          right: 22px;
          top: 26px;
          border-radius: 999px;
          background: rgba(124, 88, 255, 0.44);
        }
        .octo-buddy-sleep-dust span:nth-child(2) { right: 12px; top: 12px; transform: scale(0.72); }
        .octo-buddy-sleep-dust span:nth-child(3) { right: 2px; top: 0; transform: scale(0.52); }
        .octo-buddy-fab[data-mood="listening"] .octo-buddy-listen-ring-a {
          animation: octoSignal 1.55s ease-out infinite;
        }
        .octo-buddy-fab[data-mood="listening"] .octo-buddy-listen-ring-b {
          animation: octoSignal 1.55s ease-out 0.55s infinite;
        }
        .octo-buddy-fab[data-mood="listening"] .octo-buddy-aura,
        .octo-buddy-fab[data-mood="love"] .octo-buddy-aura {
          animation: octoAura 2.6s ease-in-out infinite;
        }
        .octo-buddy-fab[data-mood="thinking"] .octo-buddy-aura {
          animation: octoAura 2s ease-in-out infinite;
        }
        .octo-buddy-fab[data-mood="thinking"] .octo-buddy-image {
          animation: octoImageFocus 2.2s ease-in-out infinite;
        }
        .octo-buddy-fab[data-mood="angry"] .octo-buddy-aura {
          animation: octoTensionAura 900ms ease-in-out infinite;
        }
        .octo-buddy-fab[data-mood="angry"] .octo-buddy-image {
          animation: octoImageTension 520ms steps(2, end) infinite;
        }
        .octo-buddy-fab[data-mood="sleeping"] .octo-buddy-sprite {
          animation: octoSleepStill 4.4s ease-in-out infinite;
        }
        .octo-buddy-fab[data-motion="peek"] .octo-buddy-orbit,
        .octo-buddy-fab[data-motion="wiggle"] .octo-buddy-orbit,
        .octo-buddy-fab[data-motion="nudge"] .octo-buddy-orbit,
        .octo-buddy-fab[data-mood="listening"] .octo-buddy-orbit {
          animation: octoOrbit 2.2s ease-in-out infinite;
        }
        .octo-buddy-fab[data-motion="hop"] .octo-buddy-ground,
        .octo-buddy-fab[data-motion="celebrate"] .octo-buddy-ground {
          animation: octoGroundPop 900ms ease-out both;
        }
        .octo-buddy-fab[data-motion="dragging"] .octo-buddy-sprite {
          animation: none;
          transform: scale(1.018);
        }
        .octo-buddy-fab[data-motion="dragging"] .octo-buddy-ground {
          transform: scaleX(0.72);
          opacity: 0.08;
        }
        .octo-buddy-fab[data-mood="listening"] .octo-buddy-orbit-b {
          animation-delay: 0.4s;
        }
        .octo-buddy-burst-on span {
          animation: octoBurst 900ms ease-out both;
        }
        .octo-buddy-burst-on span:nth-child(2) { animation-delay: 70ms; }
        .octo-buddy-burst-on span:nth-child(3) { animation-delay: 120ms; }
        .octo-buddy-burst-on span:nth-child(4) { animation-delay: 170ms; }
        .octo-buddy-sleep-dust-on span {
          animation: octoSleepDust 2.8s ease-in-out infinite;
        }
        .octo-buddy-sleep-dust-on span:nth-child(2) { animation-delay: 0.45s; }
        .octo-buddy-sleep-dust-on span:nth-child(3) { animation-delay: 0.9s; }
        .group:hover .octo-buddy-aura {
          animation: octoAura 1.6s ease-in-out both;
        }
        @keyframes octoBreath {
          0%, 100% { transform: scale(1); opacity: 1; }
          48% { transform: scale(1.006); opacity: 0.985; }
        }
        @keyframes octoGround {
          0%, 100% { opacity: 0.12; transform: scaleX(0.82); }
          48% { opacity: 0.1; transform: scaleX(0.76); }
        }
        @keyframes octoGroundPop {
          0%, 100% { opacity: 0.12; transform: scaleX(0.82); }
          38% { opacity: 0.06; transform: scaleX(0.58); }
          72% { opacity: 0.16; transform: scaleX(0.92); }
        }
        @keyframes octoAura {
          0%, 100% { opacity: 0.08; transform: scale(0.92); }
          50% { opacity: 0.62; transform: scale(1.04); }
        }
        @keyframes octoTensionAura {
          0%, 100% { opacity: 0.08; transform: scale(0.94); background: radial-gradient(circle, rgba(252, 231, 243, 0.32), transparent 68%); }
          50% { opacity: 0.5; transform: scale(1.02); background: radial-gradient(circle, rgba(252, 231, 243, 0.44), transparent 70%); }
        }
        @keyframes octoImageFocus {
          0%, 100% { transform: scale(1); filter: saturate(1); }
          50% { transform: scale(1.008); filter: saturate(1.06); }
        }
        @keyframes octoImageTension {
          0%, 100% { transform: scale(1); filter: saturate(1.08); }
          50% { transform: scale(1.006); filter: saturate(1.18); }
        }
        @keyframes octoSleepStill {
          0%, 100% { transform: scale(0.985); opacity: 0.94; }
          50% { transform: scale(0.978); opacity: 0.82; }
        }
        @keyframes octoSignal {
          0% { opacity: 0.62; transform: scale(0.76); }
          100% { opacity: 0; transform: scale(1.34); }
        }
        @keyframes octoOrbit {
          0%, 100% { opacity: 0; transform: translateY(0) scale(0.82); }
          35% { opacity: 0.9; }
          70% { opacity: 0.2; transform: translateY(-18px) scale(1.1); }
        }
        @keyframes octoBurst {
          0% { opacity: 0; transform: translate(0, 0) scale(0.55) rotate(0deg); }
          25% { opacity: 1; }
          100% { opacity: 0; transform: translate(var(--octo-burst-x, 0), var(--octo-burst-y, -22px)) scale(1.12) rotate(24deg); }
        }
        .octo-buddy-burst span:nth-child(1) { --octo-burst-x: -18px; --octo-burst-y: -26px; }
        .octo-buddy-burst span:nth-child(2) { --octo-burst-x: 16px; --octo-burst-y: -28px; }
        .octo-buddy-burst span:nth-child(3) { --octo-burst-x: -16px; --octo-burst-y: 18px; }
        .octo-buddy-burst span:nth-child(4) { --octo-burst-x: 18px; --octo-burst-y: 16px; }
        @keyframes octoSleepDust {
          0%, 100% { opacity: 0; transform: translateY(6px) scale(0.6); }
          45% { opacity: 0.72; transform: translateY(-8px) scale(1); }
        }
        @keyframes octoWave {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-6px) rotate(-5deg); }
          60% { transform: translateY(-2px) rotate(4deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .octo-buddy-sprite,
          .octo-buddy-ground,
          .octo-buddy-aura,
          .octo-buddy-listen-ring,
          .octo-buddy-orbit,
          .octo-buddy-burst span,
          .octo-buddy-sleep-dust span,
          .octo-buddy-speech,
          .group:hover .octo-buddy-sprite {
            animation: none !important;
          }
        }
      `}</style>
    </button>
  );
}

export default OctoBuddySprite;
