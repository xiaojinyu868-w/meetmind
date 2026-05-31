'use client';

/**
 * useVisualViewport — 手机端键盘避让基础工程（PRD 手机端 P1）
 *
 * 浏览器的 `window.innerHeight` 在键盘弹起时**不会变**，导致 `100vh` 的元素被键盘
 * 遮挡。`visualViewport` API 提供的是真实可见区域：键盘弹起时它的高度会缩小。
 *
 * 调用方式：
 *   const { height, keyboardHeight, isKeyboardOpen } = useVisualViewport();
 *   <div style={{ height }} />  // 自动随键盘缩放
 *
 * 设计取舍：
 *   - SSR 安全：服务端 / 不支持 visualViewport 的浏览器返回 fallback。
 *   - 不主动 scroll into view —— 各组件自己决定，避免和原生 IME 行为打架。
 *   - 不抖动：用 ref 缓存上次值，差值小于 8px 时不更新（解决某些机型的微抖）。
 */

import { useEffect, useRef, useState } from 'react';

export interface VisualViewportInfo {
  /** 当前可见区域高度（px）。SSR 或不支持时回退到 window.innerHeight。 */
  height: number;
  /** 键盘高度估算 = window.innerHeight - viewport.height */
  keyboardHeight: number;
  /** 键盘是否打开（keyboardHeight > 100 即视为打开，避开浏览器工具栏的 60px 抖动）。 */
  isKeyboardOpen: boolean;
}

export function useVisualViewport(): VisualViewportInfo {
  const [info, setInfo] = useState<VisualViewportInfo>(() => ({
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
    keyboardHeight: 0,
    isKeyboardOpen: false,
  }));

  const lastHeightRef = useRef(info.height);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const vv = window.visualViewport;
    if (!vv) return undefined; // 不支持的浏览器（旧 Safari）→ 保持 fallback

    const update = () => {
      const winH = window.innerHeight;
      const vvH = vv.height;
      // 抖动抑制：相邻两次 < 8px 不更新（避免地址栏隐藏 / 微调导致的连续 setState）
      if (Math.abs(vvH - lastHeightRef.current) < 8) return;
      lastHeightRef.current = vvH;

      const keyboardHeight = Math.max(0, winH - vvH);
      // 大于 100px 才算键盘开启——避免地址栏 60px 抖动误触
      const isKeyboardOpen = keyboardHeight > 100;

      setInfo({ height: vvH, keyboardHeight, isKeyboardOpen });
    };

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update); // 部分 Android 在键盘动画期间 scroll
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return info;
}
