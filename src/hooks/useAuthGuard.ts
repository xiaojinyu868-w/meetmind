/**
 * 认证守卫 Hook
 * 
 * 用于保护需要登录才能访问的页面/功能
 * 未登录用户将被自动重定向到登录页
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';

interface UseAuthGuardOptions {
  /** 是否启用自动跳转（默认 true） */
  redirectOnUnauthenticated?: boolean;
  /** 跳转目标（默认 /login） */
  redirectTo?: string;
  /** 登录后返回的页面路径（可选） */
  returnTo?: string;
}

interface UseAuthGuardResult {
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** 是否正在加载认证状态 */
  isLoading: boolean;
  /** 当前用户ID（未登录时为 null） */
  userId: string | null;
  /** 当前用户信息 */
  user: ReturnType<typeof useAuth>['user'];
}

/**
 * 认证守卫 Hook
 * 
 * @example
 * ```tsx
 * function ProtectedPage() {
 *   const { isAuthenticated, isLoading, userId } = useAuthGuard();
 *   
 *   if (isLoading) return <Loading />;
 *   if (!isAuthenticated) return null; // 会自动跳转
 *   
 *   return <div>Welcome, user {userId}!</div>;
 * }
 * ```
 */
export function useAuthGuard(options: UseAuthGuardOptions = {}): UseAuthGuardResult {
  const {
    redirectOnUnauthenticated = true,
    redirectTo = '/login',
    returnTo,
  } = options;

  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    // 等待认证状态加载完成
    if (isLoading) return;

    // 未登录且启用自动跳转
    if (!isAuthenticated && redirectOnUnauthenticated) {
      // 构建跳转 URL，包含返回路径
      let redirectUrl = redirectTo;
      if (returnTo) {
        redirectUrl += `?returnTo=${encodeURIComponent(returnTo)}`;
      } else if (typeof window !== 'undefined') {
        // 默认返回当前页面
        const currentPath = window.location.pathname;
        if (currentPath !== redirectTo && currentPath !== '/') {
          redirectUrl += `?returnTo=${encodeURIComponent(currentPath)}`;
        }
      }
      
      router.push(redirectUrl);
    }
  }, [isAuthenticated, isLoading, redirectOnUnauthenticated, redirectTo, returnTo, router]);

  return {
    isAuthenticated,
    isLoading,
    userId: user?.id || null,
    user,
  };
}

export default useAuthGuard;
