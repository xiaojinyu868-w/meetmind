/**
 * teach-tts-stream — 讲课声音流式合成的纯函数（SSE 帧解析 / PCM ↔ WAV），前后端共用，禁止 Node 侧依赖。
 *
 * 百炼 qwen3-tts 系列开 `X-DashScope-SSE: enable` + `parameters.stream=true` 后，音频以 base64 PCM
 * （24kHz / 16bit / 单声道）分片放在每个事件的 `output.audio.data` 里，最后一个事件才给整段 `output.audio.url`。
 * 2026-09-11 实测：首片 0.4s 到（不流式要等整句合成完 2.2s 再回源下载）——「讲给同桌听」评委开口靠它压到通话感。
 *
 * 这里只做字节层的事：把 SSE 文本切成事件、抠出 PCM 片；把 PCM 包成 WAV（进缓存）、从 WAV 抠出 PCM（缓存命中也能流式发）。
 */

export const TEACH_TTS_PCM_SAMPLE_RATE = 24_000;
export const TEACH_TTS_PCM_CHANNELS = 1;
export const TEACH_TTS_PCM_BITS = 16;

export interface SsePcmParse {
  /** 本次切出的 PCM 片（按到达顺序） */
  chunks: Uint8Array[];
  /** 还没凑齐一个事件的尾巴，下次拼在前面 */
  rest: string;
  /** 上游报错（code / message） */
  error: string | null;
  /** 收到 finish_reason（整段合成结束） */
  finished: boolean;
}

interface TtsSseEvent {
  output?: { audio?: { data?: string; url?: string }; finish_reason?: string | null };
  code?: string;
  message?: string;
}

function decodeBase64(data: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(data);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  // Node（无 atob 的旧运行时）
  return new Uint8Array(Buffer.from(data, 'base64'));
}

/**
 * 增量解析 SSE 文本：`carry` 是上次剩下的尾巴，`chunk` 是新到的文本。事件以空行分隔，每个事件里取 `data:` 行。
 * 半截事件留在 rest 里；解析失败的行跳过（不因一行坏 JSON 丢整段音频）。
 */
export function parseTtsSseChunk(carry: string, chunk: string): SsePcmParse {
  const buffer = carry + chunk;
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const chunks: Uint8Array[] = [];
  let error: string | null = null;
  let finished = false;
  for (const block of blocks) {
    const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    let event: TtsSseEvent;
    try {
      event = JSON.parse(dataLine.slice(5).trim()) as TtsSseEvent;
    } catch {
      continue;
    }
    if (event.code) {
      error = event.message ?? event.code;
      continue;
    }
    const data = event.output?.audio?.data;
    if (data) chunks.push(decodeBase64(data));
    if (event.output?.finish_reason) finished = true;
  }
  return { chunks, rest, error, finished };
}

/** 把裸 PCM 包成 44 字节头的 WAV（进两级缓存，与非流式路径的产物同一格式） */
export function pcmToWav(pcm: Uint8Array, sampleRate = TEACH_TTS_PCM_SAMPLE_RATE, channels = TEACH_TTS_PCM_CHANNELS, bits = TEACH_TTS_PCM_BITS): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  const blockAlign = (channels * bits) / 8;
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export interface WavPayload {
  sampleRate: number;
  channels: number;
  bits: number;
  pcm: Uint8Array;
}

/**
 * 从 WAV 里抠出 PCM 与格式（沿 chunk 链找 fmt / data，不假定头是 44 字节——上游回源的 wav 可能带 LIST 块）。
 * 不是 PCM WAV / 结构坏了 → null（调用方退回整块发）。
 */
export function wavPcmPayload(wav: Uint8Array): WavPayload | null {
  if (wav.byteLength < 12) return null;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...wav.subarray(offset, offset + length));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
  let offset = 12;
  let format: { sampleRate: number; channels: number; bits: number } | null = null;
  while (offset + 8 <= wav.byteLength) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (body + 16 > wav.byteLength) return null;
      const audioFormat = view.getUint16(body, true);
      if (audioFormat !== 1) return null;
      format = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!format) return null;
      const end = Math.min(wav.byteLength, body + size);
      return { ...format, pcm: wav.subarray(body, end) };
    }
    offset = body + size + (size % 2); // chunk 按 2 字节对齐
  }
  return null;
}
