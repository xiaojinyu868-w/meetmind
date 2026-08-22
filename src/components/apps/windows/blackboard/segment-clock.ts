'use client';

/**
 * segment-clock — 黑板播放的 Clock 抽象。
 *
 * 未来可插火山 bigtts：只新增一个返回 SegmentClock 的工厂，状态机不变。
 * v0 用浏览器 speechSynthesis 朗读 narration，onboundary 词级事件回锚进度；
 * 不支持 boundary（或语音不可用）的浏览器降级为按字数估算的 timer
 * （中文约 280ms/字）。
 *
 * v3：onProgress 带词级 charIndex——boundary 事件直接给；不支持时按
 * elapsed/估算时长 等比估算（cue 词级触发与降级估算共用同一坐标系）。
 */

import { charIndexAtMs } from '@/lib/services/board-tts-service';
import type { WordTiming } from '@/lib/services/board-tts-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('board-clock');

/**
 * 老师的基础语速（v19）：0.9 = 比 TTS 默认慢 10%，真人老师讲课比 TTS 默认语速从容。
 * 为什么不在合成层做（2026-08-19 实测，scripts 临时实验）：
 * - cosyvoice-v3-flash 的 speech_rate 参数被静默忽略（0.9 与默认产出逐字节一致）；
 * - v3 系统音色指令只认官方固定格式（场景+情感），追加"语速稍慢"直接 InvalidParameter。
 * 而在播放层做天然保同步：charIndex 走音频媒体时间轴插值（charIndexAtMs），
 * 与 playbackRate 无关——放慢的只是墙钟进度，音画对齐不受影响。
 * 降级链（speechSynthesis/timer）同一速率系数，听感不断裂。
 */
export const SPEECH_BASE_RATE = 0.9;

// ── Clock 抽象 ─────────────────────────────────────────────────────────────

export interface ClockProgress {
  elapsedMs: number;
  /** 当前朗读到的字符下标（剥 cue 后的展示文本坐标系） */
  charIndex: number;
}

export interface SegmentClock {
  start(): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  setRate(rate: number): void;
  onProgress: ((progress: ClockProgress) => void) | null;
  onEnd: (() => void) | null;
  /** AudioClock 专用：音频不可用（未配置/合成失败/decode 失败）时回调，调用方降级 */
  onUnavailable?: (() => void) | null;
}

function pickZhVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    return (
      voices.find((voice) => /^zh|cmn/i.test(voice.lang)) ??
      voices.find((voice) => /chinese|中文/i.test(voice.name)) ??
      null
    );
  } catch {
    return null;
  }
}

const BOUNDARY_DETECT_MS = 2000;

/**
 * 一个 segment 的播放钟。
 * - 有 speechSynthesis：朗读 narration；boundary 事件把进度回锚到
 *   `已读字数 / 总字数 × 估算时长`，boundary 之间用墙钟推进；
 *   结束以 utterance.onend 为准（带安全超时兜底）。
 * - 无 speechSynthesis：纯 timer，速率跟随倍速。
 */
export function createSpeechClock(narration: string, estimatedMs: number, rate: number): SegmentClock {
  const synth =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

  let raf = 0;
  let startAt = 0;
  let banked = 0;
  let currentRate = rate;
  let paused = false;
  let finished = false;
  let boundaryAnchor: { elapsed: number; wallAt: number; charIndex: number } | null = null;
  let sawBoundary = false;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  // 暂停感知的安全定时器：暂停冻结剩余时长，恢复重武装
  let safetyRemainingMs = 0;
  let safetyArmedAt = 0;

  function armSafety(ms: number): void {
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyRemainingMs = ms;
    safetyArmedAt = Date.now();
    safetyTimer = setTimeout(() => finish(), ms);
  }

  function freezeSafety(): void {
    if (!safetyTimer) return;
    clearTimeout(safetyTimer);
    safetyTimer = null;
    safetyRemainingMs = Math.max(0, safetyRemainingMs - (Date.now() - safetyArmedAt));
  }

  function rearmSafety(): void {
    if (finished || safetyTimer || safetyRemainingMs <= 0) return;
    safetyArmedAt = Date.now();
    safetyTimer = setTimeout(() => finish(), safetyRemainingMs);
  }

  const charCount = Math.max(1, narration.replace(/\s+/g, '').length);
  let utterance: SpeechSynthesisUtterance | null = null;

  // 安全超时必须按机器人音的真实语速估（~280ms/字），不能用 v15 校准后的
  // 150ms/字时间轴：超时早于 utterance 念完触发 finish() → 下一段 TTS 起播
  // 时机器人还在念 = 双音轨（2026-08-18 实测复现）。utterance 无时长 API，
  // 只能按系统语音的保守语速留足余量
  const robotEstimatedMs = Math.max(estimatedMs, charCount * 280);

  const clock: SegmentClock = {
    onProgress: null,
    onEnd: null,

    start() {
      startAt = performance.now();
      if (synth && narration.trim()) {
        try {
          utterance = new SpeechSynthesisUtterance(narration);
          utterance.lang = 'zh-CN';
          utterance.rate = currentRate;
          const voice = pickZhVoice();
          if (voice) utterance.voice = voice;
          utterance.onboundary = (event) => {
            if (typeof event.charIndex === 'number') {
              sawBoundary = true;
              boundaryAnchor = {
                elapsed: Math.min(estimatedMs, (event.charIndex / charCount) * estimatedMs),
                wallAt: performance.now(),
                charIndex: event.charIndex,
              };
            }
          };
          utterance.onend = () => finish();
          // 语音不可用（无声卡/无 voice/headless）：降级为纯 timer，不是直接结束
          utterance.onerror = () => {
            utterance = null;
            if (safetyTimer) {
              clearTimeout(safetyTimer);
              safetyTimer = null;
            }
            safetyRemainingMs = 0;
            try {
              synth.cancel();
            } catch {
              /* 忽略 */
            }
          };
          synth.speak(utterance);
          // onend 偶发不触发，安全超时兜底（按机器人语速估，见上）
          armSafety((robotEstimatedMs / currentRate) * 1.6 + 4000);
        } catch {
          utterance = null;
        }
      }
      loop();
    },

    pause() {
      paused = true;
      banked = elapsedNow();
      // 安全定时器同步冻结：暂停超时会误触发 finish → 段在暂停中被推进、
      // clock 被销毁，恢复后人声从段首重播 = 音画错位（2026-08-19 实测根因）
      freezeSafety();
      try {
        synth?.pause();
      } catch {
        /* 忽略 */
      }
    },

    resume() {
      paused = false;
      startAt = performance.now();
      if (boundaryAnchor) boundaryAnchor.wallAt = performance.now();
      rearmSafety();
      try {
        synth?.resume();
      } catch {
        /* 忽略 */
      }
    },

    cancel() {
      finished = true;
      cancelAnimationFrame(raf);
      if (safetyTimer) clearTimeout(safetyTimer);
      try {
        synth?.cancel();
      } catch {
        /* 忽略 */
      }
    },

    setRate(next: number) {
      // 语音中途改不了 utterance.rate，进度缩放先生效；下一段用新速率起播
      banked = elapsedNow();
      startAt = performance.now();
      if (boundaryAnchor) {
        boundaryAnchor = { ...boundaryAnchor, elapsed: banked, wallAt: performance.now() };
      }
      currentRate = next;
    },
  };

  function elapsedNow(): number {
    if (paused) return banked;
    const now = performance.now();
    if (boundaryAnchor) return boundaryAnchor.elapsed + (now - boundaryAnchor.wallAt) * currentRate;
    return banked + (now - startAt) * currentRate;
  }

  /** 词级下标：boundary 给了真实值就锚定推进，否则按 elapsed 等比估算。 */
  function charIndexNow(elapsed: number): number {
    if (boundaryAnchor) {
      const estimated = Math.min(
        charCount,
        Math.floor((elapsedNow() / Math.max(1, estimatedMs)) * charCount),
      );
      return Math.max(boundaryAnchor.charIndex, estimated);
    }
    return Math.min(charCount, Math.floor((elapsed / Math.max(1, estimatedMs)) * charCount));
  }

  function loop() {
    if (finished) return;
    const elapsed = elapsedNow();
    // 2000ms 内没等到 boundary 事件 → 认定不支持，转纯 timer 推进
    if (!sawBoundary && !boundaryAnchor && elapsed > BOUNDARY_DETECT_MS) {
      boundaryAnchor = null;
    }
    const clamped = Math.min(elapsed, estimatedMs);
    clock.onProgress?.({ elapsedMs: clamped, charIndex: charIndexNow(clamped) });

    if (!utterance && elapsed >= estimatedMs) {
      finish();
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function finish() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = null;
    safetyRemainingMs = 0;
    clock.onProgress?.({ elapsedMs: estimatedMs, charIndex: charCount });
    clock.onEnd?.();
  }

  return clock;
}

// ── AudioClock（DashScope TTS 音频 + 字级时间戳） ──────────────────────────

interface BoardTtsPayload {
  audio: string;
  timings: WordTiming[];
}

// 模块级请求缓存：预取与实际播放去重（同一段文本只发一次请求）
const ttsRequests = new Map<string, Promise<BoardTtsPayload | null>>();

// 共享 AudioContext：每段新建 ctx 有初始化延迟，且自动播放策略下每段都要重走
// suspended 竞速——段间缝的一大来源。同一时刻只有一个 clock 在播，共享安全。
let sharedAudioCtx: AudioContext | null = null;

function getSharedAudioCtx(): AudioContext {
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
    sharedAudioCtx = new AudioContext();
  }
  return sharedAudioCtx;
}

function fetchBoardTts(text: string): Promise<BoardTtsPayload | null> {
  const key = text;
  const existing = ttsRequests.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch('/api/board/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        // 服务端 1 路串行闸 + 重试下，预取排队靠后的请求要等前序若干段
        // （每段 1.5-3s + 偶发 428 重试至 +7s），15s 会误杀队尾请求判成机器人音；
        // 预取不是延迟敏感路径，放宽到 45s（在播段另有 9s 看门狗兜底降级）
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) return null;
      return (await response.json()) as BoardTtsPayload;
    } catch {
      return null;
    }
  })();
  ttsRequests.set(key, request);
  // 失败（null）不留缓存：瞬时抖动不该把这一段的声音判死刑整个会话
  void request.then((payload) => {
    if (payload === null && ttsRequests.get(key) === request) ttsRequests.delete(key);
  });
  while (ttsRequests.size > 32) {
    const oldest = ttsRequests.keys().next().value;
    if (oldest === undefined) break;
    ttsRequests.delete(oldest);
  }
  return request;
}

/** 预取下一段音频（当前段播放时后台调用）。 */
export function prefetchBoardTts(text: string): void {
  if (text.trim()) void fetchBoardTts(text);
}

/**
 * AudioClock：fetch /api/board/tts → AudioContext 播放，
 * currentTime 经字级 timings 插值出 charIndex（与 speechSynthesis boundary 同坐标系）。
 * elapsedMs 按 估算时长/真实音频时长 比例缩放，保证时间轴动作与真实音频同步；
 * 失败（未配置/合成失败/decode 失败）回调 onUnavailable，由调用方降级。
 */
export function createAudioClock(
  narration: string,
  estimatedMs: number,
  rate: number,
  options?: { watchdogMs?: number },
): SegmentClock {
  const charCount = Math.max(1, narration.replace(/\s+/g, '').length);

  let ctx: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let timings: WordTiming[] = [];
  let durationScale = 1;
  let startCtxAt = 0;
  let started = false;
  let cancelled = false;
  let finished = false;
  let currentRate = rate;
  let raf = 0;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let cancelGestureWait: (() => void) | null = null;
  // 起播流程未走完时被暂停：音频就绪后立刻 suspend，等恢复再出声
  let suspended = false;
  // 暂停感知的看门狗（与安全定时器同款）：暂停期间不许触发降级——
  // 降级会新建一个没人 pause 的 fallback clock，它在暂停中自由跑完，
  // 恢复后人声彻底消失只剩板书在写（2026-08-19 事件流实证）
  let watchdogRemainingMs = 0;
  let watchdogArmedAt = 0;

  function armWatchdogTimer(ms: number, watchdogMs: number): void {
    if (watchdog) clearTimeout(watchdog);
    watchdogRemainingMs = ms;
    watchdogArmedAt = Date.now();
    if (suspended) return; // 挂起中只记账，恢复时再起跑
    watchdog = setTimeout(() => {
      if (!started && !cancelled && !finished) {
        log.error(`board clock: audio ${watchdogMs / 1000}s 未起播，降级 speechSynthesis`);
        clock.onUnavailable?.();
      }
    }, ms);
  }

  function freezeWatchdog(): void {
    if (!watchdog) return;
    clearTimeout(watchdog);
    watchdog = null;
    watchdogRemainingMs = Math.max(0, watchdogRemainingMs - (Date.now() - watchdogArmedAt));
  }

  function rearmWatchdog(): void {
    if (started || finished || cancelled || watchdog || watchdogRemainingMs <= 0) return;
    watchdogArmedAt = Date.now();
    watchdog = setTimeout(() => {
      if (!started && !cancelled && !finished) {
        log.error('board clock: audio 看门狗超时（恢复后），降级 speechSynthesis');
        clock.onUnavailable?.();
      }
    }, watchdogRemainingMs);
  }
  // 暂停感知的安全定时器（与 SpeechClock 同款）：暂停冻结剩余，恢复重武装
  let safetyRemainingMs = 0;
  let safetyArmedAt = 0;

  function armSafety(ms: number): void {
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyRemainingMs = ms;
    safetyArmedAt = Date.now();
    safetyTimer = setTimeout(() => finish(), ms);
  }

  function freezeSafety(): void {
    if (!safetyTimer) return;
    clearTimeout(safetyTimer);
    safetyTimer = null;
    safetyRemainingMs = Math.max(0, safetyRemainingMs - (Date.now() - safetyArmedAt));
  }

  function rearmSafety(): void {
    if (finished || cancelled || safetyTimer || safetyRemainingMs <= 0) return;
    safetyArmedAt = Date.now();
    safetyTimer = setTimeout(() => finish(), safetyRemainingMs);
  }

  const clock: SegmentClock = {
    onProgress: null,
    onEnd: null,
    onUnavailable: null,

    start() {
      void (async () => {
        // TTS 取音频与手势门并行（取音频慢是常态，先进先出队）
        const payloadPromise = fetchBoardTts(narration);
        ctx = getSharedAudioCtx();
        // 自动播放策略门（2026-08-19 改）：没有手势就没有声音——无限等待
        // 用户点一下（UI 经 board:awaiting-gesture 显示提示），不再 5s 倒计时
        // 降级机器人音：第一耳朵必须是真人，机械音只在 TTS 真挂时出现。
        // 看门狗在手势拿到之后才武装——等手势不是"挂起"，是明确的开始门。
        if (ctx.state !== 'running') {
          await Promise.race([
            ctx.resume().catch(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, 400)),
          ]);
        }
        if (ctx.state !== 'running' && !cancelled && !finished) {
          window.dispatchEvent(new CustomEvent('board:awaiting-gesture', { detail: true }));
          await new Promise<void>((resolve) => {
            const onGesture = () => {
              window.removeEventListener('pointerdown', onGesture);
              window.removeEventListener('keydown', onGesture);
              resolve();
            };
            window.addEventListener('pointerdown', onGesture, { once: true });
            window.addEventListener('keydown', onGesture, { once: true });
            cancelGestureWait = () => {
              window.removeEventListener('pointerdown', onGesture);
              window.removeEventListener('keydown', onGesture);
              resolve();
            };
          });
          cancelGestureWait = null;
          window.dispatchEvent(new CustomEvent('board:awaiting-gesture', { detail: false }));
          if (cancelled || finished) return;
          await ctx.resume().catch(() => undefined);
        }
        if (cancelled || finished) return;
        if (ctx.state !== 'running') {
          log.info('board clock: AudioContext 被自动播放策略挂起，降级 speechSynthesis');
          ctx = null; // 不 close 共享 ctx：首次手势后它自己能 resume
          clock.onUnavailable?.();
          return;
        }

        // 看门狗此刻才武装：音频在限时内没起来（fetch/decode 挂起、CDN 抖动）
        // 一律降级——黑板的钟永远不许冻住。暂停感知：挂起中只记账不起跑。
        // 冷启动宽限（首页首段默认 15s，调用方传入）：TTS 预取在脚本加载时已发出，
        // 引擎冷 + 串行闸下首段合成可达 10s+，9s 误杀会把第一耳朵判成机器人音
        const watchdogMs = options?.watchdogMs ?? 9000;
        armWatchdogTimer(watchdogMs, watchdogMs);

        const payload = await payloadPromise;
        if (cancelled || finished) return;
        if (!payload) {
          log.info('board clock: audio 不可用，降级 speechSynthesis');
          clock.onUnavailable?.();
          return;
        }
        try {
          const bytes = Uint8Array.from(atob(payload.audio), (char) => char.charCodeAt(0));
          // decode 也可能挂起，竞速 8s 超时
          const buffer = await Promise.race([
            ctx.decodeAudioData(bytes.buffer.slice(0)),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('decode timeout')), 8000)),
          ]);
          if (cancelled || finished) return;
          timings = payload.timings;
          // 真实音频时长 ≠ narration 估算时长，progress 的 elapsedMs 按比例缩放对齐时间轴
          durationScale = estimatedMs / Math.max(1, buffer.duration * 1000);
          source = ctx.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = currentRate;
          source.connect(ctx.destination);
          source.onended = () => finish();
          startCtxAt = ctx.currentTime;
          started = true;
          if (watchdog) {
            clearTimeout(watchdog);
            watchdog = null;
          }
          watchdogRemainingMs = 0;
          source.start();
          // 起播流程中用户已暂停：立刻挂起，等恢复再出声（进度随之冻结）
          if (suspended) void ctx.suspend();
          log.info('board clock: audio（DashScope TTS）');
          armSafety((buffer.duration / currentRate) * 1000 + 3000);
          loop();
        } catch {
          if (!cancelled && !finished) {
            log.info('board clock: audio decode 失败，降级 speechSynthesis');
            clock.onUnavailable?.();
          }
        }
      })();
    },

    pause() {
      suspended = true;
      // 安全定时器/看门狗同步冻结：暂停中触发会误 finish 或误降级
      // （降级新建的 fallback clock 没人 pause，会在暂停中跑完——
      // 恢复后人声消失只剩板书在写，2026-08-19 事件流实证）
      freezeSafety();
      freezeWatchdog();
      void ctx?.suspend();
    },

    resume() {
      suspended = false;
      rearmSafety();
      rearmWatchdog();
      void ctx?.resume();
    },

    cancel() {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (safetyTimer) clearTimeout(safetyTimer);
      if (watchdog) clearTimeout(watchdog);
      cancelGestureWait?.();
      cancelGestureWait = null;
      try {
        source?.stop();
      } catch {
        /* 忽略 */
      }
      // 共享 ctx 不 close，留给下一段复用
    },

    setRate(next: number) {
      currentRate = next;
      if (source) source.playbackRate.value = next;
    },
  };

  /** 音频已播放的毫秒数（音频自身时间轴；suspend 时 ctx.currentTime 冻结） */
  function audioElapsedMs(): number {
    if (!started || !ctx) return 0;
    return (ctx.currentTime - startCtxAt) * 1000 * currentRate;
  }

  function loop() {
    if (finished || cancelled) return;
    const audioMs = audioElapsedMs();
    clock.onProgress?.({
      elapsedMs: Math.min(estimatedMs, audioMs * durationScale),
      charIndex: charIndexAtMs(timings, audioMs, charCount),
    });
    raf = requestAnimationFrame(loop);
  }

  function finish() {
    if (finished || cancelled) return;
    finished = true;
    cancelAnimationFrame(raf);
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = null;
    safetyRemainingMs = 0;
    watchdogRemainingMs = 0;
    clock.onProgress?.({ elapsedMs: estimatedMs, charIndex: charCount });
    clock.onEnd?.();
  }

  return clock;
}
