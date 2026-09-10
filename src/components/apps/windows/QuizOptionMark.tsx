'use client';

/**
 * 选项左侧那枚圆：平时是字母，交卷后对的画勾、错的画叉——一笔画出（260ms，mm-draw），色在染（280ms）。
 * 此前是把字母字符换成 "✓" / "✕"，瞬换；揭示应该是"被批改"的感觉，不是换了个字。
 */

export type QuizMarkState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dim';

const RING: Record<QuizMarkState, string> = {
  idle: 'border-divider text-ink-muted group-hover:border-ink-muted',
  selected: 'border-ink bg-ink text-white',
  correct: 'border-pine bg-pine text-white',
  wrong: 'border-vermilion bg-vermilion text-white',
  dim: 'border-divider text-ink-muted',
};

export function QuizOptionMark({ state, letter, delayMs = 0 }: { state: QuizMarkState; letter: string; delayMs?: number }) {
  const drawn = state === 'correct' || state === 'wrong';
  return (
    <span
      className={`mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold tabular-nums transition-colors duration-[280ms] ease-out motion-reduce:transition-none ${RING[state]}`}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
      aria-hidden
    >
      {drawn ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {state === 'correct' ? (
            <path d="M2.8 7.4 5.6 10.2 11.3 4" pathLength={1} className="mm-draw" style={delayMs ? { animationDelay: `${delayMs + 40}ms` } : undefined} />
          ) : (
            <>
              <path d="M3.5 3.5 10.5 10.5" pathLength={1} className="mm-draw" />
              <path d="M10.5 3.5 3.5 10.5" pathLength={1} className="mm-draw" style={{ animationDelay: '140ms' }} />
            </>
          )}
        </svg>
      ) : letter}
    </span>
  );
}
