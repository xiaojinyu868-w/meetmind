'use client';

/**
 * MobileAppNavigator — 移动端统一导航栈
 *
 * 替代 viewMode + mobileSubPage 两套状态机的交叉控制。
 * 用栈结构管理页面，push/pop 语义清晰，每个 screen 有明确的 onBack。
 *
 * 核心设计：
 *   - screen 枚举：home / recording / processing / review / flashcards / empty
 *   - 复习态统一：audio/video/article 三种 contentType 共用 review screen
 *   - 底部 Sheet 统一：所有复习场景共享同一个 MobileReviewSheet
 *   - 导航栈：screens[] 数组，push 追加，pop 移除最后一个
 *   - 页面切换动画：page-in 淡入
 */

import React, { useState, useCallback, createContext, useContext, useMemo } from 'react';

// ── Types ──

export type MobileScreen = 'home' | 'recording' | 'processing' | 'review' | 'flashcards' | 'quiz' | 'cheatsheet' | 'mindmap' | 'audio-overview' | 'infographic' | 'apps' | 'classmate' | 'echo' | 'empty';

export type ReviewContentType = 'audio' | 'video' | 'article';

export interface ReviewContext {
  sessionId: string;
  contentType: ReviewContentType;
  title: string;
  segments?: Array<{ id: string; text: string; startMs: number; endMs: number; isFinal?: boolean }>;
  images?: Array<{ imageId: string; capturedAtMs: number | null; title?: string }>;
}

export interface ScreenState {
  screen: MobileScreen;
  reviewContext?: ReviewContext;
}

interface MobileAppNavigatorContextValue {
  /** 当前栈顶 screen */
  current: ScreenState;
  /** 整个导航栈（用于调试） */
  stack: ScreenState[];
  /** 推入新 screen */
  push: (screen: MobileScreen, reviewContext?: ReviewContext) => void;
  /** 替换栈顶（不增加历史） */
  replace: (screen: MobileScreen, reviewContext?: ReviewContext) => void;
  /** 弹出栈顶（返回上一页） */
  pop: () => void;
  /** 清空栈，回到首页 */
  resetToHome: () => void;
  /** 跳转到指定 screen（清空栈，只留目标） */
  resetTo: (screen: MobileScreen, reviewContext?: ReviewContext) => void;
}

const MobileAppNavigatorContext = createContext<MobileAppNavigatorContextValue | null>(null);

export function useMobileNavigator(): MobileAppNavigatorContextValue {
  const ctx = useContext(MobileAppNavigatorContext);
  if (!ctx) {
    throw new Error('useMobileNavigator must be used within MobileAppNavigator');
  }
  return ctx;
}

// ── Provider ──

export function MobileAppNavigatorProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<ScreenState[]>([{ screen: 'home' }]);

  const push = useCallback((screen: MobileScreen, reviewContext?: ReviewContext) => {
    setStack((prev) => [...prev, { screen, reviewContext }]);
  }, []);

  const replace = useCallback((screen: MobileScreen, reviewContext?: ReviewContext) => {
    setStack((prev) => [...prev.slice(0, -1), { screen, reviewContext }]);
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const resetToHome = useCallback(() => {
    setStack([{ screen: 'home' }]);
  }, []);

  const resetTo = useCallback((screen: MobileScreen, reviewContext?: ReviewContext) => {
    setStack([{ screen, reviewContext }]);
  }, []);

  const value = useMemo<MobileAppNavigatorContextValue>(
    () => {
      const current = stack[stack.length - 1] ?? { screen: 'home' as MobileScreen };
      return { current, stack, push, replace, pop, resetToHome, resetTo };
    },
    [stack, push, replace, pop, resetToHome, resetTo],
  );

  return (
    <MobileAppNavigatorContext.Provider value={value}>
      {children}
    </MobileAppNavigatorContext.Provider>
  );
}

// ── Hook for convenience ──

export function useMobileNav() {
  const { current, push, replace, pop, resetToHome, resetTo } = useMobileNavigator();
  return {
    currentScreen: current.screen,
    reviewContext: current.reviewContext,
    push,
    replace,
    pop,
    resetToHome,
    resetTo,
  };
}
