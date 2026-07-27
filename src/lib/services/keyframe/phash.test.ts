import { describe, expect, it } from 'vitest';
import { computePhash, hammingDistance, toGrayscale, PHASH_SIZE } from './phash';

const SIZE = PHASH_SIZE; // 32

/** 由像素函数生成 32x32 灰度图 */
function makeGray(fn: (x: number, y: number) => number): number[] {
  const gray: number[] = [];
  for (let x = 0; x < SIZE; x += 1) {
    for (let y = 0; y < SIZE; y += 1) {
      gray.push(fn(x, y));
    }
  }
  return gray;
}

describe('toGrayscale', () => {
  it('白色为 255，黑色为 0', () => {
    expect(toGrayscale([255, 255, 255, 255])).toEqual([255]);
    expect(toGrayscale([0, 0, 0, 255])).toEqual([0]);
  });

  it('按 Rec.601 加权（纯红 ≈ 76）', () => {
    expect(toGrayscale([255, 0, 0, 255])).toEqual([76]);
  });
});

describe('computePhash', () => {
  it('拒绝错误长度的输入', () => {
    expect(() => computePhash([1, 2, 3])).toThrow();
  });

  it('同一图像距离为 0', () => {
    const gray = makeGray((x, y) => (x < 16 ? 240 : 20) + (y % 3));
    const a = computePhash(gray);
    const b = computePhash(gray);
    expect(hammingDistance(a, b)).toBe(0);
  });

  it('整体亮度变化不影响哈希（DC 项被排除）', () => {
    const dark = makeGray((x) => (x < 16 ? 120 : 10));
    const bright = makeGray((x) => (x < 16 ? 220 : 110));
    expect(hammingDistance(computePhash(dark), computePhash(bright))).toBeLessThanOrEqual(4);
  });

  it('排版不同的幻灯片距离很大（仿真标题+要点版式）', () => {
    // 仿真真实幻灯片：标题条 + 文字行，翻页=要点推进/新增图块/版式变化
    const slideA = makeGray((x, y) => {
      if (y < 5) return 60;
      if (y >= 8 && y < 10 && x < 24) return 90;
      if (y >= 14 && y < 16 && x < 28) return 90;
      if (y >= 20 && y < 22 && x < 20) return 90;
      return 235;
    });
    const slideB = makeGray((x, y) => {
      if (y < 5) return 60;
      if (y >= 8 && y < 10 && x < 28) return 90;
      if (y >= 14 && y < 16 && x < 14) return 90;
      if (y >= 20 && y < 26 && x < 30) return 120;
      return 235;
    });
    expect(hammingDistance(computePhash(slideA), computePhash(slideB))).toBeGreaterThan(12);
  });

  it('内容相同加轻微噪声距离很小（抗压缩/抗抖动）', () => {
    const clean = makeGray((x) => (x < 16 ? 240 : 20));
    const noisy = makeGray((x, y) => ((x < 16 ? 240 : 20) + ((x * 7 + y * 13) % 11) - 5));
    expect(hammingDistance(computePhash(clean), computePhash(noisy))).toBeLessThanOrEqual(6);
  });
});

describe('hammingDistance', () => {
  it('基本性质', () => {
    expect(hammingDistance(BigInt(0), BigInt(0))).toBe(0);
    expect(hammingDistance(BigInt(0), BigInt(1))).toBe(1);
    expect(hammingDistance(BigInt(0), BigInt('0xffffffffffffffff'))).toBe(64);
  });
});
