// M3 T3.3 — Tutor Agent Loop endpoint (new, side-by-side with /api/tutor)
//
// 用 Vercel AI SDK v6 的 streamText + tools + stopWhen + onStepFinish 把
// Tutor 升级成"会用工具的同桌"。
//
// 和 /api/tutor/route.ts 并存，不破坏现有调用路径。前端通过 feature flag
// 切换。M3 跑稳后可以把旧 endpoint 废弃。
//
// 设计原则（来自调研 #2）：
//   - 单 agent + 工具调用（不引入 LangGraph）
//   - stopWhen: stepCountIs(6) 防止无限循环
//   - onStepFinish 打 track() 埋点，Sentry vercelAIIntegration 自动吸收
//   - 前端用 AI SDK useChat + toUIMessageStreamResponse
//
// 注意：这个 endpoint 只是骨架。实际部署需要：
//   - 配好 OPENAI_API_KEY 或等效（DashScope 走 OpenAI-compatible mode）
//   - 前端配置 /api/tutor/agent 作为 useChat endpoint
//   - 灰度：feature flag 里 `tutor.agentLoop: true/false/percentage`

import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createTutorTools } from '@/lib/tutor/tutor-tools';
import { TUTOR_SYSTEM_CURRENT, PROMPT_VERSIONS } from '@/lib/prompts/tutor-prompts';
import { createLogger, track } from '@/lib/logger';

const log = createLogger('tutor-agent');

export const runtime = 'nodejs';
export const maxDuration = 120;

const TranscriptSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  confidence: z.number().optional().default(0.9),
});

const BodySchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().optional(),
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string().optional(),
      parts: z.array(z.any()).optional(),
    }),
  ),
  sessionId: z.string().default('anon'),
  transcript: z.array(TranscriptSegmentSchema).default([]),
  subject: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const rateLimit = await applyRateLimit(request, 'tutor');
  if (rateLimit) return rateLimit;

  const startedAt = Date.now();
  let sessionId = 'anon';
  try {
    const raw = (await request.json()) as unknown;
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_BAD_REQUEST', errorMsg: parsed.error.message });
      return new Response(JSON.stringify({ error: 'bad request', detail: parsed.error.message }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    const { messages, transcript, subject } = parsed.data;
    sessionId = parsed.data.sessionId;

    const apiKey = process.env.OPENAI_API_KEY ?? process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_NO_API_KEY' });
      return new Response(JSON.stringify({ error: 'LLM API key not configured' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    // 用 OpenAI provider + DashScope compatible-mode
    //   (Qwen3-Max 通过 OpenAI-compatible API 走 streamText)
    const baseURL =
      process.env.TUTOR_BASE_URL ??
      process.env.LLM_BASE_URL ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const modelId = process.env.TUTOR_MODEL ?? 'qwen-max';
    const openai = createOpenAI({ apiKey, baseURL });
    const model = openai(modelId);

    const tools = createTutorTools({ sessionId, transcript, subject, model: modelId });

    track({ kind: 'tutor.step', sessionId, step: 0, stepType: 'start', toolCalls: [] });

    const result = streamText({
      model,
      system: TUTOR_SYSTEM_CURRENT.content,
      messages: await convertToModelMessages(messages as UIMessage[]),
      tools,
      stopWhen: stepCountIs(6),
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'tutor.agent',
        metadata: {
          promptVersion: PROMPT_VERSIONS.tutorSystem,
          sessionId,
          subject: subject ?? '',
        },
      },
      onStepFinish(step) {
        const toolCalls = step.toolCalls ?? [];
        track({
          kind: 'tutor.step',
          sessionId,
          step: 0,
          stepType: toolCalls.length > 0 ? 'tool-call' : 'assistant',
          toolCalls: toolCalls.map((t) => t.toolName),
          usage: step.usage,
        });
        log.debug('step', {
          tools: toolCalls.map((t) => t.toolName),
          tokens: step.usage,
        });
      },
      onError({ error }) {
        const msg = error instanceof Error ? error.message : String(error);
        track({
          kind: 'tutor.fail',
          sessionId,
          errorCode: 'TUTOR_STREAM_ERROR',
          errorMsg: msg,
        });
        log.error('streamText error', { sessionId, err: msg });
      },
    });

    // toUIMessageStreamResponse 会把 streamText 的 step 事件、tool-call、tool-result
    // 都以 AI SDK v6 协议帧流式发给前端。前端用 useChat 原生消费。
    return result.toUIMessageStreamResponse({
      // 可选：sendReasoning: true 如果模型支持
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    log.error('fatal', { sessionId, msg });
    track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_FATAL', errorMsg: msg });
    return new Response(
      JSON.stringify({ error: 'tutor agent failed', detail: msg, durationMs }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}
