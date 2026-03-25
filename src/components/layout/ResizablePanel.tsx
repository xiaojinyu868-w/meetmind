'use client';

/**
 * ResizablePanel 可拖拽布局组件
 * 
 * 支持水平方向的可拖拽分隔线布局：
 * - 分隔线拖拽调整宽度
 * - 双击重置为默认宽度
 * - 拖拽时显示高亮线条
 * - 内置 ErrorBoundary，拖拽异常不会导致整页崩溃
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { useResizable } from '@/hooks/useResizable';

interface ResizablePanelProps {
  /** 左侧面板内容 */
  leftPanel: React.ReactNode;
  /** 右侧面板内容 */
  rightPanel: React.ReactNode;
  /** 左侧面板默认宽度 */
  defaultLeftWidth?: number;
  /** 左侧面板最小宽度 */
  minLeftWidth?: number;
  /** 左侧面板最大宽度 */
  maxLeftWidth?: number;
  /** localStorage 存储 key */
  storageKey?: string;
  /** 自定义类名 */
  className?: string;
}

// ── ErrorBoundary（组件内部使用，防止拖拽异常传播到页面级） ──

interface ResizableErrorState {
  hasError: boolean;
}

class ResizableErrorBoundary extends React.Component<
  { children: React.ReactNode; fallbackWidth: number },
  ResizableErrorState
> {
  constructor(props: { children: React.ReactNode; fallbackWidth: number }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ResizableErrorState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ResizablePanel] layout error caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center bg-white px-6 text-center">
          <div className="space-y-2">
            <p className="text-sm text-[#787774]">布局出了一点小问题</p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              className="inline-flex items-center justify-center rounded-full bg-[#232322] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black"
            >
              恢复布局
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── 主组件 ──

function ResizablePanelInner({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 384,
  minLeftWidth = 280,
  maxLeftWidth = 480,
  storageKey = 'resizable-panel-left-width',
  className,
}: ResizablePanelProps) {
  const {
    size: leftWidth,
    isDragging,
    startDragging,
    reset,
  } = useResizable({
    defaultSize: defaultLeftWidth,
    minSize: minLeftWidth,
    maxSize: maxLeftWidth,
    storageKey,
    direction: 'horizontal',
  });

  return (
    <div className={cn('flex h-full overflow-hidden', className)}>
      {/* 左侧面板 */}
      <div
        className="flex-shrink-0 overflow-hidden border-r border-gray-100"
        style={{ width: leftWidth }}
      >
        {leftPanel}
      </div>

      {/* 分隔线 */}
      <div
        className={cn(
          'w-1 flex-shrink-0 cursor-col-resize group relative',
          'bg-transparent hover:bg-[#FDF3C0] transition-colors duration-150',
          isDragging && 'bg-[#FADEC9]'
        )}
        onMouseDown={startDragging}
        onTouchStart={startDragging}
        onDoubleClick={reset}
      >
        {/* 拖拽时的视觉指示器 */}
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5',
            'bg-[#FADEC9] opacity-0 group-hover:opacity-100 transition-opacity',
            isDragging && 'opacity-100 w-1'
          )}
        />
        
        {/* 中间手柄点 */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex flex-col gap-1">
            <div className="w-1 h-1 bg-[#FADEC9] rounded-full" />
            <div className="w-1 h-1 bg-[#FADEC9] rounded-full" />
            <div className="w-1 h-1 bg-[#FADEC9] rounded-full" />
          </div>
        </div>
      </div>

      {/* 右侧面板 */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {rightPanel}
      </div>
    </div>
  );
}

export function ResizablePanel(props: ResizablePanelProps) {
  return (
    <ResizableErrorBoundary fallbackWidth={props.defaultLeftWidth ?? 384}>
      <ResizablePanelInner {...props} />
    </ResizableErrorBoundary>
  );
}
