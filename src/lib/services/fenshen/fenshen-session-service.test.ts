/**
 * 对话编排单测：emptyTurnAction 空轮静默重试判定（纯函数）。
 * 上下文物化（buildContextFiles / materializeLessonContext）的测试在
 * lesson-context-service.test.ts。
 */

import { describe, expect, it } from 'vitest';

import { emptyTurnAction } from './fenshen-session-service';

describe('emptyTurnAction（空轮静默重试判定）', () => {
  const fresh = { text: '问', codexThreadId: 'th_1', gotDelta: false, retried: false };

  it('completed 且零 delta 且未补过 → retry', () => {
    expect(emptyTurnAction(fresh, 'completed')).toBe('retry');
    expect(emptyTurnAction(fresh, undefined)).toBe('retry');
  });

  it('已收到 delta → complete（正常轮）', () => {
    expect(emptyTurnAction({ ...fresh, gotDelta: true }, 'completed')).toBe('complete');
  });

  it('已补过一枪 → complete（不无限重试）', () => {
    expect(emptyTurnAction({ ...fresh, retried: true }, 'completed')).toBe('complete');
  });

  it('interrupted 优先于重试（用户打断的空轮不补枪）', () => {
    expect(emptyTurnAction(fresh, 'interrupted')).toBe('interrupted');
  });

  it('无 pending（非对话轮）→ complete', () => {
    expect(emptyTurnAction(undefined, 'completed')).toBe('complete');
  });
});
