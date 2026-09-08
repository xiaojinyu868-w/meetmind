import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const liveTask = '今天继续学条件概率。请给我一道适合我的下一步练习，先只出题和一个思考提示，不给答案，控制在 180 字以内。';

/** Consume the application's actual UI SSE, including its terminal finish reason. */
export async function liveTutor(base: string, token: string, personal: boolean) {
  const started = Date.now();
  const response = await fetch(`${base}/api/tutor/agent`, {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'global', model: 'qwen-plus', sessionId: `context-live-${randomUUID()}`,
      messages: [{ id: randomUUID(), role: 'user', content: liveTask }],
      context: { global: { depth: 'quick', ...(personal ? { memories: [] } : {}) } } }),
  });
  assert.equal(response.status, 200, `tutor_http_${response.status}`);
  assert(response.headers.get('content-type')?.includes('text/event-stream'), 'tutor_requires_sse');
  const wire = await response.text();
  let answer = '';
  let finishReason: string | undefined;
  for (const line of wire.split(/\r?\n/)) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
    const frame = JSON.parse(line.slice(6)) as { type: string; delta?: string; finishReason?: string };
    assert.notEqual(frame.type, 'error', 'tutor_stream_error');
    if (frame.type === 'text-delta') answer += frame.delta ?? '';
    if (frame.type === 'finish') finishReason = frame.finishReason;
  }
  assert(answer.trim(), 'tutor_empty_answer');
  assert.equal(finishReason, 'stop', `tutor_incomplete_${finishReason}`);
  return { answer, finishReason, durationMs: Date.now() - started, personalContext: personal, task: liveTask };
}
