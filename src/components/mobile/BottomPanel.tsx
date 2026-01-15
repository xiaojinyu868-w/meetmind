'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useDragGesture } from '@/hooks/useDragGesture';
import { cn } from '@/lib/utils';

export type PanelState = 'collapsed' | 'partial' | 'expanded';

export interface BottomPanelProps {
  children: React.ReactNode;
  /** 收起状态的高度百分比 */
  collapsedHeight?: number;
  /** 半展开状态的高度百分比 */
  partialHeight?: number;
  /** 完全展开状态的高度百分比 */
  expandedHeight?: number;
  /** 初始状态 */
  defaultState?: PanelState;
  /** 状态变化回调 */
  onStateChange?: (state: PanelState) => void;
  /** 标题区域 */
  header?: React.ReactNode;
  /** 自定义类名 */
  className?: string;
  /** 是否显示遮罩 */
  showOverlay?: boolean;
  /** 点击遮罩收起 */
  onOverlayClick?: () => void;
}

const STATE_HEIGHTS: Record<PanelState, number> = {
  collapsed: 15,
  partial: 45,
  expanded: 85,
};

/**
 * 可拖拽底部面板组件
 * 支持三档位切换：收起、半展开、完全展开
 */
export function BottomPanel({
  children,
  collapsedHeight = 15,
  partialHeight = 45,
  expandedHeight = 85,
  defaultState = 'collapsed',
  onStateChange,
  header,
  className,
  showOverlay = true,
  onOverlayClick,
}: BottomPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>(defaultState);
  const [currentHeight, setCurrentHeight] = useState(() => {
    switch (defaultState) {
      case 'collapsed': return collapsedHeight;
      case 'partial': return partialHeight;
      case 'expanded': return expandedHeight;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  
  const handleRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startHeightRef = useRef(currentHeight);

  // 更新状态
  const updateState = useCallback((newState: PanelState) => {
    setPanelState(newState);
    onStateChange?.(newState);
    
    let targetHeight: number;
    switch (newState) {
      case 'collapsed': targetHeight = collapsedHeight; break;
      case 'partial': targetHeight = partialHeight; break;
      case 'expanded': targetHeight = expandedHeight; break;
    }
    setCurrentHeight(targetHeight);
  }, [collapsedHeight, partialHeight, expandedHeight, onStateChange]);

  // 根据高度确定最接近的状态
  const getClosestState = useCallback((height: number, velocity: number): PanelState => {
    // 考虑速度因素：快速向上滑动倾向于展开，向下滑动倾向于收起
    const velocityThreshold = 0.5;
    
    if (velocity < -velocityThreshold) {
      // 快速向上滑动
      if (panelState === 'collapsed') return 'partial';
      return 'expanded';
    }
    
    if (velocity > velocityThreshold) {
      // 快速向下滑动
      if (panelState === 'expanded') return 'partial';
      return 'collapsed';
    }
    
    // 根据当前高度判断
    const midLower = (collapsedHeight + partialHeight) / 2;
    const midUpper = (partialHeight + expandedHeight) / 2;
    
    if (height < midLower) return 'collapsed';
    if (height < midUpper) return 'partial';
    return 'expanded';
  }, [collapsedHeight, partialHeight, expandedHeight, panelState]);

  // 拖拽手势处理
  useDragGesture(handleRef, {
    onDragStart: () => {
      setIsDragging(true);
      startHeightRef.current = currentHeight;
    },
    onDragMove: (deltaY) => {
      // deltaY > 0 表示向上拖拽（展开），< 0 表示向下拖拽（收起）
      const viewportHeight = window.innerHeight;
      const deltaPercent = (deltaY / viewportHeight) * 100;
      const newHeight = Math.min(
        expandedHeight,
        Math.max(collapsedHeight, startHeightRef.current + deltaPercent)
      );
      setCurrentHeight(newHeight);
    },
    onDragEnd: (deltaY, velocity) => {
      setIsDragging(false);
      const newState = getClosestState(currentHeight, velocity);
      updateState(newState);
    },
    preventScroll: true,
  });

  // 点击切换状态
  const handleHeaderClick = useCallback(() => {
    if (isDragging) return;
    
    // 循环切换：收起 -> 半展开 -> 展开 -> 收起
    const nextState: Record<PanelState, PanelState> = {
      collapsed: 'partial',
      partial: 'expanded',
      expanded: 'collapsed',
    };
    updateState(nextState[panelState]);
  }, [isDragging, panelState, updateState]);

  // 处理遮罩点击
  const handleOverlayClick = useCallback(() => {
    if (onOverlayClick) {
      onOverlayClick();
    } else {
      updateState('collapsed');
    }
  }, [onOverlayClick, updateState]);

  // 防止面板内容滚动时触发拖拽
  const handleContentTouchMove = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    const scrollableParent = target.closest('[data-scrollable]');
    
    if (scrollableParent) {
      const { scrollTop, scrollHeight, clientHeight } = scrollableParent;
      const isAtTop = scrollTop === 0;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight;
      
      // 只有在滚动到顶部或底部时才允许面板拖拽
      if (!isAtTop && !isAtBottom) {
        e.stopPropagation();
      }
    }
  }, []);

  return (
    <>
      {/* 遮罩层 */}
      {showOverlay && panelState !== 'collapsed' && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300 opacity-100"
          onClick={handleOverlayClick}
        />
      )}
      
      {/* 面板容器 */}
      <div
        ref={containerRef}
        className={cn(
          "fixed left-0 right-0 bottom-0 z-50 bg-white rounded-t-3xl shadow-2xl",
          "transform transition-[height] will-change-[height]",
          isDragging ? 'duration-0' : 'duration-300 ease-out',
          className
        )}
        style={{ height: `${currentHeight}vh` }}
      >
        {/* 拖拽手柄区域 */}
        <div
          ref={handleRef}
          className="flex flex-col items-center pt-2 pb-3 cursor-grab active:cursor-grabbing touch-none select-none"
          onClick={handleHeaderClick}
        >
          {/* 拖拽指示条 */}
          <div className="w-10 h-1 bg-gray-300 rounded-full mb-2" />
          
          {/* 自定义标题区域 */}
          {header}
        </div>
        
        {/* 内容区域 */}
        <div
          className="flex-1 overflow-hidden"
          style={{ height: `calc(100% - ${header ? '80px' : '48px'})` }}
          onTouchMove={handleContentTouchMove}
        >
          <div className="h-full overflow-y-auto" data-scrollable>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * 底部面板标题组件
 */
export interface BottomPanelHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  rightContent?: React.ReactNode;
}

export function BottomPanelHeader({
  title,
  subtitle,
  badge,
  rightContent,
}: BottomPanelHeaderProps) {
  return (
    <div className="w-full px-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {badge}
      </div>
      <div className="flex items-center gap-2">
        {subtitle && (
          <span className="text-sm text-gray-500">{subtitle}</span>
        )}
        {rightContent}
      </div>
    </div>
  );
}
