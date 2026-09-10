/**
 * pcm — 浏览器采集帧（Float32 [-1,1]）→ ASR 通道要的 16kHz / 16bit 单声道 PCM（纯函数）。
 *
 * 与 useVoiceInput / Recorder 里的就地实现同一算法（最近邻重采样 + 线性量化）；
 * 抽出来给「讲给同桌听」的常开麦克风复用，并有单测。AudioContext 不一定给 16k
 * （Safari 固定 48k、部分安卓 44.1k），所以重采样是必经之路。
 */

export const ASR_SAMPLE_RATE = 16_000;

/** 量化一个 [-1,1] 采样为 int16 */
export function quantizeSample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

/**
 * Float32 帧 → Int16 PCM，按需重采样到 outputRate（默认 16k）。
 * 采样率相差 <100Hz 视为同频，不重采样。
 */
export function floatToPcm16(input: Float32Array, inputRate: number, outputRate = ASR_SAMPLE_RATE): Int16Array {
  if (Math.abs(inputRate - outputRate) < 100) {
    const same = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) same[i] = quantizeSample(input[i]);
    return same;
  }
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(0, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const srcIndex = Math.min(Math.round(i * ratio), input.length - 1);
    output[i] = quantizeSample(input[srcIndex]);
  }
  return output;
}

/** 一帧的时长（ms） */
export function frameDurationMs(sampleCount: number, sampleRate: number): number {
  if (sampleRate <= 0) return 0;
  return (sampleCount / sampleRate) * 1000;
}
