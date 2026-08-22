// 清小搭 chat/completions SSE 公共件 — OpenAI chunk/usage 形态与编码
//
// route.ts（无音频流式 / 非流式）与 audio-progress-stream.ts（含音频流式）
// 共用，保证 reasoning 帧 / content 帧 / stop 帧结构一致。

export const COMPAT_MODEL_ID = 'shangchangqian';

export type CompatFinishReason = 'stop' | 'length';

export interface CompatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export function mapFinishReason(finishReason: unknown): CompatFinishReason {
  return finishReason === 'length' ? 'length' : 'stop';
}

export function mapUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined): CompatUsage {
  const prompt = usage?.inputTokens ?? 0;
  const completion = usage?.outputTokens ?? 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: usage?.totalTokens ?? prompt + completion };
}

export function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** SSE 响应头（两条流式路径一致：禁缓冲、禁变换）。 */
export const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'X-Accel-Buffering': 'no',
  'Cache-Control': 'no-cache, no-transform',
} as const;
