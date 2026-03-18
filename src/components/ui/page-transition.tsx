'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';

interface PageTransitionProps {
  children: React.ReactNode;
  /** 是否启用过渡动画 */
  enabled?: boolean;
}

/**
 * 页面切换过渡组件
 * 
 * 在路由变化时提供平滑的淡入淡出效果
 * 减少页面切换的突兀感
 */
export function PageTransition({ children, enabled = true }: PageTransitionProps) {
  const pathname = usePathname();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDisplayChildren(children);
      return;
    }

    // 路由变化时触发过渡
    setIsTransitioning(true);
    
    // 淡出后更新内容
    const timer = setTimeout(() => {
      setDisplayChildren(children);
      setIsTransitioning(false);
    }, 150);

    return () => clearTimeout(timer);
  }, [pathname, children, enabled]);

  return (
    <div
      className={`transition-opacity duration-150 ${
        isTransitioning ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {displayChildren}
    </div>
  );
}

/**
 * 轻量级加载遮罩
 * 用于页面切换时的短暂过渡
 */
export function LoadingOverlay({ 
  isVisible, 
  message = '加载中...',
  className = '' 
}: { 
  isVisible: boolean;
  message?: string;
  className?: string;
}) {
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      // 下一帧开始动画
      requestAnimationFrame(() => setIsAnimating(true));
    } else {
      setIsAnimating(false);
      // 动画结束后移除 DOM
      const timer = setTimeout(() => setShouldRender(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center bg-white/80 transition-opacity duration-200 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      } ${className}`}
    >
      <div className="flex flex-col items-center gap-3">
        {/* 加载动画 */}
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-rose-200" />
          <div className="absolute inset-0 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" />
        </div>
        <span className="text-sm text-gray-600 font-medium">{message}</span>
      </div>
    </div>
  );
}

/**
 * 使用页面过渡的 Hook
 * 
 * 返回一个函数，调用时会显示过渡动画
 */
export function usePageTransition() {
  const [isTransitioning, setIsTransitioning] = useState(false);

  const startTransition = useCallback((callback: () => void, duration = 200) => {
    setIsTransitioning(true);
    
    setTimeout(() => {
      callback();
      // 给一点时间让新页面开始渲染
      setTimeout(() => setIsTransitioning(false), 50);
    }, duration);
  }, []);

  return {
    isTransitioning,
    startTransition,
    LoadingOverlay: (
      <LoadingOverlay 
        isVisible={isTransitioning} 
        message="正在跳转..." 
      />
    ),
  };
}
