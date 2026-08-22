import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_INITIAL,
  checkpointReducer,
  hintAvailable,
  waitButtons,
} from './board-checkpoint';

describe('checkpoint 状态机', () => {
  it('「我会了」：跳过剩余 hint 和示范，念完答案直接收工', () => {
    let state = CHECKPOINT_INITIAL;
    expect(state.stage).toBe('ask');
    state = checkpointReducer(state, 'ask_done');
    expect(state.stage).toBe('wait');
    state = checkpointReducer(state, 'know');
    expect(state).toEqual({ stage: 'answer', hintsShown: 0, withDemo: false });
    state = checkpointReducer(state, 'answer_done');
    expect(state.stage).toBe('done');
  });

  it('「给我提示」：3 级递进，第三级后 hint 按钮让位给「看解析」', () => {
    let state = checkpointReducer(CHECKPOINT_INITIAL, 'ask_done');
    expect(waitButtons(state)).toEqual(['know', 'hint', 'show_answer']);

    state = checkpointReducer(state, 'hint');
    expect(state).toEqual({ stage: 'hint', hintsShown: 1, withDemo: false });
    state = checkpointReducer(state, 'hint_done');
    state = checkpointReducer(state, 'hint');
    state = checkpointReducer(state, 'hint_done');
    expect(state.hintsShown).toBe(2);
    expect(hintAvailable(state)).toBe(true);

    state = checkpointReducer(state, 'hint');
    state = checkpointReducer(state, 'hint_done');
    expect(state.hintsShown).toBe(3);
    expect(hintAvailable(state)).toBe(false);
    expect(waitButtons(state)).toEqual(['know', 'show_answer']);
    // 第 4 次 hint 被拒绝
    expect(checkpointReducer(state, 'hint').hintsShown).toBe(3);
  });

  it('「看解析」：念答案 → 完整示范 → 收工', () => {
    let state = checkpointReducer(CHECKPOINT_INITIAL, 'ask_done');
    state = checkpointReducer(state, 'show_answer');
    expect(state).toEqual({ stage: 'answer', hintsShown: 0, withDemo: true });
    state = checkpointReducer(state, 'answer_done');
    expect(state.stage).toBe('demo');
    state = checkpointReducer(state, 'demo_done');
    expect(state.stage).toBe('done');
  });

  it('提示两级后「看解析」仍走完整示范', () => {
    let state = checkpointReducer(CHECKPOINT_INITIAL, 'ask_done');
    state = checkpointReducer(state, 'hint');
    state = checkpointReducer(state, 'hint_done');
    state = checkpointReducer(state, 'hint');
    state = checkpointReducer(state, 'hint_done');
    state = checkpointReducer(state, 'show_answer');
    expect(state).toEqual({ stage: 'answer', hintsShown: 2, withDemo: true });
    state = checkpointReducer(state, 'answer_done');
    expect(state.stage).toBe('demo');
  });

  it('非法事件不改变状态', () => {
    expect(checkpointReducer(CHECKPOINT_INITIAL, 'know').stage).toBe('ask');
    expect(checkpointReducer(CHECKPOINT_INITIAL, 'demo_done').stage).toBe('ask');
    const done = { stage: 'done' as const, hintsShown: 1, withDemo: false };
    expect(checkpointReducer(done, 'hint')).toEqual(done);
  });
});
