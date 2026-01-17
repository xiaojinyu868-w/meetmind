'use client';

import { useState, useEffect, useCallback } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export interface ResponsiveState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  breakpoint: Breakpoint;
  width: number;
  height: number;
  mounted: boolean;  // 新增：标识客户端是否已挂载
}

const BREAKPOINTS = {
  mobile: 0,
  tablet: 768,
  desktop: 1024,
} as const;

// SSR 安全的默认值 - 始终返回桌面版，与服务端渲染一致
const SSR_DEFAULT: ResponsiveState = {
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  breakpoint: 'desktop',
  width: 1024,
  height: 768,
  mounted: false,
};

function getBreakpoint(width: number): Breakpoint {
  if (width < BREAKPOINTS.tablet) return 'mobile';
  if (width < BREAKPOINTS.desktop) return 'tablet';
  return 'desktop';
}

/**
 * 响应式状态 Hook
 * 提供当前设备类型和屏幕尺寸信息
 * 
 * 重要：为避免 SSR Hydration 错误，首次渲染始终返回桌面版默认值
 * 客户端挂载后通过 useEffect 更新为真实设备状态
 */
export function useResponsive(): ResponsiveState {
  // 首次渲染始终使用 SSR 默认值，避免 Hydration 不匹配
  const [state, setState] = useState<ResponsiveState>(SSR_DEFAULT);

  const updateState = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    const breakpoint = getBreakpoint(width);
    
    setState({
      isMobile: breakpoint === 'mobile',
      isTablet: breakpoint === 'tablet',
      isDesktop: breakpoint === 'desktop',
      breakpoint,
      width,
      height,
      mounted: true,
    });
  }, []);

  useEffect(() => {
    // 客户端挂载后立即更新状态
    updateState();
    
    // 添加 resize 监听
    window.addEventListener('resize', updateState);
    
    // 使用 ResizeObserver 获取更精确的尺寸变化
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateState);
      resizeObserver.observe(document.body);
    }
    
    return () => {
      window.removeEventListener('resize', updateState);
      resizeObserver?.disconnect();
    };
  }, [updateState]);

  return state;
}

/**
 * 判断是否为触摸设备
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const checkTouch = () => {
      setIsTouch(
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0
      );
    };
    
    checkTouch();
  }, []);

  return isTouch;
}

/**
 * 媒体查询 Hook
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
