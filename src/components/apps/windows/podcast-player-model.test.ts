import { describe, expect, it } from 'vitest';
import {
  formatClock,
  lineIndexForTime,
  nextRate,
  shouldResumeFollow,
  stepTime,
  timeAtPointer,
  timeForLine,
} from './podcast-player-model';

describe('podcast-player-model', () => {
  it('时间格式 m:ss，异常值给 0:00', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(287.9)).toBe('4:47');
    expect(formatClock(Number.NaN)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('指针位置 → 时间，夹在 0..duration', () => {
    const rect = { left: 100, width: 200 };
    expect(timeAtPointer(100, rect, 300)).toBe(0);
    expect(timeAtPointer(200, rect, 300)).toBe(150);
    expect(timeAtPointer(999, rect, 300)).toBe(300);
    expect(timeAtPointer(50, rect, 300)).toBe(0);
    expect(timeAtPointer(150, rect, Number.NaN)).toBe(0);
  });

  it('←→ 5 秒不越界；没有 duration 时只夹下界', () => {
    expect(stepTime(10, -5, 300)).toBe(5);
    expect(stepTime(2, -5, 300)).toBe(0);
    expect(stepTime(298, 5, 300)).toBe(300);
    expect(stepTime(10, 5, Number.NaN)).toBe(15);
  });

  it('倍速循环 1 → 1.25 → 1.5 → 2 → 1', () => {
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(1.5)).toBe(2);
    expect(nextRate(2)).toBe(1);
  });

  it('逐字稿按比例对齐：时间 ↔ 句号互逆', () => {
    expect(lineIndexForTime(0, 100, 10)).toBe(0);
    expect(lineIndexForTime(55, 100, 10)).toBe(5);
    expect(lineIndexForTime(100, 100, 10)).toBe(9);
    expect(lineIndexForTime(10, 100, 0)).toBe(-1);
    expect(timeForLine(5, 100, 10)).toBe(50);
    expect(lineIndexForTime(timeForLine(7, 287, 40), 287, 40)).toBe(7);
  });

  it('当前句回到视口中段时可恢复自动跟随', () => {
    expect(shouldResumeFollow(500, 300, 400)).toBe(true);
    expect(shouldResumeFollow(900, 300, 400)).toBe(false);
  });
});
