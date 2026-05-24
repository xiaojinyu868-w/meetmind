import { describe, expect, it } from 'vitest';
import { toReviewCurrentTimeSec } from './desktop-video-review-layout-model';

describe('desktop video review layout model', () => {
  it('converts player milliseconds into tutor agent seconds', () => {
    expect(toReviewCurrentTimeSec(65_432)).toBe(65);
  });

  it('keeps invalid or negative player time from polluting tutor context', () => {
    expect(toReviewCurrentTimeSec(-1200)).toBe(0);
    expect(toReviewCurrentTimeSec(Number.NaN)).toBe(0);
  });
});
