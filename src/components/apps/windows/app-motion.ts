'use client';

/**
 * app-motion — 应用窗口共用的动效常量与小 hook（2026-09-10 交互打磨）。
 *
 * 规则（windows/DOMAIN.md「状态过渡」）：
 * - 四种状态之间 150–250ms 淡入 + 轻微上移，不许布局跳动；
 * - 加载超过 300ms 才出骨架（避免缓存命中时闪一下）；
 * - prefers-reduced-motion 下全部退成瞬时——JS 侧用 `useReducedMotion` 判断，CSS 侧由 globals.css 的 .mm-* 处理。
 * 纯常量与纯函数放这里，方便单测；动画类名在 globals.css（mm-app-enter / mm-pop-in / mm-draw / mm-stagger / mm-press）。
 */

import { useEffect, useRef, useState } from 'react';

export const MOTION = {
  /** 状态切换 / 内容进场 */
  enterMs: 220,
  /** 内容离场 */
  exitMs: 160,
  /** 揭示类（勾在画、色在染）上限 */
  revealMs: 280,
  /** 加载态出现前的静默期：短于这个时间的等待不值得一张骨架 */
  skeletonDelayMs: 300,
  /** 数字 / 圆环从 0 长到终值 */
  countUpMs: 900,
} as const;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** 响应式读取 prefers-reduced-motion（SSR 期为 false） */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** 触屏为主（没有 hover 能力）的设备：键盘提示不出现、悬停才出现的动作要常显 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia('(hover: none)');
    setCoarse(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

/**
 * `active` 持续为 true 超过 delayMs 后才返回 true；active 变 false 立即回 false。
 * 用于"加载不超过 300ms 才出骨架"。
 */
export function useDelayedFlag(active: boolean, delayMs: number = MOTION.skeletonDelayMs): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}

/**
 * 数字从 0 长到 target（默认 900ms，ease-out）；reduced-motion 或 SSR 直接给终值。
 * 圆环 / 百分比用它就不会"mount 即终态"。
 */
export function useCountUp(target: number, durationMs: number = MOTION.countUpMs): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const fromRef = useRef(0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return undefined;
    }
    const from = fromRef.current;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);
  return value;
}

/**
 * 不重挂载地重放一次进场动画（Web Animations API）。
 * 用在全屏 ⇄ 中栏切换这类"同一棵树换容器"的场合——重挂载会丢窗口内部状态。
 */
export function animateEnter(el: HTMLElement | null, durationMs: number = MOTION.enterMs): void {
  if (!el || prefersReducedMotion() || typeof el.animate !== 'function') return;
  el.animate(
    [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: durationMs, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}
