'use client';

/**
 * use-swipe — Pointer Events 版横向滑动：跟手（dx）、阈值判定交给 swipe-model、竖向滚动不被抢。
 *
 * - 位移 > 6px 且横向占优才算开始拖，之后才 setPointerCapture（先捕获会吃掉子元素的 click，导图踩过）；
 * - 松手把 {dx, dy, dtMs, width} 交给 onRelease，成不成立由调用方用 resolveSwipe 决定；
 * - `moved` 供 click 处理器判断"这是拖完松手，不是点击"。
 * 元素上请加 `touch-action: pan-y`，让浏览器仍能处理竖向滚动。
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SwipeSample } from './swipe-model';

interface UseSwipeOptions {
  onRelease: (sample: SwipeSample) => void;
  disabled?: boolean;
}

interface SwipeStart { x: number; y: number; t: number; width: number; dragging: boolean; pointerId: number }

export function useSwipe({ onRelease, disabled = false }: UseSwipeOptions) {
  const startRef = useRef<SwipeStart | null>(null);
  const movedRef = useRef(false);
  const rafRef = useRef(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const reset = useCallback(() => {
    startRef.current = null;
    cancelAnimationFrame(rafRef.current);
    setDx(0);
    setDragging(false);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // 输入框 / 滑杆里的拖动是选字 / 拖进度，不是滑动翻页；按钮上按下仍可开始拖——
    // 只有位移超过 6px 才捕获指针，普通点击照常派发给按钮
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    movedRef.current = false;
    startRef.current = { x: event.clientX, y: event.clientY, t: performance.now(), width: event.currentTarget.getBoundingClientRect().width || 1, dragging: false, pointerId: event.pointerId };
  }, [disabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start) return;
    const ddx = event.clientX - start.x;
    const ddy = event.clientY - start.y;
    if (!start.dragging) {
      if (Math.abs(ddx) < 6) return;
      if (Math.abs(ddy) > Math.abs(ddx)) { startRef.current = null; return; }
      start.dragging = true;
      movedRef.current = true;
      setDragging(true);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 已被别处捕获 */ }
    }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setDx(ddx));
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start) return;
    if (start.dragging) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 无捕获 */ }
      onRelease({ dx: event.clientX - start.x, dy: event.clientY - start.y, dtMs: performance.now() - start.t, width: start.width });
    }
    reset();
    // click 紧随 pointerup：让它还能读到 moved
    if (movedRef.current) setTimeout(() => { movedRef.current = false; }, 0);
  }, [onRelease, reset]);

  const onPointerCancel = useCallback(() => reset(), [reset]);

  return { dx, dragging, movedRef, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
