/**
 * swipe-model — 触屏左右滑的阈值 / 取消 / 跟手与飞出变换（测验翻题、闪卡换牌与打分共用）。
 *
 * 纯函数，无 DOM：
 * - 阈值按容器宽度取（22%，夹在 64–140px）：手机窄一点就少滑一点，桌面宽也不用滑半屏；
 * - 竖向意图（|dy| 明显大于 |dx| 且没过阈值）判为取消，不和页面滚动抢；
 * - 快速一甩（速度 ≥ 0.55px/ms）过半程即可成立——Tinder / Apple Mail 的手感；
 * - 跟手时有阻尼与轻微旋转，松手不成立就回弹（回弹用 CSS transition，这里只给终态）。
 */

export interface SwipeSample {
  dx: number;
  dy: number;
  /** 从按下到松手的毫秒数 */
  dtMs: number;
  /** 被滑动元素（或容器）的宽度 */
  width: number;
}

export type SwipeDirection = 'left' | 'right' | 'cancel';

export const SWIPE = {
  minDistanceRatio: 0.22,
  minDistancePx: 64,
  maxDistancePx: 140,
  /** px/ms */
  minVelocity: 0.55,
  /** 竖向位移超过横向的这个倍数 → 认定是滚动，不是滑动 */
  axisLockRatio: 1.2,
  /** 跟手阻尼（手指走 1px 牌走 0.92px） */
  drag: 0.92,
  /** 最大旋转角（度） */
  maxRotateDeg: 10,
} as const;

export function swipeThreshold(width: number): number {
  const byWidth = width * SWIPE.minDistanceRatio;
  return Math.min(SWIPE.maxDistancePx, Math.max(SWIPE.minDistancePx, byWidth));
}

export function resolveSwipe(sample: SwipeSample): SwipeDirection {
  const { dx, dy, dtMs, width } = sample;
  const threshold = swipeThreshold(width);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // 竖着滑：交给页面滚动
  if (ay > ax * SWIPE.axisLockRatio && ax < threshold) return 'cancel';
  const velocity = dtMs > 0 ? ax / dtMs : 0;
  const passed = ax >= threshold || (ax >= threshold * 0.5 && velocity >= SWIPE.minVelocity);
  if (!passed) return 'cancel';
  return dx < 0 ? 'left' : 'right';
}

/** -1..1：滑到阈值算满，用来给牌面染色 / 显示"将要发生什么" */
export function swipeProgress(dx: number, width: number): number {
  const threshold = swipeThreshold(width);
  return Math.max(-1, Math.min(1, dx / threshold));
}

export interface DragTransform {
  x: number;
  rotateDeg: number;
}

/** 手指还按着时牌的位置：带阻尼、随位移轻微旋转 */
export function dragTransform(dx: number, width: number): DragTransform {
  const x = dx * SWIPE.drag;
  const rotateDeg = Math.max(-SWIPE.maxRotateDeg, Math.min(SWIPE.maxRotateDeg, (dx / Math.max(1, width)) * 18));
  return { x, rotateDeg };
}

/** 成立后飞出：飞出容器宽度的 1.15 倍并继续旋转 */
export function flyOutTransform(direction: Exclude<SwipeDirection, 'cancel'>, width: number): DragTransform {
  const sign = direction === 'left' ? -1 : 1;
  return { x: sign * width * 1.15, rotateDeg: sign * (SWIPE.maxRotateDeg + 4) };
}

export type FlashcardSwipeAction =
  | { kind: 'score'; value: 'got' | 'missed' }
  | { kind: 'nav'; dir: 'next' | 'prev' }
  | { kind: 'cancel' };

/**
 * 闪卡：翻开的牌右滑 = 记住了、左滑 = 没记住；没翻开的牌左滑 = 下一张、右滑 = 上一张。
 * 方向语义与键盘 ←→ 一致（翻面后 ← 没记住 / → 记住了）。
 */
export function resolveFlashcardSwipe(sample: SwipeSample, flipped: boolean): FlashcardSwipeAction {
  const direction = resolveSwipe(sample);
  if (direction === 'cancel') return { kind: 'cancel' };
  if (flipped) return { kind: 'score', value: direction === 'right' ? 'got' : 'missed' };
  return { kind: 'nav', dir: direction === 'left' ? 'next' : 'prev' };
}
