import type { TranscriptSegment } from '@/types';
import { calculateSimilarity } from '@/lib/utils/transcript-utils';
import { DEDUP_SIMILARITY, DEDUP_GAP_MS } from './recorder-types';

/** 标准化文本用于去重比较：NFKC + 小写 + 去除标点/空白 */
export function normalizeCompareText(text: string): string {
  return (text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:"""'（）()【】\[\]-]/g, '');
}

/** 判断新 segment 是否应替换最后一个（去重逻辑） */
export function shouldReplaceLastSegment(last: TranscriptSegment, next: TranscriptSegment): boolean {
  const gap = Math.max(0, next.startMs - last.endMs);
  const overlap = next.startMs <= last.endMs;
  const similarity = calculateSimilarity(last.text, next.text);

  if (similarity >= DEDUP_SIMILARITY && (overlap || gap <= DEDUP_GAP_MS)) {
    return true;
  }

  const lastKey = normalizeCompareText(last.text);
  const nextKey = normalizeCompareText(next.text);
  return !!lastKey && lastKey === nextKey && (overlap || gap <= DEDUP_GAP_MS);
}

/** 将内部错误信息转换为用户友好文案 */
export function normalizeRecorderErrorMessage(message: string): string {
  const text = (message || '').trim();
  if (!text) return '录音出了点问题，请再试一次。';
  if (/session already started or finished or failed/i.test(text)) {
    return '实时转写刚刚在重连，稍等一秒再继续录就好。';
  }
  if (/公网地址|可访问的公网地址|PUBLIC_DOMAIN|PUBLIC_HOST/i.test(text)) {
    return '当前环境没配公网转写地址，这段原声会先留住，但暂时还转不成文字。';
  }
  return text;
}

/** 格式化毫秒为 MM:SS 或 HH:MM:SS */
export function formatRecorderTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
  }
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

/** 音频重采样（线性插值）：将 Float32Array 从 fromRate 转换到 toRate */
export function resamplePcm(inputData: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return inputData;
  const ratio = fromRate / toRate;
  const newLength = Math.round(inputData.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
    const t = srcIndex - srcIndexFloor;
    result[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
  }
  return result;
}

/** 将 Float32Array PCM 数据转换为 Int16Array（供 ASR WebSocket 发送） */
export function float32ToInt16(input: Float32Array): Int16Array {
  const pcmData = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(input[i] * 32768)));
  }
  return pcmData;
}
