'use client';

/**
 * pcm-stream-audio — 流式 PCM 的 Web Audio 播放句柄（speech-pipeline 的第二种音频源，2026-09-11）。
 *
 * /api/teach/tts `stream:true` 返回 audio/pcm 分片（24kHz / 16bit / 单声道）：分片到一片就 createBuffer +
 * start(nextStart)，首尾相接；首片实测 0.4s 到——「讲给同桌听」评委开口从"等整句合成完（2~3s）"变成半秒内出声。
 * 与 HTMLAudio 句柄同一个 SpeechAudioHandle 契约，TeachSpeechPlayer 不区分两种源。
 *
 * 自动播放策略：AudioContext 要在用户手势里建好 / 唤醒（unlockSpeechAudioContext，讲给同桌听在「开始讲」里调）；
 * play() 时 context 仍不 running 就 reject，播放器按"这句跳过"处理，与 HTMLAudio 被拒的行为一致。
 */

export interface SpeechAudioHandle {
  play(): Promise<void>;
  pause(): void;
  /** 播放结束回调（播放器赋值） */
  onended: (() => void) | null;
  /** 语速（1 = 原速）；不实现则忽略 */
  setRate?(rate: number): void;
}

/** 流式 PCM 源：/api/teach/tts `stream:true` 的 audio/pcm 响应体，边到边播 */
export interface PcmStreamSource {
  kind: 'pcm-stream';
  sampleRate: number;
  channels: number;
  body: ReadableStream<Uint8Array>;
  /** 首片调度进声卡那一刻（延迟打点用） */
  onFirstChunk?: () => void;
}

export function isPcmStreamSource(source: unknown): source is PcmStreamSource {
  return typeof source === 'object' && source !== null && (source as PcmStreamSource).kind === 'pcm-stream';
}

/** 句柄只用到 AudioContext 的这几样，测试注入假实现 */
export type SpeechAudioContextLike = Pick<AudioContext, 'currentTime' | 'state' | 'resume' | 'createBuffer' | 'createBufferSource' | 'destination'>;

let speechContext: AudioContext | null = null;

/**
 * 流式播放用的共享 AudioContext。在用户手势里调一次把它建好并唤醒，之后的程序化调度才不会被自动播放策略挂起；
 * 拿不到 Web Audio（SSR / 老环境）返回 null。
 */
export function unlockSpeechAudioContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
  speechContext ??= new window.AudioContext();
  if (speechContext.state === 'suspended') void speechContext.resume().catch(() => undefined);
  return speechContext;
}

/** 把一片 16bit PCM 字节转成 AudioBuffer（frames = 0 时返回 null） */
function pcmChunkToBuffer(context: SpeechAudioContextLike, bytes: Uint8Array, sampleRate: number, channels: number): AudioBuffer | null {
  const frames = Math.floor(bytes.byteLength / (2 * channels));
  if (frames <= 0) return null;
  // 拷到对齐的 ArrayBuffer 上再按 Int16 读（分片的 byteOffset 不一定是偶数）
  const aligned = new Uint8Array(frames * channels * 2);
  aligned.set(bytes.subarray(0, aligned.byteLength));
  const samples = new Int16Array(aligned.buffer);
  const buffer = context.createBuffer(channels, frames, sampleRate);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < frames; i += 1) data[i] = samples[i * channels + channel] / 32768;
  }
  return buffer;
}

/** 首片起播的提前量：给调度留一点余量，太小会在 start(when) 已过去时被当作"立刻"而与上一片重叠 */
export const STREAM_LEAD_S = 0.03;

/**
 * 流式 PCM 句柄：分片到一片就调度一片，首尾相接；流结束且最后一片播完 → onended。
 * pause() 是停止（播放器只在打断 / 静音时调，没有续播语义）：取消读取、停掉已调度的片、不再回调 onended。
 * setRate 走 playbackRate（会变音高）——评委席语速固定 1，/teach 的变速仍走 HTMLAudio 句柄。
 */
export function createPcmStreamAudio(source: PcmStreamSource, rate = 1, contextOverride?: SpeechAudioContextLike): SpeechAudioHandle {
  const context: SpeechAudioContextLike | null = contextOverride ?? unlockSpeechAudioContext();
  const nodes: AudioBufferSourceNode[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let carry = new Uint8Array(0);
  let nextStart = 0;
  let scheduled = 0;
  let ended = 0;
  let streamDone = false;
  let stopped = false;
  let currentRate = rate;
  const frameBytes = 2 * Math.max(1, source.channels);

  const handle: SpeechAudioHandle = {
    play: async () => {
      if (!context) throw new Error('Web Audio unavailable');
      if (context.state !== 'running') {
        await context.resume();
        if ((context.state as string) !== 'running') throw new Error('AudioContext locked');
      }
      reader = source.body.getReader();
      void pump();
    },
    pause: () => {
      stopped = true;
      reader?.cancel().catch(() => undefined);
      for (const node of nodes) {
        try {
          node.stop();
        } catch {
          /* 还没 start 或已结束 */
        }
      }
      nodes.length = 0;
    },
    onended: null,
    setRate: (value) => {
      currentRate = value;
      for (const node of nodes) node.playbackRate.value = value;
    },
  };

  const maybeFinish = () => {
    if (stopped || !streamDone || ended < scheduled) return;
    stopped = true;
    handle.onended?.();
  };

  const schedule = (bytes: Uint8Array) => {
    if (!context || stopped) return;
    const joined = new Uint8Array(carry.byteLength + bytes.byteLength);
    joined.set(carry, 0);
    joined.set(bytes, carry.byteLength);
    const usable = joined.byteLength - (joined.byteLength % frameBytes);
    carry = joined.subarray(usable);
    const buffer = pcmChunkToBuffer(context, joined.subarray(0, usable), source.sampleRate, source.channels);
    if (!buffer) return;
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = currentRate;
    node.connect(context.destination);
    const now = context.currentTime;
    if (nextStart < now + STREAM_LEAD_S) nextStart = now + STREAM_LEAD_S; // 首片 / 断供后从现在接着播
    node.start(nextStart);
    nextStart += buffer.duration / currentRate;
    scheduled += 1;
    node.onended = () => {
      ended += 1;
      maybeFinish();
    };
    nodes.push(node);
    if (scheduled === 1) source.onFirstChunk?.();
  };

  const pump = async () => {
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (stopped) return;
        if (value && value.byteLength > 0) schedule(value);
        if (done) break;
      }
    } catch {
      /* 读取被取消 / 网络断：已调度的片照常播完 */
    }
    streamDone = true;
    maybeFinish();
  };

  return handle;
}
