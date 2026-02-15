/**
 * 数据分析 Hook
 * 
 * 提供轻量级的客户端数据采集功能：
 * - 自动追踪页面停留时长
 * - 心跳机制定期上报
 * - sendBeacon 确保页面关闭时数据不丢失
 * - 事件追踪 API
 */

'use client';

import { useCallback, useEffect, useRef } from 'react';

let analyticsNetworkWarned = false;
let analyticsBackoffUntil = 0;

// 生成唯一会话ID
function generateSessionToken(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

// 获取或创建会话token（存储在sessionStorage）
function getSessionToken(): string {
  if (typeof window === 'undefined') return '';
  
  let token = sessionStorage.getItem('analytics_session_token');
  if (!token) {
    token = generateSessionToken();
    sessionStorage.setItem('analytics_session_token', token);
  }
  return token;
}

// 检查是否为新用户
function checkIsNewUser(): boolean {
  if (typeof window === 'undefined') return false;
  
  const visited = localStorage.getItem('analytics_visited');
  if (!visited) {
    localStorage.setItem('analytics_visited', Date.now().toString());
    return true;
  }
  return false;
}

// 数据上报函数
async function sendAnalytics(payload: Record<string, unknown>, useBeacon = false): Promise<boolean> {
  if (Date.now() < analyticsBackoffUntil) {
    return false;
  }

  const url = '/api/analytics';
  const data = JSON.stringify(payload);
  
  if (useBeacon && navigator.sendBeacon) {
    // 使用 sendBeacon 确保数据发送
    const blob = new Blob([data], { type: 'application/json' });
    return navigator.sendBeacon(url, blob);
  }
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
      keepalive: true, // 允许在页面卸载时继续请求
    });
    if (response.ok) {
      analyticsNetworkWarned = false;
      return true;
    }

    // analytics 失败不影响主流程：进入短暂退避，避免高频重试
    analyticsBackoffUntil = Date.now() + 60_000;
    return false;
  } catch {
    analyticsBackoffUntil = Date.now() + 60_000;
    if (!analyticsNetworkWarned) {
      analyticsNetworkWarned = true;
      console.warn('[Analytics] Failed to send data');
    }
    return false;
  }
}

// Hook 配置
interface UseAnalyticsOptions {
  userId?: string;
  heartbeatInterval?: number; // 心跳间隔（毫秒），默认30秒
  enabled?: boolean;
}

// Hook 返回值
interface UseAnalyticsReturn {
  trackEvent: (name: string, category?: string, data?: Record<string, unknown>) => void;
  trackPageView: (path: string, referrer?: string) => void;
  sessionToken: string;
}

/**
 * 数据分析 Hook
 */
export function useAnalytics(options: UseAnalyticsOptions = {}): UseAnalyticsReturn {
  const {
    userId,
    heartbeatInterval = 30000, // 默认30秒
    enabled = true,
  } = options;
  
  // Refs 用于存储状态
  const sessionTokenRef = useRef<string>('');
  const startTimeRef = useRef<number>(0);
  const activeTimeRef = useRef<number>(0);
  const lastHeartbeatRef = useRef<number>(0);
  const isVisibleRef = useRef<boolean>(true);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentPathRef = useRef<string>('');
  const pageStartTimeRef = useRef<number>(0);
  
  // 初始化会话
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    
    const sessionToken = getSessionToken();
    sessionTokenRef.current = sessionToken;
    startTimeRef.current = Date.now();
    activeTimeRef.current = 0;
    lastHeartbeatRef.current = Date.now();
    currentPathRef.current = window.location.pathname;
    pageStartTimeRef.current = Date.now();
    
    const isNewUser = checkIsNewUser();
    
    // 发送会话开始事件
    sendAnalytics({
      action: 'session_start',
      sessionToken,
      userId,
      data: {
        entryPage: window.location.pathname,
        isNewUser,
      },
    });
    
    // 记录初始页面访问
    sendAnalytics({
      action: 'page_view',
      sessionToken,
      userId,
      data: {
        path: window.location.pathname,
        referrer: document.referrer || undefined,
      },
    });
    
  }, [enabled, userId]);
  
  // 计算活跃时长
  const calculateActiveTime = useCallback(() => {
    if (isVisibleRef.current) {
      const now = Date.now();
      activeTimeRef.current += now - lastHeartbeatRef.current;
      lastHeartbeatRef.current = now;
    }
    return activeTimeRef.current;
  }, []);
  
  // 发送心跳
  const sendHeartbeat = useCallback(() => {
    if (!sessionTokenRef.current) return;
    
    const durationMs = calculateActiveTime();
    
    sendAnalytics({
      action: 'session_update',
      sessionToken: sessionTokenRef.current,
      userId,
      data: {
        durationMs,
        exitPage: currentPathRef.current,
      },
    });
  }, [userId, calculateActiveTime]);
  
  // 页面可见性变化处理
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 页面隐藏，记录当前活跃时间
        if (isVisibleRef.current) {
          const now = Date.now();
          activeTimeRef.current += now - lastHeartbeatRef.current;
        }
        isVisibleRef.current = false;
        
        // 立即发送心跳
        sendHeartbeat();
      } else {
        // 页面显示，重置计时起点
        isVisibleRef.current = true;
        lastHeartbeatRef.current = Date.now();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, sendHeartbeat]);
  
  // 页面卸载处理
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    
    const handleBeforeUnload = () => {
      if (!sessionTokenRef.current) return;
      
      const durationMs = calculateActiveTime();
      
      // 使用 sendBeacon 确保数据发送
      sendAnalytics({
        action: 'session_end',
        sessionToken: sessionTokenRef.current,
        userId,
        data: {
          durationMs,
          exitPage: currentPathRef.current,
        },
      }, true); // 使用 beacon
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled, userId, calculateActiveTime]);
  
  // 心跳定时器
  useEffect(() => {
    if (!enabled) return;
    
    heartbeatTimerRef.current = setInterval(() => {
      sendHeartbeat();
    }, heartbeatInterval);
    
    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }
    };
  }, [enabled, heartbeatInterval, sendHeartbeat]);
  
  // 路由变化监听（针对 SPA）
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    
    const handleRouteChange = () => {
      const newPath = window.location.pathname;
      
      if (newPath !== currentPathRef.current && sessionTokenRef.current) {
        // 记录旧页面的停留时长
        const pageDuration = Date.now() - pageStartTimeRef.current;
        
        // 发送新页面访问
        sendAnalytics({
          action: 'page_view',
          sessionToken: sessionTokenRef.current,
          userId,
          data: {
            path: newPath,
            referrer: currentPathRef.current,
            pageDuration,
          },
        });
        
        // 更新当前路径
        currentPathRef.current = newPath;
        pageStartTimeRef.current = Date.now();
      }
    };
    
    // 监听 popstate（浏览器后退/前进）
    window.addEventListener('popstate', handleRouteChange);
    
    // 使用 MutationObserver 监听 URL 变化（处理 pushState/replaceState）
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        handleRouteChange();
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      observer.disconnect();
    };
  }, [enabled, userId]);
  
  // 追踪自定义事件
  const trackEvent = useCallback((
    name: string,
    category?: string,
    data?: Record<string, unknown>
  ) => {
    if (!enabled || !sessionTokenRef.current) return;
    
    sendAnalytics({
      action: 'event',
      sessionToken: sessionTokenRef.current,
      userId,
      data: {
        eventName: name,
        eventCategory: category,
        eventData: data,
      },
    });
  }, [enabled, userId]);
  
  // 手动追踪页面访问
  const trackPageView = useCallback((path: string, referrer?: string) => {
    if (!enabled || !sessionTokenRef.current) return;
    
    sendAnalytics({
      action: 'page_view',
      sessionToken: sessionTokenRef.current,
      userId,
      data: {
        path,
        referrer,
      },
    });
  }, [enabled, userId]);
  
  return {
    trackEvent,
    trackPageView,
    sessionToken: sessionTokenRef.current,
  };
}

export default useAnalytics;
