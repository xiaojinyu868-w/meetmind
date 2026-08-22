/**
 * board-checkpoint — checkpoint 交互态状态机（纯逻辑，可单测）。
 *
 * 对齐 AmIWrite 的三阶段渐进放手：提问 → 等待学生 → 逐级提示（3 级 hint
 * ladder）→ 看解析示范。三个出口：
 *   - 我会了：跳过剩余 hint 和示范，直接念答案
 *   - 给我提示：按序揭示 hints[0..2]，第三级给完后该按钮让位给「看解析」
 *   - 看解析：念答案 + 串行执行 demoActions（完整示范）
 */

export type CheckpointStage =
  | 'ask' // 提问口述 + 题目上板中
  | 'wait' // 等待学生（按钮：我会了 / 给我提示 / 看解析）
  | 'hint' // 某级 hint 揭示中（写上黑板 + 朗读）
  | 'answer' // 念答案解析（「我会了」直达 / 「看解析」伴随示范）
  | 'demo' // 完整示范执行中（demoActions 串行）
  | 'done'; // 本 checkpoint 结束，进入下一段

export interface CheckpointState {
  stage: CheckpointStage;
  /** 已揭示的 hint 级数（0-3） */
  hintsShown: number;
  /** 「看解析」路径：先念 answer 再 demo；「我会了」只念 answer */
  withDemo: boolean;
}

export type CheckpointEvent =
  | 'ask_done' // 提问口述完毕 → 等待
  | 'know' // 我会了
  | 'hint' // 给我提示
  | 'show_answer' // 看解析
  | 'hint_done' // 本轮 hint 揭示完毕
  | 'answer_done' // 答案念完
  | 'demo_done'; // 示范完毕

export const CHECKPOINT_INITIAL: CheckpointState = {
  stage: 'ask',
  hintsShown: 0,
  withDemo: false,
};

export function checkpointReducer(
  state: CheckpointState,
  event: CheckpointEvent,
): CheckpointState {
  switch (state.stage) {
    case 'ask':
      return event === 'ask_done' ? { ...state, stage: 'wait' } : state;

    case 'wait':
      if (event === 'know') return { ...state, stage: 'answer', withDemo: false };
      if (event === 'show_answer') return { ...state, stage: 'answer', withDemo: true };
      if (event === 'hint' && state.hintsShown < 3) {
        return { ...state, stage: 'hint', hintsShown: state.hintsShown + 1 };
      }
      return state;

    case 'hint':
      return event === 'hint_done' ? { ...state, stage: 'wait' } : state;

    case 'answer':
      // 「看解析」：answer 念完接 demo；「我会了」：answer 念完直接收工
      if (event === 'answer_done') {
        return state.withDemo ? { ...state, stage: 'demo' } : { ...state, stage: 'done' };
      }
      return state;

    case 'demo':
      return event === 'demo_done' ? { ...state, stage: 'done' } : state;

    case 'done':
      return state;
  }
}

/** 「给我提示」按钮是否还可用（3 级给完后让位给「看解析」）。 */
export function hintAvailable(state: CheckpointState): boolean {
  return state.stage === 'wait' && state.hintsShown < 3;
}

/** 等待态按钮组：hint 按钮在 3 级给完后隐藏（只剩 我会了 / 看解析）。 */
export function waitButtons(state: CheckpointState): Array<'know' | 'hint' | 'show_answer'> {
  const buttons: Array<'know' | 'hint' | 'show_answer'> = ['know'];
  if (state.hintsShown < 3) buttons.push('hint');
  buttons.push('show_answer');
  return buttons;
}
