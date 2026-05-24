import { describe, expect, it } from 'vitest';
import { DEMO_SEGMENTS } from '@/fixtures/demo-data';
import { selectDemoLiveSegments } from './DemoLessonLoader';

describe('selectDemoLiveSegments', () => {
  it('does not expose the full demo lesson at the start of an in-class demo', () => {
    expect(selectDemoLiveSegments(0)).toEqual([]);
    expect(selectDemoLiveSegments(10).length).toBeLessThan(DEMO_SEGMENTS.length);
  });

  it('reveals demo transcript progressively by elapsed seconds', () => {
    expect(selectDemoLiveSegments(7).map((s) => s.id)).toEqual(['s1']);
    expect(selectDemoLiveSegments(93).map((s) => s.id)).toEqual(DEMO_SEGMENTS.map((s) => s.id));
  });
});
