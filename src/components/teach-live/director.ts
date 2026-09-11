/**
 * director —— 舞台节奏器：把「到达时间轴」上的事件按「演出时间轴」放出来。
 *
 * 模型 10 秒生成完一轮，学生要听 60–90 秒。Director 持有一条 beat 队列
 * （句子 / 揭示某个 segment / 提示动作），串行消费：
 * - 句子：交给语音口（TTS），**等它开始出声**才继续——所以句子后面紧跟的板书
 *   是"说到这句时画出来"，而不是一屏糊上来；下一句要等上一句播完（播放器串行）。
 * - 揭示：连续多块之间保底 STAGGER 间隔；跟在句子后面的第一块延 LEAD 毫秒，
 *   让声音略微领先于笔。
 * - 提示：scene / point / highlight / erase 立刻触发；pause 真等。
 * 静音或无语音时，用估时（中文 ~170ms/字）代替音频时长，节奏不塌。
 * reset() = 打断：清队列、闭嘴，代数 +1 让在飞的 await 全部作废。
 */

import type { LiveAttrs, LiveCueName } from '@/types/teach-live';
import { speakableText } from '@/lib/utils/math-text';

export type Beat =
  | { kind: 'speech'; blockId: string; text: string; ask: boolean }
  | { kind: 'reveal'; segmentId: string; blockId: string }
  | { kind: 'cue'; name: LiveCueName; args: LiveAttrs }
  /** 回看时学生当时说的话（演到这里才进课堂记录） */
  | { kind: 'student'; text: string };

export interface SpeechPort {
  /** 播一句；resolve 于该句**开始**出声。静音 / 不可用 → 立即 resolve(false) */
  speak(text: string): Promise<boolean>;
  stop(): void;
}

export type CaptionPhase = 'pending' | 'speaking';

export interface DirectorHooks {
  onReveal(segmentId: string, blockId: string): void;
  onCue(name: LiveCueName, args: LiveAttrs): void;
  onCaption(text: string | null, meta: { blockId: string | null; ask: boolean; phase: CaptionPhase }): void;
  /** 队列演完（此刻没有更多 beat）——用来显示「等你回答」 */
  onDrain?(): void;
  onStudent?(text: string): void;
  estimateMs?(text: string): number;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

const STAGGER_MS = 650;
const LEAD_MS = 320;

/** 中文口播估时：~170ms/字，短句保底 */
export function estimateSpeechMs(text: string): number {
  const clean = text.replace(/\s+/g, '');
  return Math.max(700, Math.min(12_000, clean.length * 170));
}

export class Director {
  private queue: Beat[] = [];
  private pumping = false;
  private generation = 0;
  private lastRevealAt = -Infinity;
  private lastSpeechStartAt = -Infinity;
  private silentGateUntil = 0;

  constructor(
    private readonly speech: SpeechPort,
    private readonly hooks: DirectorHooks,
  ) {}

  push(beat: Beat): void {
    this.queue.push(beat);
    void this.pump();
  }

  get pending(): number {
    return this.queue.length;
  }

  get busy(): boolean {
    return this.pumping || this.queue.length > 0;
  }

  /** 打断：清空未演出的、闭嘴、作废在飞的等待 */
  reset(): void {
    this.generation += 1;
    this.queue = [];
    this.silentGateUntil = 0;
    this.speech.stop();
    this.hooks.onCaption(null, { blockId: null, ask: false, phase: 'pending' });
  }

  private now(): number {
    return this.hooks.now ? this.hooks.now() : Date.now();
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return this.hooks.sleep ? this.hooks.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const gen = this.generation;
    try {
      while (this.queue.length > 0 && gen === this.generation) {
        const beat = this.queue.shift()!;
        if (beat.kind === 'speech') {
          await this.sleep(this.silentGateUntil - this.now());
          if (gen !== this.generation) return;
          this.hooks.onCaption(beat.text, { blockId: beat.blockId, ask: beat.ask, phase: 'pending' });
          const started = await this.speech.speak(beat.text);
          if (gen !== this.generation) return;
          this.lastSpeechStartAt = this.now();
          this.hooks.onCaption(beat.text, { blockId: beat.blockId, ask: beat.ask, phase: 'speaking' });
          if (!started) {
            const est = (this.hooks.estimateMs ?? estimateSpeechMs)(beat.text);
            this.silentGateUntil = this.now() + est;
          }
        } else if (beat.kind === 'reveal') {
          const earliest = Math.max(this.lastRevealAt + STAGGER_MS, this.lastSpeechStartAt + LEAD_MS);
          await this.sleep(earliest - this.now());
          if (gen !== this.generation) return;
          this.hooks.onReveal(beat.segmentId, beat.blockId);
          this.lastRevealAt = this.now();
        } else if (beat.kind === 'student') {
          // 学生开口：老师上一句说完再放进记录，停半拍
          await this.sleep(400);
          if (gen !== this.generation) return;
          this.hooks.onStudent?.(beat.text);
          this.silentGateUntil = this.now() + 900;
        } else if (beat.name === 'pause') {
          const seconds = Number(beat.args.s ?? beat.args.seconds ?? 1);
          await this.sleep(Math.min(5000, Math.max(200, (Number.isFinite(seconds) ? seconds : 1) * 1000)));
        } else {
          this.hooks.onCue(beat.name, beat.args);
        }
      }
      if (gen === this.generation && this.queue.length === 0) this.hooks.onDrain?.();
    } finally {
      this.pumping = false;
      if (this.queue.length > 0 && gen === this.generation) void this.pump();
    }
  }
}

/** 中日英句末标点切句；tool 边界 / 块闭合 flush 尾巴 */
export class SentenceCutter {
  private buffer = '';

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const m = /[。！？；!?;…]+(?=\s|$|[^。！？；!?;…])/.exec(this.buffer);
      if (!m) break;
      const end = m.index + m[0].length;
      const sentence = this.buffer.slice(0, end).trim();
      if (sentence) out.push(sentence);
      this.buffer = this.buffer.slice(end);
    }
    return out;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest || null;
  }

  reset(): void {
    this.buffer = '';
  }
}

/** 口播里偶发的标签 / markdown 记号 / LaTeX，读出来会怪：公式先换成能念的中文，再剥记号 */
export function cleanSpeechText(text: string): string {
  return speakableText(text.replace(/<[^>]+>/g, ''))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/[`#*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
