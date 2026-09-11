'use client';

/**
 * useGuestSyncHint — 访客本机有录好的课时，要不要给「登录后，这节课会跟着你到任何设备」这一句（2026-09-11）。
 *
 * 背景：访客的课永远只在本机，直到某天登录才随登录迁移上去（生产 90 天里有用户 36 节课中位延迟 900+ 小时）。
 * 不弹窗、不催：只在课堂列表恢复条旁 / 移动端首页顶部放一行安静的入口；登录后迁移照旧（只推变过的课）。
 *
 * useLiveQuery 不依赖外部值，deps 省略（等价于 []）；isAuthenticated 只在返回时判，不进查询闭包。
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';

export function useGuestSyncHint(isAuthenticated: boolean): boolean {
  const completedCount = useLiveQuery(
    () => db.audioSessions.where('status').equals('completed').count(),
  ) ?? 0;
  return !isAuthenticated && completedCount > 0;
}
