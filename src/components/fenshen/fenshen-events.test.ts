import { describe, expect, it } from 'vitest';
import {
  applyFenshenEvent,
  initialFenshenSessionState,
  replayFenshenEvents,
} from './fenshen-events';
import type { FenshenLogEvent } from './fenshen-events';

/** 确定性 id 序列（测试注入） */
function seqIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function applyAll(events: FenshenLogEvent[]) {
  return replayFenshenEvents(events, seqIds());
}

describe('applyFenshenEvent（单事件落地）', () => {
  it('text-delta 开 assistant 气泡并流式追加；turn 边界后新开气泡', () => {
    let state = initialFenshenSessionState();
    const ids = seqIds();
    state = applyFenshenEvent(state, { type: 'text-delta', text: '学而' }, ids);
    state = applyFenshenEvent(state, { type: 'text-delta', text: '时习之' }, ids);
    expect(state.messages).toEqual([{ id: 'id-1', role: 'assistant', text: '学而时习之' }]);
    expect(state.streaming).toBe(true);

    state = applyFenshenEvent(state, { type: 'turn-complete' }, ids);
    expect(state.streaming).toBe(false);
    state = applyFenshenEvent(state, { type: 'text-delta', text: '温故' }, ids);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].text).toBe('温故');
  });

  it('user-message 收束当前 assistant 气泡并落用户气泡', () => {
    let state = initialFenshenSessionState();
    const ids = seqIds();
    state = applyFenshenEvent(state, { type: 'text-delta', text: '讲一段' }, ids);
    state = applyFenshenEvent(state, { type: 'user-message', text: '不像' }, ids);
    // 用户消息后紧跟的 text-delta 必须开新气泡，而不是续在旧 assistant 上
    state = applyFenshenEvent(state, { type: 'text-delta', text: '再讲' }, ids);
    expect(state.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(state.messages[2].text).toBe('再讲');
  });

  it('distill-progress 追加账本条目；ego-ready 翻 ready；thread 是连接信号', () => {
    let state = initialFenshenSessionState();
    const ids = seqIds();
    state = applyFenshenEvent(state, { type: 'thread', threadId: 'ego-1' }, ids);
    expect(state).toEqual(initialFenshenSessionState());
    state = applyFenshenEvent(state, { type: 'distill-progress', note: '读到语料 3 篇' }, ids);
    state = applyFenshenEvent(state, { type: 'distill-progress', note: '整理讲解习惯' }, ids);
    expect(state.progress.map((p) => p.note)).toEqual(['读到语料 3 篇', '整理讲解习惯']);
    expect(state.ready).toBe(false);
    state = applyFenshenEvent(state, { type: 'ego-ready', skillPath: '/x/SKILL.md' }, ids);
    expect(state.ready).toBe(true);
  });

  it('interrupted 结束流式；error 落人可读错误并收束流式', () => {
    let state = initialFenshenSessionState();
    const ids = seqIds();
    state = applyFenshenEvent(state, { type: 'text-delta', text: '半截话' }, ids);
    state = applyFenshenEvent(state, { type: 'interrupted' }, ids);
    expect(state.streaming).toBe(false);
    expect(state.messages[0].text).toBe('半截话');

    state = applyFenshenEvent(state, { type: 'text-delta', text: '又在讲' }, ids);
    state = applyFenshenEvent(state, { type: 'error', message: '模型开小差' }, ids);
    expect(state.streaming).toBe(false);
    expect(state.error).toBe('模型开小差');
  });
});

describe('replayFenshenEvents（历史回放）', () => {
  it('按序重建完整对话 + 进度；回放末态不流式（崩溃中断的 turn 不再挂 typing）', () => {
    const state = applyAll([
      { type: 'distill-progress', note: '找到语料' },
      { type: 'ego-ready', skillPath: '/x' },
      { type: 'user-message', text: '讲讲最难的地方' },
      { type: 'text-delta', text: '先复习' },
      { type: 'text-delta', text: '再举例' },
      { type: 'turn-complete' },
      { type: 'user-message', text: '不像他' },
      { type: 'text-delta', text: '被打断的半截' },
    ]);
    expect(state.ready).toBe(true);
    expect(state.streaming).toBe(false);
    expect(state.progress).toHaveLength(1);
    expect(state.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
      'user:讲讲最难的地方',
      'assistant:先复习再举例',
      'user:不像他',
      'assistant:被打断的半截',
    ]);
  });

  it('重放幂等：从 initialState 全量重放得到同一形状', () => {
    const events: FenshenLogEvent[] = [
      { type: 'text-delta', text: '甲' },
      { type: 'turn-complete' },
      { type: 'text-delta', text: '乙' },
    ];
    const first = applyAll(events);
    const second = applyAll(events);
    expect(second.messages.map((m) => [m.role, m.text])).toEqual(
      first.messages.map((m) => [m.role, m.text]),
    );
  });
});
