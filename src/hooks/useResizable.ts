'use client';

/**
 * useResizable Hook
 * 
 * 实现可拖拽调整面板宽度的逻辑，支持：
 * - 鼠标/触摸拖拽
 * - localStorage 状态持久化
 * - 最小/最大尺寸约束
 * - 双击重置为默认值
 */

import { useState, useCallback, useEffect, useRef } from 'react';

interface UseResizableOptions {
  /** 初始尺寸（像素） */
  defaultSize: number;
  /** 最小尺寸 */
  minSize?: number;
  /** 最大尺寸 */
  maxSize?: number;
  /** localStorage 存储 key */
  storageKey?: string;
  /** 拖拽方向 */
  direction?: 'horizontal' | 'vertical';
  /** 尺寸变化回调 */
  onResize?: (size: number) => void;
}

interface UseResizableReturn {
  /** 当前尺寸 */
  size: number;
  /** 是否正在拖拽 */
  isDragging: boolean;
  /** 开始拖拽 */
  startDragging: (e: React.MouseEvent | React.TouchEvent) => void;
  /** 重置为默认尺寸 */
  reset: () => void;
  /** 手动设置尺寸 */
  setSize: (size: number) => void;
}

export function useResizable({
  defaultSize,
  minSize = 200,
  maxSize = 800,
  storageKey,
  direction = 'horizontal',
  onResize,
}: UseResizableOptions): UseResizableReturn {
  // 从 localStorage 读取初始值
  const getInitialSize = useCallback(() => {
    if (storageKey && typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed >= minSize && parsed <= maxSize) {
          return parsed;
        }
      }
    }
    return defaultSize;
  }, [storageKey, defaultSize, minSize, maxSize]);

  const [size, setSizeState] = useState(defaultSize);
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(0);
  const rafRef = useRef<number>();

  // 初始化时从 localStorage 读取
  useEffect(() => {
    setSizeState(getInitialSize());
  }, [getInitialSize]);

  // 保存到 localStorage（防抖）
  const saveToStorage = useCallback((newSize: number) => {
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, String(newSize));
    }
  }, [storageKey]);

  // 设置尺寸（带约束）
  const setSize = useCallback((newSize: number) => {
    const constrainedSize = Math.min(maxSize, Math.max(minSize, newSize));
    setSizeState(constrainedSize);
    onResize?.(constrainedSize);
    saveToStorage(constrainedSize);
  }, [minSize, maxSize, onResize, saveToStorage]);

  // 开始拖拽
  const startDragging = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    
    const clientPos = 'touches' in e 
      ? (direction === 'horizontal' ? e.touches[0].clientX : e.touches[0].clientY)
      : (direction === 'horizontal' ? e.clientX : e.clientY);
    
    startPosRef.current = clientPos;
    startSizeRef.current = size;
  }, [size, direction]);

  // 拖拽中
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => {
        const clientPos = 'touches' in e
          ? (direction === 'horizontal' ? e.touches[0].clientX : e.touches[0].clientY)
          : (direction === 'horizontal' ? e.clientX : e.clientY);
        
        const delta = clientPos - startPosRef.current;
        const newSize = startSizeRef.current + delta;
        
        setSize(newSize);
      });
    };

    const handleEnd = () => {
      setIsDragging(false);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };

    // 添加事件监听
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    // 拖拽时禁止选中文字
    document.body.style.userSelect = 'none';
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, direction, setSize]);

  // 重置为默认值
  const reset = useCallback(() => {
    setSize(defaultSize);
  }, [defaultSize, setSize]);

  return {
    size,
    isDragging,
    startDragging,
    reset,
    setSize,
  };
}
