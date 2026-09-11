import { describe, expect, it } from 'vitest';
import { parseTtsSseChunk, pcmToWav, wavPcmPayload } from './teach-tts-stream';

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

describe('parseTtsSseChunk', () => {
  it('切出每个事件里的 PCM 片，按到达顺序；finish_reason 标结束', () => {
    const text = event({ output: { audio: { data: b64([1, 2, 3, 4]) } } })
      + event({ output: { audio: { data: b64([5, 6]) } } })
      + event({ output: { audio: { data: '', url: 'http://x/y.wav' }, finish_reason: 'stop' } });
    const parsed = parseTtsSseChunk('', text);
    expect(parsed.chunks.map((c) => Array.from(c))).toEqual([[1, 2, 3, 4], [5, 6]]);
    expect(parsed.finished).toBe(true);
    expect(parsed.error).toBeNull();
    expect(parsed.rest).toBe('');
  });

  it('半截事件留在 rest，下次拼上再解；id / 空行 / \\r\\n 都容忍', () => {
    const full = `id: 1\r\nevent: result\r\n${event({ output: { audio: { data: b64([9, 9]) } } })}`;
    const cut = full.length - 7;
    const first = parseTtsSseChunk('', full.slice(0, cut));
    expect(first.chunks).toHaveLength(0);
    expect(first.rest.length).toBeGreaterThan(0);
    const second = parseTtsSseChunk(first.rest, full.slice(cut));
    expect(second.chunks.map((c) => Array.from(c))).toEqual([[9, 9]]);
    expect(second.rest).toBe('');
  });

  it('上游报错事件给 error，坏 JSON 行跳过不影响其他片', () => {
    const text = 'data: {not json\n\n'
      + event({ code: 'Throttling.RateQuota', message: '限流' })
      + event({ output: { audio: { data: b64([7]) } } });
    const parsed = parseTtsSseChunk('', text);
    expect(parsed.error).toBe('限流');
    expect(parsed.chunks.map((c) => Array.from(c))).toEqual([[7]]);
  });
});

describe('pcmToWav / wavPcmPayload', () => {
  it('包成 44 字节头 WAV 再抠回来，格式与字节一致', () => {
    const pcm = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const wav = pcmToWav(pcm);
    expect(wav.byteLength).toBe(50);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    const payload = wavPcmPayload(wav);
    expect(payload).not.toBeNull();
    expect(payload?.sampleRate).toBe(24_000);
    expect(payload?.channels).toBe(1);
    expect(payload?.bits).toBe(16);
    expect(Array.from(payload!.pcm)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('带 LIST 块的 WAV 也能沿 chunk 链找到 data；非 PCM / 非 WAV 返回 null', () => {
    const pcm = new Uint8Array([10, 11, 12, 13]);
    const plain = pcmToWav(pcm, 16_000, 1, 16);
    // 在 fmt 与 data 之间插一个 LIST 块（4 字节内容）
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]);
    const withList = new Uint8Array(plain.byteLength + list.byteLength);
    withList.set(plain.subarray(0, 36), 0);
    withList.set(list, 36);
    withList.set(plain.subarray(36), 36 + list.byteLength);
    const payload = wavPcmPayload(withList);
    expect(payload?.sampleRate).toBe(16_000);
    expect(Array.from(payload!.pcm)).toEqual([10, 11, 12, 13]);

    expect(wavPcmPayload(new Uint8Array([1, 2, 3]))).toBeNull();
    const mp3ish = new Uint8Array(plain);
    mp3ish.set([0x49, 0x44, 0x33, 0x04], 0);
    expect(wavPcmPayload(mp3ish)).toBeNull();
    const nonPcm = new Uint8Array(plain);
    new DataView(nonPcm.buffer).setUint16(20, 3, true); // IEEE float
    expect(wavPcmPayload(nonPcm)).toBeNull();
  });
});
