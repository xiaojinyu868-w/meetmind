import { describe, expect, it } from 'vitest';
import { createPcmStreamAudio, isPcmStreamSource, STREAM_LEAD_S, type PcmStreamSource, type SpeechAudioContextLike } from './pcm-stream-audio';

interface FakeNode {
  buffer: { duration: number; frames: number; samples: number[] } | null;
  startedAt: number | null;
  stopped: boolean;
  playbackRate: { value: number };
  onended: (() => void) | null;
}

/** 假 AudioContext：记录每片的调度时刻；currentTime 由测试推进 */
function fakeContext(initialState: AudioContextState = 'running') {
  const nodes: FakeNode[] = [];
  const context = {
    currentTime: 0,
    state: initialState,
    destination: {} as AudioDestinationNode,
    resume: async () => {
      context.state = 'running';
    },
    createBuffer: (channels: number, frames: number, sampleRate: number) => {
      const data = new Float32Array(frames);
      return {
        duration: frames / sampleRate,
        numberOfChannels: channels,
        length: frames,
        sampleRate,
        getChannelData: () => data,
      } as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const node: FakeNode = { buffer: null, startedAt: null, stopped: false, playbackRate: { value: 1 }, onended: null };
      const api = {
        set buffer(value: AudioBuffer) {
          const data = value.getChannelData(0);
          node.buffer = { duration: value.duration, frames: value.length, samples: Array.from(data) };
        },
        get buffer() {
          return null;
        },
        playbackRate: node.playbackRate,
        connect: () => undefined,
        start: (when: number) => {
          node.startedAt = when;
        },
        stop: () => {
          node.stopped = true;
          node.onended?.();
        },
        set onended(handler: (() => void) | null) {
          node.onended = handler;
        },
        get onended() {
          return node.onended;
        },
      };
      nodes.push(node);
      return api as unknown as AudioBufferSourceNode;
    },
  };
  return { context: context as unknown as SpeechAudioContextLike & { currentTime: number; state: AudioContextState }, nodes };
}

/** 16bit 小端 PCM：每个样本一个 Int16 */
function pcm(samples: number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return out;
}

function streamOf(chunks: Uint8Array[]): { body: ReadableStream<Uint8Array>; release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      await gate;
      controller.close();
    },
  });
  return { body, release };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPcmStreamAudio', () => {
  it('分片首尾相接调度；跨片的半个样本留到下一片；首片回调一次', async () => {
    const { context, nodes } = fakeContext();
    const first = pcm([1000, -1000, 500]); // 3 帧 = 6 字节
    const odd = new Uint8Array([...pcm([200, 300]), 0x34]); // 2 帧 + 半个样本的低字节
    const rest = new Uint8Array([0x12, ...pcm([400])]); // 高字节 0x12 → 与上一片的 0x34 拼成 0x1234；再 1 帧
    const { body, release } = streamOf([first, odd, rest]);
    let firstChunkCalls = 0;
    const source: PcmStreamSource = { kind: 'pcm-stream', sampleRate: 24_000, channels: 1, body, onFirstChunk: () => { firstChunkCalls += 1; } };
    const handle = createPcmStreamAudio(source, 1, context);
    let endedCalls = 0;
    handle.onended = () => { endedCalls += 1; };
    await handle.play();
    await tick();
    await tick();

    expect(nodes).toHaveLength(3);
    expect(nodes[0].buffer?.frames).toBe(3);
    expect(nodes[0].startedAt).toBeCloseTo(STREAM_LEAD_S, 6);
    expect(nodes[1].buffer?.frames).toBe(2);
    expect(nodes[1].startedAt).toBeCloseTo(STREAM_LEAD_S + 3 / 24_000, 9);
    expect(nodes[2].buffer?.frames).toBe(2); // 拼回来的 0x1234 + 400
    expect(nodes[2].startedAt).toBeCloseTo(STREAM_LEAD_S + 5 / 24_000, 9);
    expect(nodes[2].buffer?.samples[0]).toBeCloseTo(0x1234 / 32768, 6);
    expect(nodes[0].buffer?.samples[1]).toBeCloseTo(-1000 / 32768, 6);
    expect(firstChunkCalls).toBe(1);
    expect(endedCalls).toBe(0); // 流还没关

    release();
    await tick();
    await tick();
    expect(endedCalls).toBe(0); // 流关了但片还在播
    nodes.forEach((node) => node.onended?.());
    expect(endedCalls).toBe(1);
  });

  it('片到晚了（上一片已播完）：从当前时刻接着播，不往过去调度', async () => {
    const { context, nodes } = fakeContext();
    const chunks: Uint8Array[] = [];
    let push: ((chunk: Uint8Array | null) => void) | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => (chunk ? controller.enqueue(chunk) : controller.close());
      },
    });
    void chunks;
    const handle = createPcmStreamAudio({ kind: 'pcm-stream', sampleRate: 24_000, channels: 1, body }, 1, context);
    await handle.play();
    push!(pcm(new Array(240).fill(100))); // 10ms
    await tick();
    await tick();
    expect(nodes[0].startedAt).toBeCloseTo(STREAM_LEAD_S, 6);
    context.currentTime = 2; // 声卡时间早已越过上一片的结束
    push!(pcm(new Array(24).fill(100)));
    await tick();
    await tick();
    expect(nodes[1].startedAt).toBeCloseTo(2 + STREAM_LEAD_S, 6);
    push!(null);
  });

  it('pause = 停止：停掉已调度的片、取消读取，不再回调 onended', async () => {
    const { context, nodes } = fakeContext();
    const { body, release } = streamOf([pcm([1, 2, 3, 4])]);
    const handle = createPcmStreamAudio({ kind: 'pcm-stream', sampleRate: 24_000, channels: 1, body }, 1, context);
    let endedCalls = 0;
    handle.onended = () => { endedCalls += 1; };
    await handle.play();
    await tick();
    expect(nodes).toHaveLength(1);
    handle.pause();
    expect(nodes[0].stopped).toBe(true);
    release();
    await tick();
    await tick();
    expect(endedCalls).toBe(0);
  });

  it('AudioContext 被自动播放策略挂起且唤不醒 → play 拒绝（播放器按跳过这句处理）', async () => {
    const { context } = fakeContext('suspended');
    (context as { resume: () => Promise<void> }).resume = async () => undefined; // 唤不醒
    const { body } = streamOf([pcm([1])]);
    const handle = createPcmStreamAudio({ kind: 'pcm-stream', sampleRate: 24_000, channels: 1, body }, 1, context);
    await expect(handle.play()).rejects.toThrow(/locked/);
  });

  it('isPcmStreamSource 只认 kind 标记', () => {
    expect(isPcmStreamSource({ kind: 'pcm-stream', sampleRate: 24_000, channels: 1, body: new ReadableStream() })).toBe(true);
    expect(isPcmStreamSource(new Blob(['x']))).toBe(false);
    expect(isPcmStreamSource(null)).toBe(false);
  });
});
