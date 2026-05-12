import { describe, expect, it } from 'vitest';
import { buildInlineAppFallbackPayload } from './inline-app-fallback';

const transcript = [
  { id: 's1', text: '老师讲到 Z 世代生活在信息密度很高的环境里，注意力容易被短视频和社交媒体切走。', startMs: 0, endMs: 8000 },
  { id: 's2', text: '老师用悬浮蜂鸟做比喻，说明年轻用户会在多个信息源之间快速切换。', startMs: 8000, endMs: 16000 },
  { id: 's3', text: '产品设计要降低启动成本，并在关键时刻给出即时反馈。', startMs: 16000, endMs: 24000 },
];

describe('buildInlineAppFallbackPayload', () => {
  it('builds usable flashcards when app execution fails', () => {
    const payload = buildInlineAppFallbackPayload('flashcards', transcript);
    expect(payload).toBeTruthy();
    expect((payload as { cards: unknown[] }).cards.length).toBeGreaterThan(0);
  });

  it('builds a compact cheatsheet when app execution fails', () => {
    const payload = buildInlineAppFallbackPayload('cheatsheet', transcript);
    expect(payload).toBeTruthy();
    expect((payload as { sections: unknown[] }).sections.length).toBeGreaterThan(0);
  });

  it('returns null when transcript is too thin', () => {
    expect(buildInlineAppFallbackPayload('flashcards', [])).toBeNull();
  });
});
