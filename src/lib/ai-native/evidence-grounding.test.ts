import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { resolveGroundedEvidence } from './evidence-grounding';

const segments: TranscriptSegment[] = [
  { id: 's1', text: '机会成本是为了得到某个选择而放弃的最佳替代方案。', startMs: 0, endMs: 8_000, isFinal: true },
  { id: 's2', text: '边际成本描述额外生产一个单位所增加的成本。', startMs: 9_000, endMs: 18_000, isFinal: true },
];

describe('resolveGroundedEvidence', () => {
  it('prefers the segment that actually supports the claim', () => {
    const result = resolveGroundedEvidence('什么是机会成本？它是放弃的最佳替代方案。', segments, 12_000);
    expect(result.supported).toBe(true);
    expect(result.segment?.id).toBe('s1');
    expect(result.method).toBe('text');
  });

  it('does not turn a plausible timestamp into semantic evidence', () => {
    const result = resolveGroundedEvidence('量子纠缠为什么可以实现超光速通信？', segments, 12_000);
    expect(result.supported).toBe(false);
    expect(result.segment?.id).toBe('s2');
    expect(result.method).toBe('timestamp');
  });
});
