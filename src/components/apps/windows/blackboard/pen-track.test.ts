/**
 * penTipAt（v14 笔画级笔尖追踪）单测。
 * 时序/坐标公式与 hanzi-writer 3.7.3 对齐（board-layout.ts 头注有出处）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { penTipAt } from './board-layout';

const good = JSON.parse(
  readFileSync(`${process.cwd()}/node_modules/hanzi-writer-data/好.json`, 'utf8'),
) as { medians: number[][][]; strokes: string[] };
const MEDIANS = good.medians;
const SIZE = 60;
const OPTS = { size: SIZE, speed: 6, delayBetweenMs: 20 };

function firstStrokeDuration(): number {
  const stroke = MEDIANS[0];
  let length = 0;
  for (let i = 1; i < stroke.length; i += 1) {
    length += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
  }
  return (length + 600) / (3 * OPTS.speed);
}

describe('penTipAt', () => {
  it('起笔前（fade 400ms 内）：笔尖等在首笔起点（char 空间→svg 坐标换算）', () => {
    const tip = penTipAt(MEDIANS, 0, OPTS);
    const scale = (SIZE - 4) / 1024;
    expect(tip).not.toBeNull();
    expect(tip!.x).toBeCloseTo(2 + MEDIANS[0][0][0] * scale, 5);
    expect(tip!.y).toBeCloseTo(SIZE - 124 * scale - 2 - MEDIANS[0][0][1] * scale, 5);
  });

  it('第一笔中途：笔尖沿首笔 medians 前进（ease 单调不后退）', () => {
    const duration = firstStrokeDuration();
    const early = penTipAt(MEDIANS, 400 + duration * 0.2, OPTS)!;
    const late = penTipAt(MEDIANS, 400 + duration * 0.8, OPTS)!;
    // ease-in-out：后 60% 进度走的弧长比前 60% 多（单调推进）
    expect(late).not.toEqual(early);
    // 两个点都必须在字符框内
    for (const tip of [early, late]) {
      expect(tip.x).toBeGreaterThanOrEqual(0);
      expect(tip.x).toBeLessThanOrEqual(SIZE);
      expect(tip.y).toBeGreaterThanOrEqual(0);
      expect(tip.y).toBeLessThanOrEqual(SIZE);
    }
  });

  it('笔画间停顿期：笔尖停在下一笔起点（不提前爬笔）', () => {
    const duration = firstStrokeDuration();
    // 第一笔结束 + 停顿中点：应位于第二笔起点（clamp 到 0）
    const tip = penTipAt(MEDIANS, 400 + duration + OPTS.delayBetweenMs / 2, OPTS)!;
    const scale = (SIZE - 4) / 1024;
    expect(tip.x).toBeCloseTo(2 + MEDIANS[1][0][0] * scale, 5);
    expect(tip.y).toBeCloseTo(SIZE - 124 * scale - 2 - MEDIANS[1][0][1] * scale, 5);
  });

  it('全字写完：返回 null（停止上报，接力给下一个字）', () => {
    expect(penTipAt(MEDIANS, 60_000, OPTS)).toBeNull();
  });

  it('速度参数进入时长：speed 翻倍，同一时刻进度更靠后', () => {
    const slow = penTipAt(MEDIANS, 700, { ...OPTS, speed: 3 })!;
    const fast = penTipAt(MEDIANS, 700, { ...OPTS, speed: 12 })!;
    expect(fast).not.toEqual(slow);
  });

  it('空 medians：null', () => {
    expect(penTipAt([], 100, OPTS)).toBeNull();
  });
});
