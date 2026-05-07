'use client';

/**
 * useHotwordAggregateOnExit (M6.4a)
 *
 * 页面退出 / tab 隐藏时，opportunistically 把用户今天产生的 AsrCorrection
 * 聚合为 AsrHotword，让下次打开的 ASR context 立刻拿到更新。
 *
 * 触发条件：
 *   - 用户已登录（拿到 auth_token）
 *   - 浏览器 visibilitychange=hidden 或 beforeunload
 *
 * 实现用 navigator.sendBeacon，保证 tab 关闭场景也能送达；
 * 失败静默降级——纠错已经落库，下次打开再补一次即可。
 */

import { useEffect } from 'react';

export function useHotwordAggregateOnExit() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const send = () => {
      const token = window.localStorage.getItem('auth_token');
      if (!token) return;
      try {
        const body = new Blob(
          [JSON.stringify({ scope: 'user', windowDays: 30 })],
          { type: 'application/json' },
        );
        // sendBeacon 不支持自定义 header（Authorization）——把 token 放 URL query。
        // /api/asr/corrections/aggregate 需要支持 ?token=xxx fallback 才能用 beacon。
        // 这里先用 fetch + keepalive，兼容现代浏览器，是 sendBeacon 的 header 友好替代。
        fetch('/api/asr/corrections/aggregate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body,
          keepalive: true,
        }).catch(() => {
          /* silent */
        });
      } catch {
        /* silent */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') send();
    };

    window.addEventListener('pagehide', send);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', send);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
