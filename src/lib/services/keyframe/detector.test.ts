import { describe, expect, it } from 'vitest';
import { KeyframeDetector } from './detector';

// 构造距离可控的测试哈希：flip(n) = 低 n 位置 1（ES2017 target 不能用 BigInt 字面量）
function hashWithBits(n: number): bigint {
  return (BigInt(1) << BigInt(n)) - BigInt(1);
}
const SLIDE_A = BigInt(0);
const SLIDE_A_NOISY = hashWithBits(4); // 与 A 距离 4（≤ 去重阈值 6，同一页）
const SLIDE_B = hashWithBits(20); // 与 A 距离 20（> 切换阈值 12，新页）
const SLIDE_B_NOISY = SLIDE_B ^ hashWithBits(2); // 与 B 距离 2（稳定期内的轻微抖动）
const SLIDE_C = hashWithBits(40); // 与 A/B 都远

/** 以 1s 间隔喂同一画面 durationMs */
function feedStable(detector: KeyframeDetector, hash: bigint, startMs: number, durationMs: number) {
  const verdicts: string[] = [];
  for (let t = startMs; t < startMs + durationMs; t += 1000) {
    verdicts.push(detector.feed(hash, t));
  }
  return verdicts;
}

describe('KeyframeDetector', () => {
  it('画面稳定超过 minStableMs 后产出一个关键帧，之后不再重复产出', () => {
    const detector = new KeyframeDetector({ minStableMs: 2500 });
    const verdicts = feedStable(detector, SLIDE_A, 0, 6000);
    expect(verdicts.filter((v) => v === 'keep')).toHaveLength(1);
    expect(detector.acceptedCount).toBe(1);
  });

  it('翻页后稳定 → 产出新关键帧', () => {
    const detector = new KeyframeDetector({ minStableMs: 2500 });
    feedStable(detector, SLIDE_A, 0, 4000); // A 结算
    feedStable(detector, SLIDE_B, 4000, 4000); // B 结算
    expect(detector.acceptedCount).toBe(2);
  });

  it('稳定期内的轻微抖动不打断结算', () => {
    const detector = new KeyframeDetector({ minStableMs: 2500 });
    detector.feed(SLIDE_B, 0);
    detector.feed(SLIDE_B_NOISY, 1000);
    detector.feed(SLIDE_B, 2000);
    const verdict = detector.feed(SLIDE_B_NOISY, 3000);
    expect(verdict).toBe('keep');
  });

  it('快速翻回旧页 → revisit，不产生重复关键帧', () => {
    const detector = new KeyframeDetector({ minStableMs: 2000 });
    feedStable(detector, SLIDE_A, 0, 4000); // A 结算为关键帧
    feedStable(detector, SLIDE_B, 4000, 3000); // B 结算为关键帧
    // 老师翻回 A 页（带噪声），稳定后应判 revisit
    const verdicts = feedStable(detector, SLIDE_A_NOISY, 7000, 4000);
    expect(verdicts).toContain('revisit');
    expect(detector.acceptedCount).toBe(2);
  });

  it('画面一闪而过（不足 minStableMs）不产生关键帧', () => {
    const detector = new KeyframeDetector({ minStableMs: 3000 });
    feedStable(detector, SLIDE_A, 0, 5000); // A 结算
    // B 只出现 1.5s 就切到 C
    detector.feed(SLIDE_B, 5000);
    detector.feed(SLIDE_B, 6000);
    feedStable(detector, SLIDE_C, 6500, 5000); // C 结算
    expect(detector.acceptedCount).toBe(2); // 只有 A 和 C
  });

  it('flush 强制结算最后一页（即使稳定期未满）', () => {
    const detector = new KeyframeDetector({ minStableMs: 10000 });
    detector.feed(SLIDE_A, 0);
    detector.feed(SLIDE_A, 1000);
    expect(detector.flush()).toBe('keep');
    expect(detector.flush()).toBe('drop'); // 已结算，不重复
  });

  it('开场首帧不立即成为关键帧', () => {
    const detector = new KeyframeDetector({ minStableMs: 2500 });
    expect(detector.feed(SLIDE_A, 0)).toBe('drop');
    expect(detector.acceptedCount).toBe(0);
  });
});
