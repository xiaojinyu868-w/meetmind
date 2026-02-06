'use client';

import { useRef, useCallback, useEffect } from 'react';

export interface DragGestureOptions {
  onDragStart?: (startY: number) => void;
  onDragMove?: (deltaY: number, currentY: number) => void;
  onDragEnd?: (deltaY: number, velocity: number) => void;
  threshold?: number;
  preventScroll?: boolean;
}

export interface DragState {
  isDragging: boolean;
  startY: number;
  currentY: number;
  deltaY: number;
  velocity: number;
}

export function useDragGesture(
  ref: React.RefObject<HTMLElement | null>,
  options: DragGestureOptions = {},
) {
  const {
    onDragStart,
    onDragMove,
    onDragEnd,
    threshold = 5,
    preventScroll = true,
  } = options;

  const stateRef = useRef<DragState>({
    isDragging: false,
    startY: 0,
    currentY: 0,
    deltaY: 0,
    velocity: 0,
  });

  const lastMoveTimeRef = useRef(0);
  const lastMoveYRef = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    stateRef.current = {
      isDragging: false,
      startY: touch.clientY,
      currentY: touch.clientY,
      deltaY: 0,
      velocity: 0,
    };
    lastMoveTimeRef.current = Date.now();
    lastMoveYRef.current = touch.clientY;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    const deltaY = stateRef.current.startY - touch.clientY;

    if (!stateRef.current.isDragging && Math.abs(deltaY) > threshold) {
      stateRef.current.isDragging = true;
      onDragStart?.(stateRef.current.startY);
    }

    if (stateRef.current.isDragging) {
      if (preventScroll) {
        e.preventDefault();
      }

      const now = Date.now();
      const timeDelta = now - lastMoveTimeRef.current;
      if (timeDelta > 0) {
        stateRef.current.velocity = (touch.clientY - lastMoveYRef.current) / timeDelta;
      }

      lastMoveTimeRef.current = now;
      lastMoveYRef.current = touch.clientY;

      stateRef.current.currentY = touch.clientY;
      stateRef.current.deltaY = deltaY;

      onDragMove?.(deltaY, touch.clientY);
    }
  }, [onDragStart, onDragMove, threshold, preventScroll]);

  const handleTouchEnd = useCallback(() => {
    if (stateRef.current.isDragging) {
      onDragEnd?.(stateRef.current.deltaY, stateRef.current.velocity);
    }

    stateRef.current.isDragging = false;
  }, [onDragEnd]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const deltaY = stateRef.current.startY - e.clientY;

    if (!stateRef.current.isDragging && Math.abs(deltaY) > threshold) {
      stateRef.current.isDragging = true;
      onDragStart?.(stateRef.current.startY);
    }

    if (stateRef.current.isDragging) {
      const now = Date.now();
      const timeDelta = now - lastMoveTimeRef.current;
      if (timeDelta > 0) {
        stateRef.current.velocity = (e.clientY - lastMoveYRef.current) / timeDelta;
      }

      lastMoveTimeRef.current = now;
      lastMoveYRef.current = e.clientY;

      stateRef.current.currentY = e.clientY;
      stateRef.current.deltaY = deltaY;

      onDragMove?.(deltaY, e.clientY);
    }
  }, [onDragStart, onDragMove, threshold]);

  const handleMouseUp = useCallback(() => {
    if (stateRef.current.isDragging) {
      onDragEnd?.(stateRef.current.deltaY, stateRef.current.velocity);
    }

    stateRef.current.isDragging = false;

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  }, [onDragEnd, handleMouseMove]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    stateRef.current = {
      isDragging: false,
      startY: e.clientY,
      currentY: e.clientY,
      deltaY: 0,
      velocity: 0,
    };
    lastMoveTimeRef.current = Date.now();
    lastMoveYRef.current = e.clientY;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: !preventScroll });
    element.addEventListener('touchend', handleTouchEnd);
    element.addEventListener('mousedown', handleMouseDown);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      element.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    ref,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    preventScroll,
  ]);
}
