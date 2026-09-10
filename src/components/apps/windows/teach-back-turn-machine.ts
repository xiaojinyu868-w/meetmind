/**
 * teach-back-turn-machine — 「讲给同桌听」连续讲述的回合状态机（纯函数，零依赖）。
 *
 * 像语音通话一样：麦克风常开，你讲、你停、评委开口、你一开口评委就停。
 * 谁来判定"这一段讲完了"？——能量 VAD + 实时 ASR 的句末事件一起判：
 *
 *   calibrating ─1s─▶ listening ─有声≥attack─▶ speaking ─无声─▶ pausing
 *        ▲                ▲                        ▲              │
 *        │                │(语音太短，带着已说的继续等)              │静音 ≥ endSilence 且 有效语音 ≥ minSpeech
 *        │                └──────────────────────┼──────────────┘
 *        │                                        │
 *        │            settling（等 ASR 把最后一句定稿，≤ settleMs）
 *        │                │ turn-commit
 *        │            judging（评委在想：请求在飞）──judge-open──▶ judge-speaking
 *        │                │                                      │
 *        │                │ 你一开口 → interrupt                   │ judge-close
 *        │                └──────────────▶ speaking ◀────────────┘
 *        └──────── judge-close ────────── listening
 *
 * 阈值全部是参数（默认值见 DEFAULT_TURN_PARAMS），Vitest 覆盖阈值与插话；
 * hook（use-teach-back-panel.ts）只负责把麦克风帧 / ASR 事件 / SSE 事件喂进来并执行 effects。
 *
 * 为什么用 reducer + effects 而不是类：状态与副作用分离，测试不需要伪造 AudioContext；
 * 时间全部由事件携带（`at`），不读 Date.now()。
 */

export type TurnPhase =
  | 'calibrating'
  | 'listening'
  | 'speaking'
  | 'pausing'
  | 'settling'
  | 'judging'
  | 'judge-speaking';

export interface TurnParams {
  /** 开麦后校准环境噪声的时长 */
  calibrationMs: number;
  /** 一个回合至少要有这么多有效语音，停下来才算"讲完一段"（否则带着已说的继续等） */
  minSpeechMs: number;
  /** 静音持续多久判定回合结束 */
  endSilenceMs: number;
  /** ASR 句末定稿已到、且静音已持续这么久 → 提前结束回合（不必等满 endSilenceMs） */
  finalShortcutSilenceMs: number;
  /** 回合结束后等 ASR 把最后一句定稿的最长时间；interim 为空则不等 */
  settleMs: number;
  /** 进入 speaking 需要的连续有声时长（防瞬时噼啪；按时长不按帧数——采样率不同一帧 43~128ms 不等） */
  attackMs: number;
  /** 评委发言中打断需要的连续有声时长（比 attackMs 高：扬声器回声要过 AEC，宁可晚 200ms 也别自己打断自己） */
  interruptAttackMs: number;
  /** 说话中的短促停顿（词间、换气）不算停下：无声持续这么久才进入 pausing，画面才不会在"你在讲 / 等你说完"之间抖 */
  pauseHangoverMs: number;
  /** 有声阈值 = max(minVoiceRms, noiseFloor × noiseMultiplier) */
  minVoiceRms: number;
  noiseMultiplier: number;
  /** 评委发言中的阈值再乘这个系数（回声通常比真人说话弱） */
  interruptMultiplier: number;
  /** 噪声地板的上下限（校准期间有人说话也不至于把阈值抬到听不见） */
  noiseFloorMin: number;
  noiseFloorMax: number;
  /** 讲过至少一段后，长时间没人说话 → 评委问一句要不要先到这（只问一次） */
  idleNudgeMs: number;
}

export const DEFAULT_TURN_PARAMS: TurnParams = {
  calibrationMs: 1000,
  minSpeechMs: 1500,
  endSilenceMs: 1200,
  finalShortcutSilenceMs: 500,
  settleMs: 700,
  attackMs: 200,
  interruptAttackMs: 400,
  // 650ms：真人句内换气、词间停顿多在 600ms 以内；超过才把画面切到「等你说完」
  pauseHangoverMs: 650,
  minVoiceRms: 0.012,
  noiseMultiplier: 3,
  interruptMultiplier: 1.6,
  noiseFloorMin: 0.002,
  // 上限压到 0.02：校准窗口里全是说话声时阈值最多抬到 0.06，正常音量（RMS 0.05~0.15）仍能过门
  noiseFloorMax: 0.02,
  idleNudgeMs: 40_000,
};

export type TurnEvent =
  | { type: 'frame'; rms: number; at: number; durationMs: number }
  | { type: 'asr-interim'; text: string; at: number }
  | { type: 'asr-final'; text: string; at: number }
  | { type: 'tick'; at: number }
  /** 评委第一段文字到了（开口） */
  | { type: 'judge-open'; at: number }
  /** 评委说完 / 保持沉默 / 请求失败 / 被中止 —— 都回到听讲 */
  | { type: 'judge-close'; at: number }
  /** 打字讲的一段（麦克风不可用时的兜底）：和语音一样走提交 */
  | { type: 'typed'; text: string; at: number }
  | { type: 'finish'; at: number };

export type TurnEffect =
  /** 一段讲完了：把这段文字交给评委席 */
  | { type: 'turn-commit'; text: string; turnIndex: number }
  /** 提交后 ASR 才把最后一句定稿：把已提交这段的文字升级成定稿版 */
  | { type: 'turn-upgrade'; text: string; turnIndex: number }
  /** 你开口了：评委立刻闭嘴（TTS 停、气泡收、在飞的请求中止） */
  | { type: 'interrupt' }
  /** 很久没人说话：评委问一句要不要先到这 */
  | { type: 'idle-nudge' }
  /** 讲完了：带上还没提交的文字 */
  | { type: 'finish'; text: string };

export interface TurnMachineState {
  phase: TurnPhase;
  params: TurnParams;
  noiseFloor: number;
  calibrationStartedAt: number | null;
  calibrationRms: number[];
  /** 本回合累计有效语音时长 */
  voicedMs: number;
  /** 连续有声时长（ms），无声帧归零 */
  voicedStreak: number;
  /** 最后一次有声帧的时间 */
  lastVoiceAt: number | null;
  /** 本回合已定稿的句子 */
  finals: string[];
  /** 本回合尚未定稿的 interim 文本 */
  interim: string;
  settleStartedAt: number | null;
  /** 已提交的回合数（也是下一回合的 index） */
  turnIndex: number;
  /** 最近一次提交的文本（供迟到的定稿升级） */
  lastCommitted: { text: string; turnIndex: number } | null;
  /** 最后一次有人（你或评委）活动的时间，供 idle nudge */
  lastActivityAt: number | null;
  nudged: boolean;
  /** 0~1 的即时音量，供波形 */
  level: number;
}

export function createTurnMachine(params: Partial<TurnParams> = {}): TurnMachineState {
  return {
    phase: 'calibrating',
    params: { ...DEFAULT_TURN_PARAMS, ...params },
    noiseFloor: DEFAULT_TURN_PARAMS.noiseFloorMin,
    calibrationStartedAt: null,
    calibrationRms: [],
    voicedMs: 0,
    voicedStreak: 0,
    lastVoiceAt: null,
    finals: [],
    interim: '',
    settleStartedAt: null,
    turnIndex: 0,
    lastCommitted: null,
    lastActivityAt: null,
    nudged: false,
    level: 0,
  };
}

export interface TurnStep {
  state: TurnMachineState;
  effects: TurnEffect[];
}

/** 有声阈值（评委发言中更高，防扬声器回声把评委自己打断） */
export function voiceThreshold(state: TurnMachineState): number {
  const { params } = state;
  const base = Math.max(params.minVoiceRms, state.noiseFloor * params.noiseMultiplier);
  return state.phase === 'judge-speaking' || state.phase === 'judging' ? base * params.interruptMultiplier : base;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, '').replace(/[，。！？；、,.!?;:：]/g, '');
}

/** 回合文本 = 已定稿句子 + 尚未定稿的尾巴 */
export function pendingText(state: TurnMachineState): string {
  return [...state.finals, state.interim].map((part) => part.trim()).filter(Boolean).join('');
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index];
}

/** 校准：取校准窗口内最安静的那部分（10 分位）当噪声地板——用户一上台就开讲也不至于把阈值抬到听不见 */
function finishCalibration(state: TurnMachineState, at: number): TurnMachineState {
  const floor = clamp(percentile(state.calibrationRms, 0.1), state.params.noiseFloorMin, state.params.noiseFloorMax);
  return { ...state, phase: 'listening', noiseFloor: floor, calibrationRms: [], lastActivityAt: at };
}

function resetTurnBuffer(state: TurnMachineState): TurnMachineState {
  return { ...state, voicedMs: 0, finals: [], interim: '', settleStartedAt: null };
}

function commitTurn(state: TurnMachineState, at: number): TurnStep {
  const text = pendingText(state);
  const turnIndex = state.turnIndex;
  const next: TurnMachineState = {
    ...resetTurnBuffer(state),
    phase: 'judging',
    turnIndex: turnIndex + 1,
    lastCommitted: { text, turnIndex },
    lastActivityAt: at,
    voicedStreak: 0,
  };
  if (!text) {
    // 能量说你讲了、ASR 一个字没认出来（对着麦克风哼、噪声）：不惊动评委，回到听讲
    return { state: { ...next, phase: 'listening', lastCommitted: state.lastCommitted, turnIndex }, effects: [] };
  }
  return { state: next, effects: [{ type: 'turn-commit', text, turnIndex }] };
}

function handleFrame(state: TurnMachineState, event: { rms: number; at: number; durationMs: number }): TurnStep {
  const { params } = state;
  const effects: TurnEffect[] = [];

  if (state.phase === 'calibrating') {
    const startedAt = state.calibrationStartedAt ?? event.at;
    const collected = { ...state, calibrationStartedAt: startedAt, calibrationRms: [...state.calibrationRms, event.rms], level: 0 };
    if (event.at - startedAt >= params.calibrationMs) {
      return { state: finishCalibration(collected, event.at), effects };
    }
    return { state: collected, effects };
  }

  const threshold = voiceThreshold(state);
  const voiced = event.rms >= threshold;
  const level = clamp((event.rms - state.noiseFloor) / Math.max(threshold * 4, 1e-6), 0, 1);
  const inJudge = state.phase === 'judging' || state.phase === 'judge-speaking';
  let next: TurnMachineState = { ...state, level };

  if (voiced) {
    const streak = state.voicedStreak + event.durationMs;
    const attack = inJudge ? params.interruptAttackMs : params.attackMs;
    next = { ...next, voicedStreak: streak };
    // 有效语音按帧累计（评委发言期间的声音要先过打断门槛才算你的）
    if (!inJudge) next.voicedMs = state.voicedMs + event.durationMs;
    if (streak >= attack) {
      next = { ...next, lastVoiceAt: event.at, lastActivityAt: event.at, nudged: false };
      if (inJudge) {
        // 你开口了：评委闭嘴，回到"你在讲"
        effects.push({ type: 'interrupt' });
        next = { ...resetTurnBuffer(next), phase: 'speaking', voicedMs: streak };
      } else if (state.phase === 'settling') {
        // 还没来得及提交你又接着讲：这一段继续算同一个回合
        next = { ...next, phase: 'speaking', settleStartedAt: null };
      } else if (state.phase !== 'speaking') {
        next = { ...next, phase: 'speaking' };
      }
    }
    return { state: next, effects };
  }

  // 无声帧
  next = { ...next, voicedStreak: 0 };
  if (state.phase === 'listening' || state.phase === 'pausing') {
    // 噪声地板跟随安静时的能量：向下跟得快（校准时用户已在开讲，地板被抬高，几帧安静就该回来），向上跟得慢
    const followed = event.rms < state.noiseFloor
      ? state.noiseFloor * 0.6 + event.rms * 0.4
      : state.noiseFloor * 0.98 + event.rms * 0.02;
    next.noiseFloor = clamp(followed, params.noiseFloorMin, params.noiseFloorMax);
  }
  return evaluateSilence(next, event.at, effects);
}

/** 静音判定（frame 无声 / tick 都会走到这里） */
function evaluateSilence(state: TurnMachineState, at: number, effects: TurnEffect[]): TurnStep {
  const { params } = state;
  if (state.phase === 'speaking') {
    // 词间换气不算停：无声过了 hangover 才算"停下来了"
    const silence = state.lastVoiceAt === null ? Number.POSITIVE_INFINITY : at - state.lastVoiceAt;
    if (silence < params.pauseHangoverMs) return { state, effects };
    return evaluateSilence({ ...state, phase: 'pausing' }, at, effects);
  }
  if (state.phase === 'pausing') {
    const silence = state.lastVoiceAt === null ? Number.POSITIVE_INFINITY : at - state.lastVoiceAt;
    if (silence >= params.endSilenceMs) {
      if (state.voicedMs < params.minSpeechMs) {
        // 讲得太短：不算一个回合，带着已说的继续听
        return { state: { ...state, phase: 'listening' }, effects };
      }
      if (state.interim.trim()) {
        return { state: { ...state, phase: 'settling', settleStartedAt: at }, effects };
      }
      const committed = commitTurn(state, at);
      return { state: committed.state, effects: [...effects, ...committed.effects] };
    }
    return { state, effects };
  }
  if (state.phase === 'settling') {
    const waited = state.settleStartedAt === null ? Number.POSITIVE_INFINITY : at - state.settleStartedAt;
    if (waited >= params.settleMs) {
      const committed = commitTurn(state, at);
      return { state: committed.state, effects: [...effects, ...committed.effects] };
    }
    return { state, effects };
  }
  if (state.phase === 'listening' && state.turnIndex > 0 && !state.nudged && state.lastActivityAt !== null) {
    if (at - state.lastActivityAt >= params.idleNudgeMs) {
      // 评委要开口问一句：进 judging，这样你一开口同样能打断、回声同样被挡
      return {
        state: { ...state, phase: 'judging', nudged: true, lastActivityAt: at, voicedStreak: 0 },
        effects: [...effects, { type: 'idle-nudge' }],
      };
    }
  }
  return { state, effects };
}

function handleAsrFinal(state: TurnMachineState, event: { text: string; at: number }): TurnStep {
  const text = event.text.trim();
  if (!text) return { state, effects: [] };
  if (state.phase === 'judging' || state.phase === 'judge-speaking') {
    // 提交后才到的定稿：如果是刚提交那段的完整版，就把它升级；其余（评委的回声）丢掉
    const committed = state.lastCommitted;
    if (committed) {
      const a = normalizeText(committed.text);
      const b = normalizeText(text);
      if (b && (b.startsWith(a.slice(0, Math.max(2, Math.floor(a.length * 0.6)))) || a.includes(b))) {
        const upgraded = b.length > a.length ? text : committed.text;
        if (upgraded !== committed.text) {
          return {
            state: { ...state, lastCommitted: { text: upgraded, turnIndex: committed.turnIndex } },
            effects: [{ type: 'turn-upgrade', text: upgraded, turnIndex: committed.turnIndex }],
          };
        }
      }
    }
    return { state, effects: [] };
  }
  const next: TurnMachineState = {
    ...state,
    finals: [...state.finals, text],
    interim: '',
    lastActivityAt: event.at,
  };
  if (state.phase === 'settling') {
    // 等的就是这一句：立刻提交
    return commitTurn(next, event.at);
  }
  if (state.phase === 'pausing' && next.voicedMs >= state.params.minSpeechMs && next.lastVoiceAt !== null) {
    // ASR 自己已经判了句末（服务端静音 1s）：静音只要过了短捷径就直接结束回合
    if (event.at - next.lastVoiceAt >= state.params.finalShortcutSilenceMs) {
      return commitTurn(next, event.at);
    }
  }
  return { state: next, effects: [] };
}

function handleAsrInterim(state: TurnMachineState, event: { text: string; at: number }): TurnStep {
  if (state.phase === 'judging' || state.phase === 'judge-speaking' || state.phase === 'calibrating') {
    return { state, effects: [] };
  }
  return { state: { ...state, interim: event.text }, effects: [] };
}

export function reduceTurn(state: TurnMachineState, event: TurnEvent): TurnStep {
  switch (event.type) {
    case 'frame':
      return handleFrame(state, event);
    case 'tick':
      if (state.phase === 'calibrating' && state.calibrationStartedAt !== null
        && event.at - state.calibrationStartedAt >= state.params.calibrationMs) {
        return { state: finishCalibration(state, event.at), effects: [] };
      }
      return evaluateSilence(state, event.at, []);
    case 'asr-interim':
      return handleAsrInterim(state, event);
    case 'asr-final':
      return handleAsrFinal(state, event);
    case 'judge-open':
      if (state.phase !== 'judging') return { state, effects: [] };
      return { state: { ...state, phase: 'judge-speaking', lastActivityAt: event.at, voicedStreak: 0 }, effects: [] };
    case 'judge-close':
      if (state.phase !== 'judging' && state.phase !== 'judge-speaking') return { state, effects: [] };
      return {
        state: { ...state, phase: 'listening', lastActivityAt: event.at, voicedStreak: 0, level: 0 },
        effects: [],
      };
    case 'typed': {
      const typed = event.text.trim();
      if (!typed) return { state, effects: [] };
      const effects: TurnEffect[] = [];
      let base = state;
      if (state.phase === 'judging' || state.phase === 'judge-speaking') {
        effects.push({ type: 'interrupt' });
        base = resetTurnBuffer(state);
      }
      const withText: TurnMachineState = {
        ...base,
        phase: 'pausing',
        finals: [...base.finals, base.interim, typed].filter((part) => part.trim()),
        interim: '',
      };
      const committed = commitTurn(withText, event.at);
      return { state: committed.state, effects: [...effects, ...committed.effects] };
    }
    case 'finish': {
      const text = pendingText(state);
      const effects: TurnEffect[] = [];
      if (state.phase === 'judging' || state.phase === 'judge-speaking') effects.push({ type: 'interrupt' });
      effects.push({ type: 'finish', text });
      return { state: { ...resetTurnBuffer(state), phase: 'listening', level: 0 }, effects };
    }
    default:
      return { state, effects: [] };
  }
}

/** 画面读得出来的四种状态（详见 TeachBackPodium）：听讲中 / 你在讲 / 停顿等待 / 评委发言 */
export type StageMood = 'listening' | 'speaking' | 'pausing' | 'judge';

export function stageMoodOf(phase: TurnPhase): StageMood {
  switch (phase) {
    case 'speaking':
      return 'speaking';
    case 'pausing':
    case 'settling':
    case 'judging':
      return 'pausing';
    case 'judge-speaking':
      return 'judge';
    default:
      return 'listening';
  }
}
