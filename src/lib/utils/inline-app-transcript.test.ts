import { describe, expect, it } from 'vitest';
import { hasEnoughInlineAppTranscript, selectInlineAppTranscript } from './inline-app-transcript';

const fresh = [
  { id: 'a', text: '这节课讲了混合注意力机制和 MCHC 的压缩方式。', startMs: 0, endMs: 8000 },
  { id: 'b', text: '老师还解释了 MoE 优化器怎样进一步降低推理成本。', startMs: 8000, endMs: 16000 },
];

describe('inline app transcript selection', () => {
  it('uses fresh store transcript when hook snapshot is stale', () => {
    expect(selectInlineAppTranscript([], fresh)).toEqual(fresh);
  });

  it('keeps primary transcript when it has enough content', () => {
    const primary = [
      { id: 'p1', text: 'primary '.repeat(10), startMs: 0, endMs: 5000 },
      { id: 'p2', text: 'content '.repeat(10), startMs: 5000, endMs: 10000 },
    ];
    expect(selectInlineAppTranscript(primary, fresh)).toEqual(primary);
  });

  it('requires enough segments and text before app generation', () => {
    expect(hasEnoughInlineAppTranscript(fresh)).toBe(true);
    expect(hasEnoughInlineAppTranscript([{ id: 'x', text: '太短', startMs: 0, endMs: 1000 }])).toBe(false);
  });
});
