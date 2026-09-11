import { describe, expect, it } from 'vitest';
import {
  createTurnMachine,
  looksUnfinished,
  pendingText,
  prefetchCovers,
  reduceTurn,
  stageMoodOf,
  voiceThreshold,
  type TurnEffect,
  type TurnEvent,
  type TurnMachineState,
} from './teach-back-turn-machine';

/** 一帧 100ms；安静 0.004，说话 0.08 */
const FRAME_MS = 100;
const QUIET = 0.004;
const VOICE = 0.08;

interface Run {
  state: TurnMachineState;
  effects: TurnEffect[];
  at: number;
}

function start(params: Parameters<typeof createTurnMachine>[0] = {}): Run {
  return { state: createTurnMachine(params), effects: [], at: 0 };
}

function feed(run: Run, event: TurnEvent): Run {
  const step = reduceTurn(run.state, event);
  return { state: step.state, effects: [...run.effects, ...step.effects], at: 'at' in event ? event.at : run.at };
}

/** 连续喂 n 帧同一能量 */
function frames(run: Run, n: number, rms: number): Run {
  let current = run;
  for (let i = 0; i < n; i += 1) {
    current = feed(current, { type: 'frame', rms, at: current.at + FRAME_MS, durationMs: FRAME_MS });
  }
  return current;
}

/** 评委席看得见的 effects（预热 / 取消是幕后的） */
function judgeEffects(run: Run): TurnEffect[] {
  return run.effects.filter((effect) => effect.type !== 'turn-prefetch' && effect.type !== 'turn-prefetch-cancel');
}

function calibrated(params: Parameters<typeof createTurnMachine>[0] = {}): Run {
  // 1s 校准（11 帧，最后一帧跨过 1000ms）
  const run = frames(start(params), 11, QUIET);
  expect(run.state.phase).toBe('listening');
  return { ...run, effects: [] };
}

describe('校准', () => {
  it('前 1 秒收集噪声地板，之后进入听讲', () => {
    let run = frames(start(), 5, QUIET);
    expect(run.state.phase).toBe('calibrating');
    run = frames(run, 6, QUIET);
    expect(run.state.phase).toBe('listening');
    expect(run.state.noiseFloor).toBeCloseTo(QUIET, 3);
    // 阈值不低于 minVoiceRms
    expect(voiceThreshold(run.state)).toBeGreaterThanOrEqual(run.state.params.minVoiceRms);
  });

  it('校准期间用户就开讲：取安静的 20 分位，阈值不会被抬到听不见', () => {
    let run = frames(start(), 3, QUIET);
    run = frames(run, 8, VOICE);
    expect(run.state.phase).toBe('listening');
    expect(run.state.noiseFloor).toBeLessThan(0.01);
  });

  it('校准窗口里全是说话声：地板被钳在上限，几帧安静就回落，接着讲仍能触发 speaking', () => {
    let run = frames(start(), 11, VOICE);
    expect(run.state.phase).toBe('listening');
    expect(run.state.noiseFloor).toBeLessThanOrEqual(run.state.params.noiseFloorMax);
    // 阈值最多 0.06，正常音量 0.08 仍能过门
    run = frames(run, 2, VOICE);
    expect(run.state.phase).toBe('speaking');
    // 安静几帧后地板回到真实噪声附近（前 650ms 还在 hangover，之后每帧向下跟随）
    run = frames(run, 10, QUIET);
    expect(run.state.noiseFloor).toBeLessThan(0.01);
  });

  it('tick 也能结束校准', () => {
    let run = feed(start(), { type: 'frame', rms: QUIET, at: 100, durationMs: FRAME_MS });
    run = feed(run, { type: 'tick', at: 1200 });
    expect(run.state.phase).toBe('listening');
  });
});

describe('听讲 → 你在讲 → 停顿 → 回合结束', () => {
  it('连续有声 ≥200ms（两帧）进入 speaking；一帧噼啪不算', () => {
    let run = calibrated();
    run = frames(run, 1, VOICE);
    expect(run.state.phase).toBe('listening');
    run = frames(run, 1, VOICE);
    expect(run.state.phase).toBe('speaking');
    expect(run.state.level).toBeGreaterThan(0);
  });

  it('有效语音 ≥1.5s、静音 ≥1.2s → 回合结束并提交（无 interim 直接提交）；停下 650ms 先预热评委', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE); // 2s 语音
    run = feed(run, { type: 'asr-final', text: '三次握手是为了确认双向都能收发。', at: run.at });
    run = frames(run, 6, QUIET); // 0.6s 静音：还在 hangover 里，画面不抖
    expect(run.state.phase).toBe('speaking');
    expect(run.effects).toHaveLength(0);
    run = frames(run, 1, QUIET); // 0.7s：停下来了 → 预热
    expect(run.state.phase).toBe('pausing');
    expect(run.effects).toEqual([{ type: 'turn-prefetch', text: '三次握手是为了确认双向都能收发。', turnIndex: 0 }]);
    run = frames(run, 4, QUIET); // 累计 1.1s
    expect(run.state.phase).toBe('pausing');
    expect(judgeEffects(run)).toHaveLength(0);
    run = frames(run, 1, QUIET); // 1.2s 到
    expect(run.state.phase).toBe('judging');
    expect(judgeEffects(run)).toEqual([{ type: 'turn-commit', text: '三次握手是为了确认双向都能收发。', turnIndex: 0 }]);
    expect(run.state.turnIndex).toBe(1);
    expect(run.state.prefetching).toBe(false);
  });

  it('语音太短（<1.5s）停下来不算回合、也不预热，带着已说的继续听；接着讲会合并进同一回合', () => {
    let run = calibrated();
    run = frames(run, 8, VOICE); // 0.8s
    run = feed(run, { type: 'asr-final', text: '嗯，', at: run.at });
    run = frames(run, 17, QUIET); // 「嗯，」像没说完 → 1.7s 门槛
    expect(run.state.phase).toBe('listening');
    expect(run.effects).toHaveLength(0);
    expect(run.state.finals).toEqual(['嗯，']);
    run = frames(run, 10, VOICE); // 再讲 1s，累计 1.8s
    run = feed(run, { type: 'asr-final', text: '然后握手要三次。', at: run.at });
    run = frames(run, 12, QUIET);
    expect(judgeEffects(run)).toEqual([{ type: 'turn-commit', text: '嗯，然后握手要三次。', turnIndex: 0 }]);
  });

  it('停下 1.2s 时定稿还没到：拿手上的 interim 提交，不等定稿', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-interim', text: '三次握手是为了确认', at: run.at });
    run = frames(run, 11, QUIET);
    expect(run.state.phase).toBe('pausing');
    expect(judgeEffects(run)).toHaveLength(0);
    run = frames(run, 1, QUIET); // 1.2s 到
    expect(run.state.phase).toBe('judging');
    expect(judgeEffects(run)).toEqual([{ type: 'turn-commit', text: '三次握手是为了确认', turnIndex: 0 }]);
    expect(run.state.lastCommitted).toEqual({ text: '三次握手是为了确认', turnIndex: 0, finals: [], interim: '三次握手是为了确认' });
  });

  it('预热后接着讲：turn-prefetch-cancel，同一回合继续；再停下再预热', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-interim', text: '三次握手是为了确认', at: run.at });
    run = frames(run, 8, QUIET);
    expect(run.effects).toEqual([{ type: 'turn-prefetch', text: '三次握手是为了确认', turnIndex: 0 }]);
    run = frames(run, 2, VOICE);
    expect(run.state.phase).toBe('speaking');
    expect(run.effects.at(-1)).toEqual({ type: 'turn-prefetch-cancel', turnIndex: 0 });
    expect(run.state.prefetching).toBe(false);
    run = feed(run, { type: 'asr-interim', text: '三次握手是为了确认双向都能收发', at: run.at });
    run = frames(run, 7, QUIET);
    expect(run.effects.at(-1)).toEqual({ type: 'turn-prefetch', text: '三次握手是为了确认双向都能收发', turnIndex: 0 });
  });

  it('ASR 一个字还没给就到点：不预热，settling 里它追上来一句定稿 → 立刻提交', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = frames(run, 12, QUIET);
    expect(run.state.phase).toBe('settling');
    expect(run.effects).toHaveLength(0);
    run = feed(run, { type: 'asr-final', text: '三次握手是为了确认双向。', at: run.at + 100 });
    expect(run.state.phase).toBe('judging');
    expect(run.effects).toEqual([{ type: 'turn-commit', text: '三次握手是为了确认双向。', turnIndex: 0 }]);
  });

  it('settling 期间又开口：取消提交，继续同一回合', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = frames(run, 12, QUIET);
    expect(run.state.phase).toBe('settling');
    run = feed(run, { type: 'asr-interim', text: '三次握手', at: run.at });
    run = frames(run, 2, VOICE);
    expect(run.state.phase).toBe('speaking');
    expect(run.state.settleStartedAt).toBeNull();
    expect(run.state.interim).toBe('三次握手');
    expect(run.effects).toHaveLength(0);
  });

  it('ASR 句末定稿到了且静音已过 500ms：不必等满 1.2s 就结束回合', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = frames(run, 7, QUIET); // 0.7s 静音（过了 650ms hangover）
    expect(run.state.phase).toBe('pausing');
    run = feed(run, { type: 'asr-final', text: '这一段讲完了。', at: run.at });
    expect(run.state.phase).toBe('judging');
    expect(run.effects).toEqual([{ type: 'turn-commit', text: '这一段讲完了。', turnIndex: 0 }]);
  });

  it('能量说你讲了但 ASR 一个字没认出来：等 settle 到点，不惊动评委，回到听讲', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = frames(run, 12, QUIET);
    expect(run.state.phase).toBe('settling'); // 也许 ASR 只是慢了
    run = frames(run, 3, QUIET);
    expect(run.state.phase).toBe('listening');
    expect(run.effects).toHaveLength(0);
    expect(run.state.turnIndex).toBe(0);
  });

  it('空 interim（代理定稿前的清屏）不清掉手上的尾巴', () => {
    let run = calibrated();
    run = feed(run, { type: 'asr-interim', text: '三次握手是为了', at: run.at });
    run = feed(run, { type: 'asr-interim', text: '', at: run.at });
    expect(pendingText(run.state)).toBe('三次握手是为了');
    run = feed(run, { type: 'asr-final', text: '三次握手是为了确认。', at: run.at });
    expect(pendingText(run.state)).toBe('三次握手是为了确认。');
  });

  it('pendingText 拼接定稿与尾巴', () => {
    let run = calibrated();
    run = feed(run, { type: 'asr-final', text: ' 第一句。 ', at: run.at });
    run = feed(run, { type: 'asr-interim', text: '第二句还没', at: run.at });
    expect(pendingText(run.state)).toBe('第一句。第二句还没');
  });
});

describe('prefetchCovers', () => {
  it('提交文字只比预热多句末标点 / 最后一个词 → 预热的请求可以直接用', () => {
    expect(prefetchCovers('三次握手是为了确认双向', '三次握手是为了确认双向。')).toBe(true);
    expect(prefetchCovers('三次握手是为了确认双向', '三次握手是为了确认双向都能收发。')).toBe(true);
    expect(prefetchCovers('三次握手是为了确认双向。', '三次握手是为了确认双向。')).toBe(true);
  });

  it('停顿里 ASR 又补了一截、或文字对不上 → 重新请求', () => {
    expect(prefetchCovers('三次握手', '三次握手是为了确认双向都能收发。')).toBe(false);
    expect(prefetchCovers('三次握手是为了', '四次挥手是为了')).toBe(false);
    expect(prefetchCovers('', '三次握手')).toBe(false);
  });
});

describe('换气 ≠ 讲完：尾巴像没说完就多等', () => {
  it('looksUnfinished：逗号 / 连词 / 语气词 / 介词收尾算没说完，句号 / 实词收尾不算', () => {
    for (const text of ['定义域是原来的值域，', '要求 f 的值域落在 g 的定义域和', '所以定义域是', '然后', '嗯', '也就是说', '先做 f 再做 g，然后', '把 x 和']) {
      expect(looksUnfinished(text), text).toBe(true);
    }
    // "的" 故意不收：句尾的"是这样的 / 对的"太常见，多等半秒不值
    for (const text of ['两个刚好交换过来。', '它不是单射，因为 2 和 -2 都对应 4', '这样的逆映射不存在', '这一点很重要', 'f 的像叫做映像', '每个 y 都能得到', '这是对的', '', '   ']) {
      expect(looksUnfinished(text), text).toBe(false);
    }
  });

  it('interim 以连词收尾：1.2s 不算讲完，1.7s 才提交', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-interim', text: '所以定义域是 f 的定义域，然后', at: run.at });
    run = frames(run, 16, QUIET); // 1.6s 静音
    expect(run.state.phase).toBe('pausing');
    expect(judgeEffects(run)).toHaveLength(0);
    run = frames(run, 1, QUIET); // 1.7s
    expect(run.state.phase).toBe('judging');
    expect(judgeEffects(run)).toEqual([{ type: 'turn-commit', text: '所以定义域是 f 的定义域，然后', turnIndex: 0 }]);
  });

  it('接着讲：连词后面的话合进同一回合，没有假回合', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-interim', text: '所以定义域是 f 的定义域，然后', at: run.at });
    run = frames(run, 15, QUIET); // 1.5s 的想词停顿（没有连词判断时这里早就提交了）
    expect(run.state.phase).toBe('pausing');
    run = frames(run, 15, VOICE);
    expect(run.state.phase).toBe('speaking');
    expect(judgeEffects(run)).toHaveLength(0);
    run = feed(run, { type: 'asr-final', text: '所以定义域是 f 的定义域，然后值域要落在 g 的定义域里。', at: run.at });
    run = frames(run, 12, QUIET);
    expect(judgeEffects(run)).toEqual([{ type: 'turn-commit', text: '所以定义域是 f 的定义域，然后值域要落在 g 的定义域里。', turnIndex: 0 }]);
  });

  it('定稿以逗号收尾（ASR 在换气处断句）：不走 0.5s 捷径，留着等下一句', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = frames(run, 7, QUIET);
    expect(run.state.phase).toBe('pausing');
    run = feed(run, { type: 'asr-final', text: '首先，单射的意思是，', at: run.at });
    expect(run.state.phase).toBe('pausing');
    expect(run.effects).toHaveLength(0);
    expect(run.state.finals).toEqual(['首先，单射的意思是，']);
    run = frames(run, 5, VOICE);
    expect(run.state.phase).toBe('speaking');
  });
});

describe('评委发言与插话', () => {
  function committed(): Run {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-final', text: '第一段。', at: run.at });
    run = frames(run, 13, QUIET);
    expect(run.state.phase).toBe('judging');
    return { ...run, effects: [] };
  }

  it('judge-open 进入评委发言，judge-close 回到听讲', () => {
    let run = committed();
    run = feed(run, { type: 'judge-open', at: run.at + 800 });
    expect(run.state.phase).toBe('judge-speaking');
    run = feed(run, { type: 'judge-close', at: run.at + 3000 });
    expect(run.state.phase).toBe('listening');
  });

  it('评委发言中你开口 → interrupt，回到你在讲；门槛比平时高（400ms = 4 帧）', () => {
    let run = committed();
    run = feed(run, { type: 'judge-open', at: run.at + 800 });
    run = frames(run, 3, VOICE);
    expect(run.state.phase).toBe('judge-speaking');
    expect(run.effects).toHaveLength(0);
    run = frames(run, 1, VOICE);
    expect(run.state.phase).toBe('speaking');
    expect(run.effects).toEqual([{ type: 'interrupt' }]);
  });

  it('评委还在想（judging）你就接着讲：同样 interrupt，中止在飞的请求', () => {
    let run = committed();
    run = frames(run, 4, VOICE);
    expect(run.state.phase).toBe('speaking');
    expect(run.effects).toEqual([{ type: 'interrupt' }]);
  });

  it('评委发言中的弱回声（低于打断阈值）不打断', () => {
    let run = committed();
    run = feed(run, { type: 'judge-open', at: run.at + 800 });
    const weak = voiceThreshold(run.state) * 0.9;
    run = frames(run, 10, weak);
    expect(run.state.phase).toBe('judge-speaking');
    expect(run.effects).toHaveLength(0);
  });

  it('评委发言期间到达的 ASR 文本（回声）不进回合缓冲', () => {
    let run = committed();
    run = feed(run, { type: 'judge-open', at: run.at + 800 });
    run = feed(run, { type: 'asr-interim', text: '你刚才说', at: run.at });
    run = feed(run, { type: 'asr-final', text: '你刚才说的定义不对。', at: run.at });
    expect(run.state.interim).toBe('');
    expect(run.state.finals).toEqual([]);
    expect(run.effects).toHaveLength(0);
  });

  it('提交后才到的定稿是刚提交那段的完整版 → turn-upgrade', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-interim', text: '三次握手是为了确认', at: run.at });
    run = frames(run, 9 + 3, QUIET); // settling 超时提交 interim
    expect(run.state.phase).toBe('judging');
    run = { ...run, effects: [] };
    run = feed(run, { type: 'asr-final', text: '三次握手是为了确认双向都能收发。', at: run.at });
    expect(run.effects).toEqual([
      { type: 'turn-upgrade', text: '三次握手是为了确认双向都能收发。', turnIndex: 0 },
    ]);
    expect(run.state.lastCommitted?.text).toBe('三次握手是为了确认双向都能收发。');
  });

  it('多句回合带着尾巴提交：迟到的定稿只替换尾巴，前面已定稿的句子原样保留', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-final', text: '单射就是不同的 x 对应不同的 y。', at: run.at });
    run = feed(run, { type: 'asr-interim', text: '只有单射才能有逆映', at: run.at });
    run = frames(run, 12, QUIET);
    expect(judgeEffects(run)).toEqual([{ type: 'turn-commit', text: '单射就是不同的 x 对应不同的 y。只有单射才能有逆映', turnIndex: 0 }]);
    run = { ...run, effects: [] };
    // 评委的回声 / 别的话：不理
    run = feed(run, { type: 'asr-final', text: '你刚才说的定义不对。', at: run.at });
    expect(run.effects).toHaveLength(0);
    run = feed(run, { type: 'asr-final', text: '只有单射才能有逆映射。', at: run.at });
    expect(run.effects).toEqual([{ type: 'turn-upgrade', text: '单射就是不同的 x 对应不同的 y。只有单射才能有逆映射。', turnIndex: 0 }]);
    // 同一条定稿不会再升级第二次
    run = { ...run, effects: [] };
    run = feed(run, { type: 'asr-final', text: '只有单射才能有逆映射。', at: run.at });
    expect(run.effects).toHaveLength(0);
  });

  it('讲完了：带上未提交的文字；评委在说则先打断', () => {
    let run = committed();
    run = feed(run, { type: 'judge-open', at: run.at });
    run = feed(run, { type: 'finish', at: run.at });
    expect(run.effects).toEqual([{ type: 'interrupt' }, { type: 'finish', text: '' }]);
    expect(run.state.phase).toBe('listening');

    let run2 = calibrated();
    run2 = frames(run2, 5, VOICE);
    run2 = feed(run2, { type: 'asr-interim', text: '最后一句', at: run2.at });
    run2 = feed(run2, { type: 'finish', at: run2.at });
    expect(run2.effects).toEqual([{ type: 'finish', text: '最后一句' }]);
  });
});

describe('打字讲（麦克风不可用时的兜底）', () => {
  it('打字的一段与语音尾巴合并后直接提交', () => {
    let run = calibrated();
    run = feed(run, { type: 'asr-interim', text: '前半句', at: run.at });
    run = feed(run, { type: 'typed', text: '后半句打出来的。', at: run.at });
    expect(run.state.phase).toBe('judging');
    expect(run.effects).toEqual([{ type: 'turn-commit', text: '前半句后半句打出来的。', turnIndex: 0 }]);
  });

  it('评委在说时打字 → 先打断再提交；空字符串忽略', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-final', text: '第一段。', at: run.at });
    run = frames(run, 13, QUIET);
    run = feed(run, { type: 'judge-open', at: run.at });
    run = { ...run, effects: [] };
    run = feed(run, { type: 'typed', text: '   ', at: run.at });
    expect(run.effects).toHaveLength(0);
    run = feed(run, { type: 'typed', text: '补一句。', at: run.at });
    expect(run.effects).toEqual([{ type: 'interrupt' }, { type: 'turn-commit', text: '补一句。', turnIndex: 1 }]);
  });
});

describe('长时间不讲', () => {
  it('讲过一段之后 40s 没人说话 → idle-nudge，且只提醒一次', () => {
    let run = calibrated();
    run = frames(run, 20, VOICE);
    run = feed(run, { type: 'asr-final', text: '第一段。', at: run.at });
    run = frames(run, 13, QUIET);
    run = feed(run, { type: 'judge-close', at: run.at + 1000 });
    run = { ...run, effects: [] };
    run = feed(run, { type: 'tick', at: run.at + 39_000 });
    expect(run.effects).toHaveLength(0);
    run = feed(run, { type: 'tick', at: run.at + 41_000 });
    expect(run.effects).toEqual([{ type: 'idle-nudge' }]);
    // 评委要开口：进 judging（可被插话、挡回声）
    expect(run.state.phase).toBe('judging');
    run = feed(run, { type: 'judge-open', at: run.at });
    run = feed(run, { type: 'judge-close', at: run.at + 3000 });
    expect(run.state.phase).toBe('listening');
    run = feed(run, { type: 'tick', at: run.at + 90_000 });
    expect(run.effects).toEqual([{ type: 'idle-nudge' }]);
  });

  it('一段都没讲过不提醒', () => {
    let run = calibrated();
    run = feed(run, { type: 'tick', at: run.at + 120_000 });
    expect(run.effects).toHaveLength(0);
  });
});

describe('stageMoodOf', () => {
  it('七个阶段折成画面里的四种状态', () => {
    expect(stageMoodOf('calibrating')).toBe('listening');
    expect(stageMoodOf('listening')).toBe('listening');
    expect(stageMoodOf('speaking')).toBe('speaking');
    expect(stageMoodOf('pausing')).toBe('pausing');
    expect(stageMoodOf('settling')).toBe('pausing');
    expect(stageMoodOf('judging')).toBe('pausing');
    expect(stageMoodOf('judge-speaking')).toBe('judge');
  });
});
