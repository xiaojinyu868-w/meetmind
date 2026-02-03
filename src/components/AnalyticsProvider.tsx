/**
 * 数据分析上下文提供者
 * 
 * 在应用根组件中提供分析功能：
 * - 自动初始化和管理分析会话
 * - 提供 trackEvent 方法供子组件使用
 * - 处理用户登录状态变化
 */

'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';

// 核心事件类型
export type CoreEventName = 
  | 'recording_start'      // 开始录音
  | 'recording_end'        // 结束录音
  | 'anchor_mark'          // 标记困惑点
  | 'anchor_resolve'       // 解决困惑点
  | 'tutor_chat_start'     // 开始 AI 对话
  | 'tutor_chat_complete'  // 完成 AI 对话
  | 'onboarding_start'     // 开始新手引导
  | 'onboarding_complete'  // 完成新手引导
  | 'login'                // 用户登录
  | 'logout'               // 用户登出
  | 'register';            // 用户注册

// 事件分类
export type EventCategory = 
  | 'recording'   // 录音相关
  | 'learning'    // 学习相关
  | 'ai'          // AI交互
  | 'auth'        // 认证相关
  | 'navigation'; // 导航相关

// Context 类型
interface AnalyticsContextValue {
  trackEvent: (name: string, category?: string, data?: Record<string, unknown>) => void;
  trackCoreEvent: (name: CoreEventName, data?: Record<string, unknown>) => void;
  trackPageView: (path: string, referrer?: string) => void;
  sessionToken: string;
  isEnabled: boolean;
}

// 创建 Context
const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

// Provider Props
interface AnalyticsProviderProps {
  children: ReactNode;
  userId?: string;
  enabled?: boolean;
}

// 核心事件到分类的映射
const coreEventCategories: Record<CoreEventName, EventCategory> = {
  recording_start: 'recording',
  recording_end: 'recording',
  anchor_mark: 'learning',
  anchor_resolve: 'learning',
  tutor_chat_start: 'ai',
  tutor_chat_complete: 'ai',
  onboarding_start: 'navigation',
  onboarding_complete: 'navigation',
  login: 'auth',
  logout: 'auth',
  register: 'auth',
};

/**
 * 数据分析 Provider 组件
 */
export function AnalyticsProvider({ 
  children, 
  userId: initialUserId,
  enabled = true 
}: AnalyticsProviderProps) {
  // 从 localStorage 获取用户ID（如果有登录状态）
  const [userId, setUserId] = useState<string | undefined>(initialUserId);
  
  useEffect(() => {
    // 尝试从 localStorage 获取用户信息
    if (typeof window !== 'undefined') {
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          const user = JSON.parse(userStr);
          if (user?.id) {
            setUserId(user.id);
          }
        }
      } catch {
        // 忽略解析错误
      }
    }
  }, []);
  
  // 监听登录状态变化
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'user') {
        if (e.newValue) {
          try {
            const user = JSON.parse(e.newValue);
            setUserId(user?.id);
          } catch {
            setUserId(undefined);
          }
        } else {
          setUserId(undefined);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);
  
  // 使用分析 Hook
  const { trackEvent, trackPageView, sessionToken } = useAnalytics({
    userId,
    enabled,
    heartbeatInterval: 30000, // 30秒心跳
  });
  
  // 追踪核心事件（带自动分类）
  const trackCoreEvent = (name: CoreEventName, data?: Record<string, unknown>) => {
    const category = coreEventCategories[name];
    trackEvent(name, category, data);
  };
  
  const contextValue: AnalyticsContextValue = {
    trackEvent,
    trackCoreEvent,
    trackPageView,
    sessionToken,
    isEnabled: enabled,
  };
  
  return (
    <AnalyticsContext.Provider value={contextValue}>
      {children}
    </AnalyticsContext.Provider>
  );
}

/**
 * 使用分析上下文的 Hook
 */
export function useAnalyticsContext(): AnalyticsContextValue {
  const context = useContext(AnalyticsContext);
  
  if (!context) {
    // 如果在 Provider 外部使用，返回空操作
    return {
      trackEvent: () => {},
      trackCoreEvent: () => {},
      trackPageView: () => {},
      sessionToken: '',
      isEnabled: false,
    };
  }
  
  return context;
}

export default AnalyticsProvider;
