'use client';

/**
 * speech-pipeline — /teach 讲课声音的前端流水线。
 *
 * text-delta 流 → SentenceSplitter 按句切分（句末标点收尾；tool-call /
 * turn 结束视为自然断句——"说完一句就落笔"）→ TeachSpeechPlayer 顺序播放：
 * 播第 i 句时并行请求第 i+1 句合成（POST /api/teach/tts），盖住上游 1-3s
 * 的合成延迟。interrupt = 老师立刻闭嘴：停播 + 清空队列与预取。
 *
 * 自动播放策略：unlock() 在用户手势（新开一课/发送消息）里调用，之后的
 * 程序化 play() 即被允许；play() 仍被拒时静默跳过（不打扰讲课流）。
 * 历史回放不喂这条管线（replay 事件在 hook 层就被拦住）。
 */

/** 句末标点（中日英）：这些字符收尾算一句 */
const SENTENCE_END = /[。！？；!?;]\s*$/;

export class SentenceSplitter {
  private buffer = '';

  /** 喂一段增量文本，返回新凑齐的整句（0~n 句） */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      const match = /[。！？；!?;]/.exec(this.buffer);
      if (!match) break;
      const end = match.index + 1;
      const sentence = this.buffer.slice(0, end).trim();
      if (sentence) out.push(sentence);
      this.buffer = this.buffer.slice(end);
    }
    return out;
  }

  /** 自然断句点（tool-call / turn 结束）：把不足一句的尾巴也交出来 */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest || null;
  }

  /** buffer 里是否就是完整一句（hook 调试用） */
  get pendingEndsSentence(): boolean {
    return SENTENCE_END.test(this.buffer);
  }

  reset(): void {
    this.buffer = '';
  }
}

export interface SpeechAudioHandle {
  play(): Promise<void>;
  pause(): void;
  /** 播放结束回调（播放器赋值） */
  onended: (() => void) | null;
}

interface TeachSpeechPlayerOptions {
  /** 拉一句音频（默认 POST /api/teach/tts → Blob）；null = 该句跳过 */
  fetchAudio?: (text: string) => Promise<Blob | null>;
  /** 构造播放句柄（测试注入假实现） */
  createAudio?: (blob: Blob) => SpeechAudioHandle;
  /** 状态变化（playing/speaking 指示用） */
  onSpeakingChange?: (speaking: boolean) => void;
  /**
   * 声画联动闸门：句子开始播放（或合成失败被跳过）时回调其序号。
   * useTeachSession 据此放行"这句开讲才上板"的板书动作。
   */
  onSentenceStart?: (seq: number) => void;
}

async function defaultFetchAudio(text: string): Promise<Blob | null> {
  try {
    const response = await fetch('/api/teach/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

function defaultCreateAudio(blob: Blob): SpeechAudioHandle {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const handle: SpeechAudioHandle = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    onended: null,
  };
  audio.onended = () => {
    URL.revokeObjectURL(url);
    handle.onended?.();
  };
  return handle;
}

export class TeachSpeechPlayer {
  private readonly fetchAudio: (text: string) => Promise<Blob | null>;
  private readonly createAudio: (blob: Blob) => SpeechAudioHandle;
  private readonly onSpeakingChange?: (speaking: boolean) => void;
  private readonly onSentenceStart?: (seq: number) => void;
  private queue: Array<{ text: string; seq: number }> = [];
  /** 预取中的下一句（句子文本 → 在飞的合成请求） */
  private prefetch = new Map<string, Promise<Blob | null>>();
  private current: SpeechAudioHandle | null = null;
  private playing = false;
  private muted = false;
  private unlocked = false;
  /** 句子递增序号（入队即分配；声画联动的锚） */
  private seqCounter = 0;
  /** 停止令牌：stopAll 后让在飞的播放循环退出 */
  private generation = 0;

  constructor(options: TeachSpeechPlayerOptions = {}) {
    this.fetchAudio = options.fetchAudio ?? defaultFetchAudio;
    this.createAudio = options.createAudio ?? defaultCreateAudio;
    this.onSpeakingChange = options.onSpeakingChange;
    this.onSentenceStart = options.onSentenceStart;
  }

  /** 用户手势里调用：激活后续程序化播放 */
  unlock(): void {
    this.unlocked = true;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopAll();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** 语音链路活着（已手势激活且未静音）——否则板书不该等声音 */
  get isActive(): boolean {
    return this.unlocked && !this.muted;
  }

  /** 已入队句子的最新序号（tool-call 的"前面最后一句"闸门取它） */
  get lastSeq(): number {
    return this.seqCounter;
  }

  enqueue(sentence: string): void {
    const text = sentence.trim();
    if (!text || this.muted) return;
    this.seqCounter += 1;
    this.queue.push({ text, seq: this.seqCounter });
    void this.pump();
  }

  /** interrupt：立刻停播 + 清空队列与预取 */
  stopAll(): void {
    this.generation += 1;
    this.queue = [];
    this.prefetch.clear();
    this.current?.pause();
    this.current = null;
    this.setPlaying(false);
  }

  private setPlaying(value: boolean): void {
    if (this.playing === value) return;
    this.playing = value;
    this.onSpeakingChange?.(value);
  }

  /** 预取下一句（合成请求与当前播放并行） */
  private ensurePrefetch(text: string): Promise<Blob | null> {
    let pending = this.prefetch.get(text);
    if (!pending) {
      pending = this.fetchAudio(text);
      this.prefetch.set(text, pending);
    }
    return pending;
  }

  private async pump(): Promise<void> {
    if (this.playing || this.muted || !this.unlocked) return;
    const item = this.queue.shift();
    if (!item) return;
    const generation = this.generation;
    this.setPlaying(true);
    try {
      // 当前句：吃预取或现取；同时预取下一句
      const blob = await this.ensurePrefetch(item.text);
      if (this.queue[0]) void this.ensurePrefetch(this.queue[0].text);
      if (generation !== this.generation || this.muted) return;
      this.prefetch.delete(item.text);
      // 声画联动闸门：句子开始播放（或合成失败被跳过）= 放行锚到这句的板书
      this.onSentenceStart?.(item.seq);
      if (!blob) return; // 合成失败：跳过这句，继续下一句
      const handle = this.createAudio(blob);
      this.current = handle;
      const ended = new Promise<void>((resolve) => {
        handle.onended = resolve;
      });
      try {
        await handle.play();
      } catch {
        return; // 自动播放被拒等：跳过不打扰（闸门已放行，板书不卡）
      }
      if (generation !== this.generation || this.muted) {
        handle.pause();
        return;
      }
      await ended;
    } finally {
      if (generation === this.generation) {
        this.current = null;
        this.setPlaying(false);
        if (this.queue.length > 0) void this.pump();
      }
    }
  }
}
