/**
 * SWR 全局 Provider 配置
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - client-swr-dedup: 配置 dedupingInterval 实现请求去重
 * - server-cache-react: 配合服务端缓存策略
 * 
 * @see https://swr.vercel.app/docs/global-configuration
 */

'use client';

import { SWRConfig, type SWRConfiguration } from 'swr';
import { ReactNode, useCallback } from 'react';
import { authFetcher, type FetcherError } from './fetcher';

// ==================== 全局配置 ====================

/**
 * SWR 全局配置
 * 
 * - dedupingInterval: 5秒内相同请求自动去重
 * - revalidateOnFocus: 禁用焦点时重新验证（移动端体验优化）
 * - revalidateOnReconnect: 网络恢复时重新验证
 * - errorRetryCount: 失败最多重试 3 次
 * - errorRetryInterval: 重试间隔 3 秒
 * - shouldRetryOnError: 仅对网络错误重试，不对 4xx 错误重试
 */
const swrConfig: SWRConfiguration = {
  fetcher: authFetcher,
  
  // 请求去重：5 秒内相同 key 的请求只发送一次
  dedupingInterval: 5000,
  
  // 禁用焦点时重新验证，避免移动端频繁刷新
  revalidateOnFocus: false,
  
  // 网络恢复时重新验证
  revalidateOnReconnect: true,
  
  // 错误重试配置
  errorRetryCount: 3,
  errorRetryInterval: 3000,
  
  // 仅对网络错误重试
  shouldRetryOnError: (error: FetcherError) => {
    // 4xx 错误不重试
    if (error.status && error.status >= 400 && error.status < 500) {
      return false;
    }
    return true;
  },
  
  // 保持前一个数据，避免加载时闪烁
  keepPreviousData: true,
};

// ==================== Provider 组件 ====================

interface SWRProviderProps {
  children: ReactNode;
}

/**
 * SWR Provider 组件
 * 
 * 在 layout.tsx 中使用，为整个应用提供 SWR 配置
 * 
 * @example
 * // app/layout.tsx
 * <AuthProvider>
 *   <SWRProvider>
 *     {children}
 *   </SWRProvider>
 * </AuthProvider>
 */
export function SWRProvider({ children }: SWRProviderProps) {
  // 全局错误处理
  const onError = useCallback((error: FetcherError, key: string) => {
    // 静默处理 401 错误（由 AuthProvider 处理）
    if (error.status === 401) {
      return;
    }
    
    // 开发环境打印错误
    if (process.env.NODE_ENV === 'development') {
      console.error(`[SWR Error] ${key}:`, error);
    }
  }, []);
  
  return (
    <SWRConfig value={{ ...swrConfig, onError }}>
      {children}
    </SWRConfig>
  );
}

export default SWRProvider;
