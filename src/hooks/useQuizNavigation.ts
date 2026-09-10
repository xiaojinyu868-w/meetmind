'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** 测验翻题：键盘 ←→ 与两段式切换（离场 150ms → 换题 → 由窗口做进场）。触屏滑动由窗口用 swipe-model 处理。 */
export const QUIZ_EXIT_MS = 150;

export function useQuizNavigation(questionCount: number) {
  const [index, setIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const navigateTo = useCallback((newIndex: number, dir: 'left' | 'right') => {
    if (isAnimating) return;
    setIsAnimating(true);
    setSlideDir(dir);
    timer.current = setTimeout(() => {
      setIndex(newIndex);
      setSlideDir('none');
      setIsAnimating(false);
    }, QUIZ_EXIT_MS);
  }, [isAnimating]);
  const goToPrev = useCallback(() => {
    if (index > 0 && !isAnimating) navigateTo(index - 1, 'right');
  }, [index, isAnimating, navigateTo]);
  const goToNext = useCallback(() => {
    if (index < questionCount - 1 && !isAnimating) navigateTo(index + 1, 'left');
  }, [index, questionCount, isAnimating, navigateTo]);
  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.key === 'ArrowLeft') goToPrev();
      if (event.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [goToNext, goToPrev]);
  return { index, setIndex, isAnimating, slideDir, navigateTo, goToNext, goToPrev };
}
