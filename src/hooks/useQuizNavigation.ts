'use client';

import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';

/** Keyboard, touch and animated paging; no question or memory policy. */
export function useQuizNavigation(questionCount: number) {
  const [index, setIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [slideDir, setSlideDir] = useState<'none' | 'left' | 'right'>('none');
  const touchStart = useRef<{ x: number; y: number } | null>(null);
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
    }, 250);
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
  const handleTouchStart = useCallback((event: TouchEvent) => {
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, []);
  const handleTouchEnd = useCallback((event: TouchEvent) => {
    if (!touchStart.current) return;
    const x = event.changedTouches[0].clientX - touchStart.current.x;
    const y = event.changedTouches[0].clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(x) > Math.abs(y) && Math.abs(x) > 50) {
      if (x < 0) goToNext(); else goToPrev();
    }
  }, [goToNext, goToPrev]);
  return { index, setIndex, isAnimating, slideDir, navigateTo, goToNext, goToPrev, handleTouchStart, handleTouchEnd };
}
