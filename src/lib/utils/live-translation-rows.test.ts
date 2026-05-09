import { describe, expect, it } from 'vitest';
import { buildLiveTranslationRows } from './live-translation-rows';

describe('buildLiveTranslationRows', () => {
  it('keeps recent final transcript rows stable instead of replacing them with interim text', () => {
    const rows = buildLiveTranslationRows({
      segments: [
        { id: 's1', text: 'Hello, hello.', startMs: 18000, endMs: 22000 },
        { id: 's2', text: 'I feel.', startMs: 32000, endMs: 35000 },
      ],
      interimText: 'Some of the hardest moments',
      maxFinalRows: 2,
    });

    expect(rows.map((row) => row.text)).toEqual(['Hello, hello.', 'I feel.']);
    expect(rows.some((row) => row.text.includes('hardest moments'))).toBe(false);
  });

  it('falls back to recentLines when segments are not available', () => {
    const rows = buildLiveTranslationRows({
      recentLines: [
        { id: 'r1', text: '第一句', startMs: 1000 },
        { id: 'r2', text: '第二句', startMs: 2000 },
        { id: 'r3', text: '第三句', startMs: 3000 },
      ],
      maxFinalRows: 2,
    });

    expect(rows).toEqual([
      { id: 'r2', text: '第二句', startMs: 2000 },
      { id: 'r3', text: '第三句', startMs: 3000 },
    ]);
  });

  it('filters empty text rows', () => {
    const rows = buildLiveTranslationRows({
      segments: [
        { id: 's1', text: '   ', startMs: 0, endMs: 1000 },
        { id: 's2', text: 'valid line', startMs: 1000, endMs: 2000 },
      ],
    });

    expect(rows).toEqual([{ id: 's2', text: 'valid line', startMs: 1000 }]);
  });
});
