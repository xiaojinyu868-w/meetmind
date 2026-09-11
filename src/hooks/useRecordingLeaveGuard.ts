'use client';

/**
 * useRecordingLeaveGuard — 录课中要离开这个页面时的一句确认（2026-09-11）。
 *
 * 关标签 / 刷新已有 beforeunload 兜底；这里补的是**客户端路由**：侧栏 / 顶栏里的站内链接
 * （/pocket、/teach、/settings …）点一下就把 /app 整棵树卸掉，Recorder 随之被打断——
 * 内容会由 onRecordingInterrupted 落盘留成「没结束」，但用户应该在离开前知道这件事。
 *
 * 实现：capture 阶段监听 document 的 click，找最近的 a[href]，同源且 pathname 变化才拦；
 * 外链（同 tab 打开也会触发 beforeunload）、新标签、下载、修饰键点击一律放过。
 * 不动 history.pushState：程序化跳转很少、也不该在 router 事务中途弹确认。
 */

import { useEffect } from 'react';

/** 这次点击会不会把当前页面导航到站内另一条路径 */
export function isInAppNavigationClick(params: {
  anchor: HTMLAnchorElement | null;
  currentHref: string;
  button: number;
  hasModifier: boolean;
  defaultPrevented: boolean;
}): boolean {
  const { anchor, currentHref, button, hasModifier, defaultPrevented } = params;
  if (!anchor || defaultPrevented || button !== 0 || hasModifier) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const rawHref = anchor.getAttribute('href') || '';
  if (!rawHref || rawHref.startsWith('#') || /^(mailto|tel|javascript):/i.test(rawHref)) return false;
  let target: URL;
  let current: URL;
  try {
    current = new URL(currentHref);
    target = new URL(rawHref, currentHref);
  } catch {
    return false;
  }
  if (target.origin !== current.origin) return false;
  return target.pathname !== current.pathname;
}

export function useRecordingLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = (target?.closest?.('a[href]') as HTMLAnchorElement | null) ?? null;
      const leaving = isInAppNavigationClick({
        anchor,
        currentHref: window.location.href,
        button: event.button,
        hasModifier: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        defaultPrevented: event.defaultPrevented,
      });
      if (!leaving) return;
      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active, message]);
}
