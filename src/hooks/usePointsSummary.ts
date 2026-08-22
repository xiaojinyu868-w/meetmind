/**
 * usePointsSummary — 积分余额与流水（React 层）
 *
 * 纯取数在 ./points-api（node 可测）；这里只做：
 *   - 登录态驱动：无 token 不发请求、summary 为 null（guest 无积分概念，
 *     组件据此静默隐藏积分 UI）
 *   - 监听 notifyPointsChanged() 事件（含 BroadcastChannel 跨标签页），扣费后静默刷新余额
 *   - 页面回前台（visibilitychange/focus）自动刷新，覆盖站外完成支付的场景
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { fetchPointsSummary, onPointsChanged, type PointsSummary } from './points-api';

export {
  notifyPointsChanged,
  type PointsSummary,
  type PointsTransaction,
} from './points-api';

export interface UsePointsSummaryReturn {
  /** null = 未登录 / 加载中 / 加载失败（组件应静默隐藏积分 UI） */
  summary: PointsSummary | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function usePointsSummary(): UsePointsSummaryReturn {
  const { accessToken, isAuthenticated } = useAuth();
  const [summary, setSummary] = useState<PointsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setSummary(null);
      return;
    }
    setIsLoading(true);
    const next = await fetchPointsSummary(accessToken);
    setSummary(next);
    setIsLoading(false);
  }, [accessToken]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      setSummary(null);
      return;
    }
    void refresh();
  }, [isAuthenticated, accessToken, refresh]);

  useEffect(() => onPointsChanged(() => void refresh()), [refresh]);

  // 回前台自动刷新：覆盖"扫码后关掉付费弹窗、稍后在手机上完成支付"
  // 与"另一台设备付款"场景——此前无任何机制再拉一次，界面会一直停在免费态
  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [isAuthenticated, accessToken, refresh]);

  return { summary, isLoading, refresh };
}
