import { describe, expect, it } from 'vitest';
import {
  dragTransform,
  flyOutTransform,
  resolveFlashcardSwipe,
  resolveSwipe,
  swipeProgress,
  swipeThreshold,
} from './swipe-model';

describe('swipe-model', () => {
  it('阈值随宽度走，夹在 64–140px', () => {
    expect(swipeThreshold(200)).toBe(64);
    expect(swipeThreshold(390)).toBeCloseTo(85.8, 1);
    expect(swipeThreshold(2000)).toBe(140);
  });

  it('过阈值才成立，方向由 dx 符号决定', () => {
    expect(resolveSwipe({ dx: -100, dy: 4, dtMs: 400, width: 390 })).toBe('left');
    expect(resolveSwipe({ dx: 100, dy: 4, dtMs: 400, width: 390 })).toBe('right');
    expect(resolveSwipe({ dx: -40, dy: 2, dtMs: 400, width: 390 })).toBe('cancel');
  });

  it('快速一甩过半程也成立；慢慢挪半程不成立', () => {
    // 阈值 85.8 → 半程 43；50px 用 60ms 甩出去（0.83px/ms）
    expect(resolveSwipe({ dx: 50, dy: 0, dtMs: 60, width: 390 })).toBe('right');
    expect(resolveSwipe({ dx: 50, dy: 0, dtMs: 600, width: 390 })).toBe('cancel');
  });

  it('竖向意图判为取消，不和滚动抢', () => {
    expect(resolveSwipe({ dx: 30, dy: 120, dtMs: 200, width: 390 })).toBe('cancel');
    // 横向已经过阈值就算 dy 也大，仍然成立（用户明显在横滑）
    expect(resolveSwipe({ dx: 120, dy: 130, dtMs: 200, width: 390 })).toBe('right');
  });

  it('进度夹在 -1..1，跟手有阻尼与旋转，飞出超过容器宽度', () => {
    expect(swipeProgress(400, 390)).toBe(1);
    expect(swipeProgress(-400, 390)).toBe(-1);
    expect(swipeProgress(43, 390)).toBeCloseTo(0.5, 1);
    const drag = dragTransform(100, 390);
    expect(drag.x).toBeCloseTo(92, 0);
    expect(drag.rotateDeg).toBeGreaterThan(0);
    expect(dragTransform(-2000, 390).rotateDeg).toBe(-10);
    expect(flyOutTransform('left', 390).x).toBeLessThan(-390);
    expect(flyOutTransform('right', 390).rotateDeg).toBeGreaterThan(10);
  });

  it('闪卡：翻开 → 打分；没翻开 → 换牌；方向语义与键盘一致', () => {
    const right = { dx: 120, dy: 0, dtMs: 300, width: 390 };
    const left = { dx: -120, dy: 0, dtMs: 300, width: 390 };
    expect(resolveFlashcardSwipe(right, true)).toEqual({ kind: 'score', value: 'got' });
    expect(resolveFlashcardSwipe(left, true)).toEqual({ kind: 'score', value: 'missed' });
    expect(resolveFlashcardSwipe(left, false)).toEqual({ kind: 'nav', dir: 'next' });
    expect(resolveFlashcardSwipe(right, false)).toEqual({ kind: 'nav', dir: 'prev' });
    expect(resolveFlashcardSwipe({ dx: 10, dy: 0, dtMs: 300, width: 390 }, true)).toEqual({ kind: 'cancel' });
  });
});
