/**
 * AudioPlayer 接口 + AudioPacer —— vendor ActionEngine 的 speech 动作节奏层。
 *
 * AudioPlayer 接口晋升自 spike shim（shims/lib/utils/audio-player.ts，engine.ts
 * 的类型契约，原样保留）。AudioPacer 是本服务的实现：不接真实 TTS（出声走现有
 * /api/teach/tts + 前端），用 vendor estimateSpeechDurationMs（CJK 150ms/char
 * 口径）估时 pacing——speech 动作 await 估时结束，后续板书动作才执行，
 * 维持引擎 blocking 二分契约的"说完一句再落笔"。
 *
 * abort() 让打断立刻穿透当前 speech（engine 的 executeSpeech 本身不看 signal，
 * 只能由 player 侧放行）；speed 供测试/bench 加速（真实服务恒 1）。
 */
import { estimateSpeechDurationMs } from '../vendor/openmaic/choreography/timing';

export interface AudioPlayer {
  play(audioId: string, audioUrl?: string): Promise<boolean>;
  onEnded(cb: () => void): void;
  setPlaybackRate?(rate: number): void;
}

export class AudioPacer implements AudioPlayer {
  private endedCb: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextMs = 0;
  private aborted = false;

  constructor(private readonly opts: { speed?: number } = {}) {}

  /** 下一段口播的台词（engine 只传 audioId，估时需要文本）。 */
  expectSpeech(text: string): void {
    this.nextMs = estimateSpeechDurationMs(text) / (this.opts.speed ?? 1);
  }

  play(_audioId: string, _audioUrl?: string): Promise<boolean> {
    if (this.timer) clearTimeout(this.timer);
    if (this.aborted) return Promise.resolve(false);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.endedCb?.();
    }, this.nextMs);
    return Promise.resolve(true);
  }

  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }

  /** 打断：当前 speech 立即结束（engine 的 await 放行）。 */
  abort(): void {
    this.aborted = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.endedCb?.();
  }

  /** 新一轮口播前复位（每线程一个 pacer，跨轮复用）。 */
  reset(): void {
    this.aborted = false;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.endedCb = null;
  }
}
