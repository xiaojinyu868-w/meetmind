'use client';

/**
 * MobileReviewSheet — 移动端底部可拖拽 Sheet
 *
 * 三档 snap：收起 / 半展 / 全展
 * 收起态：拖拽手柄 + 预览文字 + "问一下"按钮
 * 展开态：拖拽手柄 + 内容区（children 撑满剩余空间）
 *
 * 设计原则：内容区最大化，header 极简
 */

import React, { useState, useCallback, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

export interface MobileReviewSheetProps {
  children: React.ReactNode;
  previewText?: string;
  avatar?: React.ReactNode;
  visible?: boolean;
  initialHeight?: 'collapsed' | 'half' | 'full';
  halfHeight?: number;
  fullHeight?: number;
  collapsedHeight?: number;
  onStateChange?: (state: 'collapsed' | 'half' | 'full') => void;
}

type SheetState = 'collapsed' | 'half' | 'full';

export function MobileReviewSheet({
  children,
  previewText = '有问题随时问我',
  avatar,
  visible = true,
  initialHeight = 'collapsed',
  halfHeight,
  fullHeight,
  collapsedHeight = 52,
  onStateChange,
}: MobileReviewSheetProps) {
  // 动态计算高度：半展 = 屏幕高度 55%，全展 = 屏幕高度 90%
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const _halfH = halfHeight ?? Math.floor(screenH * 0.55);
  const _fullH = fullHeight ?? Math.floor(screenH * 0.92);

  const [state, setState] = useState<SheetState>(initialHeight);
  const [height, setHeight] = useState<number>(
    initialHeight === 'collapsed' ? collapsedHeight : initialHeight === 'half' ? _halfH : _fullH,
  );
  const [dragging, setDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  const snapToState = useCallback((targetState: SheetState) => {
    setState(targetState);
    onStateChange?.(targetState);
    const targetHeight = targetState === 'collapsed' ? collapsedHeight : targetState === 'half' ? _halfH : _fullH;
    setHeight(targetHeight);
  }, [collapsedHeight, _halfH, _fullH, onStateChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = height;
  }, [height]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const delta = dragStartYRef.current - e.clientY;
    const next = Math.max(collapsedHeight, Math.min(_fullH, dragStartHeightRef.current + delta));
    setHeight(next);
  }, [dragging, collapsedHeight, _fullH]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    setDragging(false);
    if (height < (collapsedHeight + _halfH) / 2) {
      snapToState('collapsed');
    } else if (height < (_halfH + _fullH) / 2) {
      snapToState('half');
    } else {
      snapToState('full');
    }
  }, [dragging, height, collapsedHeight, _halfH, _fullH, snapToState]);

  if (!visible) return null;

  const isCollapsed = state === 'collapsed';

  return (
    <div
      className="absolute left-0 right-0 bottom-0 z-40 bg-white rounded-t-[20px] shadow-[0_-4px_24px_rgba(0,0,0,0.08)] overflow-hidden"
      style={{
        height: `${height}px`,
        transition: dragging ? 'none' : 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
      }}
    >
      {/* Drag handle — 拖拽热区，尽量大 */}
      <div
        className="flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ minHeight: '32px' }}
      >
        <div className="h-1 w-9 rounded-full bg-divider" />
      </div>

      {isCollapsed ? (
        /* 收起态：预览 + 问一下 */
        <div
          className="px-4 pb-2 cursor-pointer"
          onClick={() => snapToState('half')}
        >
          <div className="flex items-center gap-2.5">
            {avatar}
            <p className="flex-1 truncate text-[12px] text-ink-secondary">
              <span className="font-medium text-ink">同桌：</span>{previewText}
            </p>
            <button
              className="flex-shrink-0 rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-white active:scale-95"
              onClick={(e) => { e.stopPropagation(); snapToState('half'); }}
            >
              问一下
            </button>
          </div>
        </div>
      ) : (
        /* 展开态：内容区撑满剩余空间 */
        <div className="flex flex-col" style={{ height: 'calc(100% - 36px)' }}>
          {/* 收起按钮（右上角小按钮，不占独立行） */}
          <div className="flex-shrink-0 flex items-center justify-end px-3 py-0.5">
            <button
              className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted active:scale-90"
              onClick={() => snapToState('collapsed')}
              aria-label="收起"
            >
              <ChevronDown size={16} strokeWidth={2} />
            </button>
          </div>
          {/* 内容区 — 撑满所有剩余空间 */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

export default MobileReviewSheet;
