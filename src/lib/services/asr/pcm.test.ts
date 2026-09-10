import { describe, expect, it } from 'vitest';
import { floatToPcm16, frameDurationMs, quantizeSample } from './pcm';

describe('quantizeSample', () => {
  it('满幅与越界钳制', () => {
    expect(quantizeSample(1)).toBe(0x7fff);
    expect(quantizeSample(-1)).toBe(-0x8000);
    expect(quantizeSample(2)).toBe(0x7fff);
    expect(quantizeSample(-3)).toBe(-0x8000);
    expect(quantizeSample(0)).toBe(0);
  });
});

describe('floatToPcm16', () => {
  it('同频（16k）不重采样，长度不变', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1]);
    const out = floatToPcm16(input, 16_000);
    expect(out.length).toBe(4);
    expect(out[1]).toBe(Math.round(0.5 * 0x7fff));
    expect(out[2]).toBe(Math.round(-0.5 * 0x8000));
  });

  it('48k → 16k 长度缩为 1/3', () => {
    const input = new Float32Array(4800).fill(0.25);
    const out = floatToPcm16(input, 48_000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBe(Math.round(0.25 * 0x7fff));
  });

  it('44.1k → 16k 按比例取整', () => {
    const input = new Float32Array(4410);
    expect(floatToPcm16(input, 44_100).length).toBe(1600);
  });

  it('空帧', () => {
    expect(floatToPcm16(new Float32Array(0), 48_000).length).toBe(0);
  });
});

describe('frameDurationMs', () => {
  it('2048 @ 16k ≈ 128ms；@ 48k ≈ 42.7ms', () => {
    expect(frameDurationMs(2048, 16_000)).toBeCloseTo(128, 1);
    expect(frameDurationMs(2048, 48_000)).toBeCloseTo(42.67, 1);
    expect(frameDurationMs(2048, 0)).toBe(0);
  });
});
