'use client';

/**
 * 移动端 AI 对话悬浮按钮 (FAB)
 * 
 * 在移动端复习页面底部显示，提供快捷的 AI 对话入口
 * 支持脉冲动画提示、拖拽移动、智能隐藏
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface MobileAIFabProps {
  /** 点击回调 */
  onClick: () => void;
  /** 是否显示 */
  visible?: boolean;
  /** 是否显示脉冲动画 */
  pulse?: boolean;
  /** 自定义位置 */
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
  /** 是否有未读消息 */
  hasUnread?: boolean;
  /** 提示文字 */
  tooltip?: string;
}

export function MobileAIFab({
  onClick,
  visible = true,
  pulse = false,
  position = 'bottom-right',
  hasUnread = false,
  tooltip = '问 AI',
}: MobileAIFabProps) {
  const [isPressed, setIsPressed] = useState(false);
  const [showTooltip, setShowTooltip] = useState(true);
  const fabRef = useRef<HTMLButtonElement>(null);

  // 首次显示 3 秒后隐藏提示
  useEffect(() => {
    if (visible && showTooltip) {
      const timer = setTimeout(() => setShowTooltip(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [visible, showTooltip]);

  // 点击时显示提示
  const handleClick = useCallback(() => {
    setIsPressed(true);
    onClick();
    setTimeout(() => setIsPressed(false), 150);
  }, [onClick]);

  if (!visible) return null;

  const positionClasses = {
    'bottom-right': 'right-4 bottom-20',
    'bottom-left': 'left-4 bottom-20',
    'bottom-center': 'left-1/2 -translate-x-1/2 bottom-20',
  };

  return (
    <div className={cn(
      'fixed z-40 transition-all duration-300',
      positionClasses[position],
      visible ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
    )}>
      {/* 提示气泡 */}
      {showTooltip && tooltip && (
        <div className={cn(
          'absolute bottom-full mb-2 right-0',
          'px-3 py-1.5 rounded-lg shadow-lg',
          'bg-gray-900 text-white text-xs whitespace-nowrap',
          'animate-fade-in'
        )}>
          {tooltip}
          <div className="absolute top-full right-4 -mt-1">
            <div className="w-2 h-2 bg-gray-900 transform rotate-45" />
          </div>
        </div>
      )}

      {/* FAB 按钮 */}
      <button
        ref={fabRef}
        onClick={handleClick}
        data-onboarding="ai-fab"
        className={cn(
          'relative w-14 h-14 rounded-full shadow-lg',
          'bg-gradient-to-br from-amber-500 to-amber-600',
          'flex items-center justify-center',
          'transition-all duration-200',
          'active:scale-95',
          isPressed && 'scale-95',
          pulse && 'animate-pulse-slow'
        )}
      >
        {/* 脉冲环 */}
        {pulse && (
          <>
            <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-30" />
            <span className="absolute inset-0 rounded-full bg-amber-400 animate-ping opacity-20 animation-delay-200" />
          </>
        )}

        {/* 图标 */}
        <svg 
          className="w-6 h-6 text-white" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor" 
          strokeWidth={2}
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" 
          />
        </svg>

        {/* 未读指示器 */}
        {hasUnread && (
          <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-white" />
        )}
      </button>
    </div>
  );
}

export default MobileAIFab;
