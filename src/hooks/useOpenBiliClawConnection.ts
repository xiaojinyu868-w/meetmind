'use client';

import { useEffect, useState, useCallback } from 'react';
import { checkHealth } from '@/lib/services/openbiliclaw-client';

/**
 * OpenBiliClaw 连接检测 hook — M15 Phase 2
 *
 * 检测本地 OpenBiliClaw 是否在线。
 * 在线时信息流 tab 升级为真实 B站视频卡片推荐。
 * 30 秒自动重检。
 */
export function useOpenBiliClawConnection() {
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const ok = await checkHealth();
    setOnline(ok);
    setChecking(false);
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, [check]);

  return { online, checking, recheck: check };
}
