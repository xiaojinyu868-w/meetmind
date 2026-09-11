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
 *        │            settling（ASR 一个字还没给：再等 ≤ settleMs 让它追上来）
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
 *
 * v2（2026-09-11，像通话）：回合判定从"等 ASR 定稿（1.2s 静音 + 0.7s settle）"改成"0.9s 静音就拿手上的 interim 提交，
 * 定稿到得快走 0.5s 捷径先到先提交，迟到的定稿用 turn-upgrade 替换已提交的尾巴"。
 * 误判换气比慢更糟，所以尾巴像没说完（逗号 / 连词 / 语气词收尾，见 looksUnfinished）时多等到 1.4s。
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
  /** 尾巴像没说完（looksUnfinished）时的静音门槛：宁可多等半秒，也别把换气 / 想词当成讲完 */
  endSilenceUnfinishedMs: number;
  /** ASR 句末定稿已到、且静音已持续这么久 → 提前结束回合（不必等满 endSilenceMs；尾巴像没说完时不走捷径） */
  finalShortcutSilenceMs: number;
  /** 静音到点时 ASR 一个字都还没给：再等这么久让它追上来（一到就提交），到点还没有才当噪声不惊动评委 */
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
  // 1200：讲述样本原始音频里句内停顿最长 660ms，但经过浏览器采集链（AEC / AGC / NS）后客户端能量 VAD 看到的
  // 句内停顿是 670~1070ms、偶有 1130ms（pause-resume 打点，见 windows/DOMAIN.md）；900 实测 15 段里 2 次假回合。
  // 延迟不靠压这个数：进 pausing（650ms）就预热评委请求（turn-prefetch），模型首字要 0.6~2s，
  // 只要首字比"到点"晚，这个门槛定多少都不影响出字时刻——所以取回不误判的 1200。
  // 到点就拿 interim 提交：qwen-audio-3.0 流式 ASR 在停下那一刻 interim 已是整句，定稿却要 1.2~1.4s 才到
  // （max_sentence_silence 500 / 1000 实测无差别），等它只换来句末标点——迟到的定稿走 turn-upgrade 补上
  endSilenceMs: 1200,
  endSilenceUnfinishedMs: 1700,
  finalShortcutSilenceMs: 500,
  // ASR 一个字都没给时才等：再给 250ms 追上来，还没有就当噪声
  settleMs: 250,
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
  /**
   * 你停下来了（过了 hangover，还没到讲完的门槛）：拿手上的文字先把评委请求发出去、但不上屏——
   * 到点 turn-commit 时文字没变就直接接上（模型已经想了几百毫秒），你接着讲则 turn-prefetch-cancel 中止
   */
  | { type: 'turn-prefetch'; text: string; turnIndex: number }
  | { type: 'turn-prefetch-cancel'; turnIndex: number }
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
  /** 最近一次提交的文本（供迟到的定稿升级）：finals 是提交时已定稿的句子，interim 是当时还没定稿的尾巴 */
  lastCommitted: { text: string; turnIndex: number; finals: string[]; interim: string } | null;
  /** 最后一次有人（你或评委）活动的时间，供 idle nudge */
  lastActivityAt: number | null;
  nudged: boolean;
  /** 0~1 的即时音量，供波形 */
  level: number;
  /** 这次停顿已经预热过评委请求（进 pausing 时发的），提交 / 接着讲时要对上号 */
  prefetching: boolean;
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
    prefetching: false,
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

/**
 * 尾巴像没说完：逗号 / 顿号 / 冒号收尾，或以连词 / 语气词 / 介词收尾（"然后""就是""因为""嗯""和""把"……）。
 * 只看最后几个字——这是"要不要多等半秒"的判断，不是句法分析；判错的代价是多等 500ms，判漏的代价是把换气当讲完。
 * 句号 / 问号 / 叹号收尾、或以实词收尾 → 不算没说完（false），走基础门槛。
 * 单字词只收基本不会做句尾的（"存在""重要""映像""得到"这类以 在 / 要 / 像 / 到 收尾的实词在数学课上太常见，不收）。
 */
const UNFINISHED_TAIL = new RegExp(
  '(?:[，、,:：]|'
  + '(?:然后|就是说|也就是说|换句话说|就是|所以|因为|但是|不过|那么|比如说|比如|或者|如果|而且|并且|其实|这个|那个|的话|等于|叫做|叫'
  + '|嗯|呃|额|啊|哦|诶'
  + '|和|跟|把|就|又|再|也|还|都|从|给|让|使|被|与|及|或|而|是))$',
);

export function looksUnfinished(text: string): boolean {
  const tail = text.trim();
  if (!tail) return false;
  return UNFINISHED_TAIL.test(tail);
}

/**
 * 预热时拿的文字能不能顶替提交时的文字：提交文字以它开头、多出来的不超过 6 个字（一般是句末标点 / 最后一个词）。
 * 差得多就说明停顿里 ASR 又补了一截，评委得针对完整版重新想。
 */
export function prefetchCovers(prefetchText: string, committedText: string): boolean {
  const a = normalizeText(prefetchText);
  const b = normalizeText(committedText);
  if (!a || !b) return false;
  return b.startsWith(a) && b.length - a.length <= 6;
}

/** 这一刻算"讲完了"需要的静音时长 */
function endSilenceFor(state: TurnMachineState): number {
  return looksUnfinished(pendingText(state)) ? state.params.endSilenceUnfinishedMs : state.params.endSilenceMs;
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
  return { ...state, voicedMs: 0, finals: [], interim: '', settleStartedAt: null, prefetching: false };
}

/** 接着讲了：预热中的评委请求作废 */
function cancelPrefetch(state: TurnMachineState, effects: TurnEffect[]): TurnMachineState {
  if (!state.prefetching) return state;
  effects.push({ type: 'turn-prefetch-cancel', turnIndex: state.turnIndex });
  return { ...state, prefetching: false };
}

function commitTurn(state: TurnMachineState, at: number): TurnStep {
  const text = pendingText(state);
  const turnIndex = state.turnIndex;
  const next: TurnMachineState = {
    ...resetTurnBuffer(state),
    phase: 'judging',
    turnIndex: turnIndex + 1,
    lastCommitted: {
      text,
      turnIndex,
      finals: state.finals.map((part) => part.trim()).filter(Boolean),
      interim: state.interim.trim(),
    },
    lastActivityAt: at,
    voicedStreak: 0,
  };
  if (!text) {
    // 能量说你讲了、ASR 一个字没认出来（对着麦克风哼、噪声）：不惊动评委，回到听讲
    const effects: TurnEffect[] = [];
    cancelPrefetch(state, effects);
    return { state: { ...next, phase: 'listening', lastCommitted: state.lastCommitted, turnIndex }, effects };
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
      } else if (state.phase === 'settling' || state.phase === 'pausing') {
        // 还没来得及提交你又接着讲：这一段继续算同一个回合，预热的请求作废
        next = { ...cancelPrefetch(next, effects), phase: 'speaking', settleStartedAt: null };
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
    // 停下来了：讲得够长、手上有字，就先把评委请求预热起来（不上屏）——到点提交时模型已经想了 450ms
    let paused: TurnMachineState = { ...state, phase: 'pausing' };
    const text = pendingText(state);
    if (!state.prefetching && state.voicedMs >= params.minSpeechMs && text) {
      effects.push({ type: 'turn-prefetch', text, turnIndex: state.turnIndex });
      paused = { ...paused, prefetching: true };
    }
    return evaluateSilence(paused, at, effects);
  }
  if (state.phase === 'pausing') {
    const silence = state.lastVoiceAt === null ? Number.POSITIVE_INFINITY : at - state.lastVoiceAt;
    if (silence >= endSilenceFor(state)) {
      if (state.voicedMs < params.minSpeechMs) {
        // 讲得太短：不算一个回合，带着已说的继续听
        return { state: { ...cancelPrefetch(state, effects), phase: 'listening' }, effects };
      }
      if (!pendingText(state)) {
        // ASR 一个字还没给（它比能量 VAD 慢半拍）：再等 settleMs，到点还没有才当噪声
        return { state: { ...state, phase: 'settling', settleStartedAt: at }, effects };
      }
      // 手上有字就提交——实测停下时 interim 已是整句（只差句末标点），等定稿（停下后 1.2~1.4s 才到）是拿延迟换标点
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

/** b 是 a 的"完整版"：b 以 a 的前六成开头（定稿比 interim 多了最后几个字 / 标点），或 a 已包含 b */
function completes(a: string, b: string): boolean {
  if (!a || !b) return false;
  return b.startsWith(a.slice(0, Math.max(2, Math.floor(a.length * 0.6)))) || a.includes(b);
}

/**
 * 提交后才到的定稿：把已提交那段升级成定稿版。
 * - 提交时带着没定稿的尾巴（interim）：定稿是这条尾巴的完整版 → 已定稿句子 + 这条定稿
 * - 提交时全是定稿（或整段就一句）：定稿是整段的完整版 → 直接替换
 * 其余（评委的回声、别的话）丢掉。
 */
function upgradeCommitted(state: TurnMachineState, text: string): TurnStep {
  const committed = state.lastCommitted;
  if (!committed) return { state, effects: [] };
  const incoming = normalizeText(text);
  let upgraded: string | null = null;
  let nextCommitted = committed;
  if (committed.interim) {
    const tail = normalizeText(committed.interim);
    if (completes(tail, incoming)) {
      const finals = [...committed.finals, incoming.length > tail.length ? text : committed.interim];
      upgraded = finals.join('');
      nextCommitted = { ...committed, text: upgraded, finals, interim: '' };
    }
  } else if (completes(normalizeText(committed.text), incoming) && incoming.length > normalizeText(committed.text).length) {
    upgraded = text;
    nextCommitted = { ...committed, text, finals: [text], interim: '' };
  }
  if (upgraded === null || upgraded === committed.text) return { state, effects: [] };
  return {
    state: { ...state, lastCommitted: nextCommitted },
    effects: [{ type: 'turn-upgrade', text: upgraded, turnIndex: committed.turnIndex }],
  };
}

function handleAsrFinal(state: TurnMachineState, event: { text: string; at: number }): TurnStep {
  const text = event.text.trim();
  if (!text) return { state, effects: [] };
  if (state.phase === 'judging' || state.phase === 'judge-speaking') {
    return upgradeCommitted(state, text);
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
    // ASR 自己已经判了句末：静音只要过了短捷径就直接结束回合——除非这句听着还没说完（逗号 / 连词收尾）
    if (event.at - next.lastVoiceAt >= state.params.finalShortcutSilenceMs && !looksUnfinished(pendingText(next))) {
      return commitTurn(next, event.at);
    }
  }
  return { state: next, effects: [] };
}

function handleAsrInterim(state: TurnMachineState, event: { text: string; at: number }): TurnStep {
  if (state.phase === 'judging' || state.phase === 'judge-speaking' || state.phase === 'calibrating') {
    return { state, effects: [] };
  }
  // 空 interim 是代理在定稿前一刻发的"清屏"（定稿紧随其后）：留着上一条尾巴，免得夹在中间的一帧把这句丢了
  if (!event.text.trim()) return { state, effects: [] };
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

/** 画面读得出来的四种状态（面试间讲台栏的波形 / 呼吸点，见 TeachBackPodium）：听讲中 / 你在讲 / 停顿等待 / 评委发言 */
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
