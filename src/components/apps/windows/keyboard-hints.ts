'use client';

/**
 * keyboard-hints — 每个应用窗口的快捷键提示只在第一次进入时以一行灰字出现一次。
 *
 * 记住"已看过"用 localStorage（key 见 hintStorageKey），触屏为主的设备不出键盘提示。
 * 纯函数（读 / 写 / key）可单测；hook 只负责把它们接到 React 生命周期上。
 */

import { useEffect, useState } from 'react';
import { useCoarsePointer } from './app-motion';

export const KEYBOARD_HINT_PREF_PREFIX = 'meetmind:apps:hint-seen:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function hintStorageKey(appKey: string): string {
  return `${KEYBOARD_HINT_PREF_PREFIX}${appKey}`;
}

export function readHintSeen(storage: StorageLike | undefined, appKey: string): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(hintStorageKey(appKey)) === '1';
  } catch {
    return false;
  }
}

export function markHintSeen(storage: StorageLike | undefined, appKey: string): void {
  if (!storage) return;
  try {
    storage.setItem(hintStorageKey(appKey), '1');
  } catch {
    // 隐私模式 / 配额满：这次看不到"记住"，下次再出一遍也无妨
  }
}

/**
 * 首次进入返回 visible=true 并立刻记为已看过（本次挂载期间一直可见，下次进入不再出现）。
 * 触屏为主的设备（hover: none）永远 false——键盘提示对它没有意义。
 */
export function useKeyboardHintOnce(appKey: string): boolean {
  const coarse = useCoarsePointer();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const storage = typeof window === 'undefined' ? undefined : window.localStorage;
    if (readHintSeen(storage, appKey)) return;
    setVisible(true);
    markHintSeen(storage, appKey);
  }, [appKey]);
  return visible && !coarse;
}
