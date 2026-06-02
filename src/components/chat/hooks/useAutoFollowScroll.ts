/**
 * useAutoFollowScroll — 像 Claude / ChatGPT 那样的"智能跟随滚动"。
 *
 * 行为：
 *   - 默认跟随（消息流追到最新）
 *   - 用户上滑超过阈值（24px）→ 停止跟随
 *   - 用户回到底部（距离底部 < 16px）→ 恢复跟随
 *   - 暴露 `followNow()` 给"回到最新"按钮主动调用
 *
 * 不做的事：
 *   - 不直接渲染按钮（让消费者自己渲染，更灵活）
 *   - 不锁滚动条（用户体验差）
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAutoFollowScrollOptions {
  /** 距离底部多近算"在底部"，默认 16px */
  bottomThreshold?: number;
  /** 监听的滚动目标变化（例如 messages.length），变化时若处于跟随态则滚到底 */
  watchKey: unknown;
  /** 跟随时使用的 behavior，默认 'auto'（流式输出每帧滚要 instant） */
  behavior?: ScrollBehavior;
}

export interface UseAutoFollowScrollResult {
  /** 挂到滚动容器的 ref */
  scrollRef: React.RefObject<HTMLDivElement>;
  /** 当前是否处于跟随态（用户没主动上滑） */
  isFollowing: boolean;
  /** 是否需要显示"回到最新"按钮（不在底部 + 有新内容） */
  shouldShowJumpToLatest: boolean;
  /** 主动滚到底并恢复跟随 */
  followNow: () => void;
}

export function useAutoFollowScroll({
  bottomThreshold = 16,
  watchKey,
  behavior = 'auto',
}: UseAutoFollowScrollOptions): UseAutoFollowScrollResult {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const [shouldShowJumpToLatest, setShouldShowJumpToLatest] = useState(false);
  const lastWatchKeyRef = useRef(watchKey);

  // 监听用户滚动行为
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const atBottom = distFromBottom <= bottomThreshold;
        setIsFollowing(atBottom);
        setShouldShowJumpToLatest(!atBottom);
        ticking = false;
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [bottomThreshold]);

  // 当 watchKey 变化时（例如新消息），若仍跟随则滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const changed = lastWatchKeyRef.current !== watchKey;
    lastWatchKeyRef.current = watchKey;
    if (!changed) return;
    if (isFollowing) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      // 内容更新了但用户在上面 → 提示"有新内容"
      setShouldShowJumpToLatest(true);
    }
  }, [watchKey, isFollowing, behavior]);

  const followNow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setIsFollowing(true);
    setShouldShowJumpToLatest(false);
  }, []);

  return { scrollRef, isFollowing, shouldShowJumpToLatest, followNow };
}
