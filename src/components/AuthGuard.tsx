/**
 * 认证守卫组件
 * 
 * 包装需要登录才能访问的页面或组件
 * 未登录时显示加载状态并自动跳转到登录页
 */

'use client';

import { ReactNode } from 'react';
import { useAuthGuard } from '@/hooks/useAuthGuard';

interface AuthGuardProps {
  children: ReactNode;
  /** 加载中显示的内容 */
  loadingFallback?: ReactNode;
  /** 未认证时显示的内容（跳转前） */
  unauthenticatedFallback?: ReactNode;
  /** 跳转目标（默认 /login） */
  redirectTo?: string;
  /** 是否启用自动跳转（默认 true） */
  redirectOnUnauthenticated?: boolean;
}

/**
 * 认证守卫组件
 * 
 * @example
 * ```tsx
 * // 基本用法
 * <AuthGuard>
 *   <ProtectedContent />
 * </AuthGuard>
 * 
 * // 自定义加载状态
 * <AuthGuard loadingFallback={<CustomLoader />}>
 *   <ProtectedContent />
 * </AuthGuard>
 * 
 * // 禁用自动跳转
 * <AuthGuard redirectOnUnauthenticated={false} unauthenticatedFallback={<LoginPrompt />}>
 *   <ProtectedContent />
 * </AuthGuard>
 * ```
 */
export function AuthGuard({
  children,
  loadingFallback,
  unauthenticatedFallback,
  redirectTo = '/login',
  redirectOnUnauthenticated = true,
}: AuthGuardProps) {
  const { isAuthenticated, isLoading } = useAuthGuard({
    redirectOnUnauthenticated,
    redirectTo,
  });

  // 加载中
  if (isLoading) {
    return loadingFallback || <DefaultLoadingFallback />;
  }

  // 未认证
  if (!isAuthenticated) {
    // 如果启用自动跳转，显示临时内容（会很快跳转）
    if (redirectOnUnauthenticated) {
      return unauthenticatedFallback || <DefaultLoadingFallback />;
    }
    // 如果不自动跳转，显示未认证内容
    return unauthenticatedFallback || null;
  }

  // 已认证
  return <>{children}</>;
}

/**
 * 默认加载状态
 */
function DefaultLoadingFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--edu-bg-primary)' }}>
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">正在验证登录状态...</p>
      </div>
    </div>
  );
}

export default AuthGuard;
