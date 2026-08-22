import { describe, expect, it } from 'vitest';
import { assessAsrCoverage } from './video-import-asr-check';
import {
  MIN_TEXT_COVERAGE_RATIO,
  MIN_TIMELINE_COVERAGE_LONG,
  MIN_TIMELINE_COVERAGE_SHORT,
} from './video-import-types';

function buildData(text: string, lastEndMs: number) {
  return {
    success: true,
    text,
    segments: [{ id: 'seg-0', text, startMs: 0, endMs: lastEndMs }],
  };
}

describe('assessAsrCoverage', () => {
  it('passes a sufficient result', () => {
    const durationSec = 300;
    const text = '字'.repeat(Math.ceil(durationSec * MIN_TEXT_COVERAGE_RATIO) + 50);
    const result = assessAsrCoverage(buildData(text, durationSec * 1000), durationSec);
    expect(result.insufficient).toBe(false);
    expect(result.timelineCoverage).toBeCloseTo(1);
  });

  it('flags text shortage for long audio', () => {
    const result = assessAsrCoverage(buildData('太短', 300_000), 300);
    // textLen > 0 but far below expected minimum
    expect(result.insufficient).toBe(true);
  });

  it('flags timeline shortage below the short-audio threshold', () => {
    const durationSec = 100; // <=120s → short threshold
    const text = '字'.repeat(200); // text 充足，隔离时间线维度
    const lastEndMs = Math.floor(durationSec * 1000 * (MIN_TIMELINE_COVERAGE_SHORT - 0.1));
    const result = assessAsrCoverage(buildData(text, lastEndMs), durationSec);
    expect(result.insufficient).toBe(true);
    expect(result.timelineCoverage).toBeLessThan(MIN_TIMELINE_COVERAGE_SHORT);
  });

  it('uses the stricter long-audio timeline threshold above 120s', () => {
    const durationSec = 600;
    const text = '字'.repeat(2000);
    const betweenMs = Math.floor(durationSec * 1000 * ((MIN_TIMELINE_COVERAGE_SHORT + MIN_TIMELINE_COVERAGE_LONG) / 2));
    const result = assessAsrCoverage(buildData(text, betweenMs), durationSec);
    expect(result.insufficient).toBe(true);
  });

  it('skips checks for short audio and empty text', () => {
    expect(assessAsrCoverage(buildData('x', 1000), 30).insufficient).toBe(false);
    expect(assessAsrCoverage(buildData('', 0), 300).insufficient).toBe(false);
    expect(assessAsrCoverage(buildData('x', 1000), undefined).insufficient).toBe(false);
  });

  it('reports timelineCoverage=n/a when segments carry no timeline', () => {
    const result = assessAsrCoverage(buildData('字'.repeat(500), 0), 300);
    expect(result.timelineCoverage).toBeNull();
    expect(result.timelineDetail).toContain('n/a');
  });
});
