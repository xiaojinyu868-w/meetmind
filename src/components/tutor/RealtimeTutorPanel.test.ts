import { describe, expect, it } from 'vitest';
import {
  buildRealtimeTutorContextLabel,
  buildRealtimeTutorInstructions,
  resolveRealtimeTutorHasContext,
} from './realtime-tutor-panel-model';
import type { Segment } from './tutor-types';

const segments: Segment[] = [
  { id: 's1', text: '老师先讲了函数的复合。', startMs: 0, endMs: 10_000 },
  { id: 's2', text: '接着讲到链式法则要从外层往里层求导。', startMs: 60_000, endMs: 70_000 },
  { id: 's3', text: '最后用一个例题说明变量替换。', startMs: 130_000, endMs: 140_000 },
];

describe('RealtimeTutorPanel helpers', () => {
  it('labels a concrete breakpoint as nearby context', () => {
    expect(buildRealtimeTutorContextLabel({
      breakpoint: { timestamp: 65_000 },
      preferSupportContext: false,
    })).toBe('01:05 附近');
  });

  it('labels selected support context before whole lesson when no breakpoint exists', () => {
    expect(buildRealtimeTutorContextLabel({
      breakpoint: null,
      preferSupportContext: true,
    })).toBe('已选内容');
  });

  it('detects support-only context so voice call is not disabled for selected material', () => {
    expect(resolveRealtimeTutorHasContext({ segments: [], supportContextText: '这是一段圈选资料' })).toBe(true);
    expect(resolveRealtimeTutorHasContext({ segments: [], supportContextText: '   ' })).toBe(false);
  });

  it('builds short spoken instructions with relevant lesson context', () => {
    const instructions = buildRealtimeTutorInstructions({
      breakpoint: { timestamp: 65_000 },
      segments,
      supportContextText: '',
      preferSupportContext: false,
    });

    expect(instructions).toContain('一次只推进一点');
    expect(instructions).toContain('具体片段');
    expect(instructions).toContain('链式法则');
    expect(instructions).not.toContain('最后用一个例题');
  });
});
