/**
 * draw-repair —— <draw> 脚本自愈：前端预跑报错 → 让模型只修出错的那一段。
 *
 * 为什么在服务端：key 不能到浏览器。为什么是单独一次小调用而不是塞进下一轮：修复要在
 * 学生看到这张图之前完成（脚本到达到被揭示之间通常有几秒到几十秒的口播），一次几百 token、
 * 1–2 秒的调用正好藏在这段时间里；下一轮才修等于让学生先看到一张空图。
 *
 * 不进课堂记录、不进模型历史（模型历史里仍是它原来写的脚本；同一张图后续 into 追加时，
 * 前端会用修好的文本一起重跑，所以不受影响）。每线程限次，防止一张烂脚本反复烧额度。
 */

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createLogger } from '@/lib/logger';
import { resolveTeachLiveProvider, teachProviderApiKey } from '@/lib/config/teach.config';
import { buildDrawRepairPrompt } from '@/lib/prompts/teach-live-prompt';
import { runDraw } from '@/lib/teach-live-draw/runtime';
import { cleanScript } from '@/lib/teach-live-draw/runtime';

const log = createLogger('teach-live-repair');

const MAX_REPAIRS_PER_THREAD = 40;
const MAX_CHUNK_CHARS = 6000;

interface RepairState {
  count: Map<string, number>;
}
const globalForRepair = globalThis as unknown as { __teachLiveRepair?: RepairState };
const state: RepairState = globalForRepair.__teachLiveRepair ?? { count: new Map() };
globalForRepair.__teachLiveRepair = state;

export class DrawRepairError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface DrawRepairResult {
  script: string;
  /** 修好后在服务端复跑一遍的结果：true = 无错 */
  verified: boolean;
  error?: string;
}

/** 修出错的第 index 段；返回修正后的脚本（服务端已复跑验证）。 */
export async function repairDrawScript(threadId: string, chunks: string[], index: number, error: string): Promise<DrawRepairResult> {
  const provider = resolveTeachLiveProvider();
  const apiKey = teachProviderApiKey(provider);
  if (!apiKey) throw new DrawRepairError('provider-unconfigured', `未配置 ${provider.apiKeyEnv}`, 500);
  if (!Array.isArray(chunks) || chunks.length === 0 || index < 0 || index >= chunks.length) {
    throw new DrawRepairError('bad-request', 'chunks / index 不合法', 400);
  }
  if (chunks.some((c) => typeof c !== 'string' || c.length > MAX_CHUNK_CHARS)) {
    throw new DrawRepairError('bad-request', '脚本过长', 400);
  }
  const used = state.count.get(threadId) ?? 0;
  if (used >= MAX_REPAIRS_PER_THREAD) throw new DrawRepairError('quota', '这节课的修图次数用完了', 429);
  state.count.set(threadId, used + 1);

  const { system, user } = buildDrawRepairPrompt(chunks, index, error.slice(0, 400));
  const openai = createOpenAI({ baseURL: provider.baseUrl, apiKey });
  const effort = provider.upstreamParams?.reasoning_effort;
  const startedAt = Date.now();
  const result = await generateText({
    model: openai.chat(provider.model),
    system,
    prompt: user,
    maxOutputTokens: 1500,
    temperature: 0.2,
    providerOptions: (typeof effort === 'string' ? { openai: { reasoningEffort: effort } } : undefined) as Parameters<typeof generateText>[0]['providerOptions'],
  });
  const script = cleanScript(result.text).replace(/^<draw[^>]*>/i, '').replace(/<\/draw>\s*$/i, '').trim();
  if (!script) throw new DrawRepairError('empty', '模型没有给出修正脚本', 502);

  const fixed = chunks.slice();
  fixed[index] = script;
  const check = runDraw(fixed, { fromChunk: index > 0 ? index : undefined });
  const verified = check.ok && !check.error;
  log.info('draw repair', {
    threadId,
    index,
    ms: Date.now() - startedAt,
    verified,
    error: verified ? undefined : check.ok ? check.error : check.error,
    outputTokens: result.usage?.outputTokens,
  });
  return { script, verified, ...(verified ? {} : { error: check.ok ? check.error : check.error }) };
}
