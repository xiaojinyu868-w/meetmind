// M10 — Tutor Agent Loop endpoint（三个 AI 对话入口的**唯一**后端）
//
// 课堂同桌 / 录音复习 / 视频复习三条链路都打到这里。差别由 `mode` + `options`
// 显式表达，不再靠历史上"哪个路径用哪份 prompt"的偶然分叉。
//
// 请求契约（新）：
//   - mode: 'in-class' | 'review'  （必填）
//   - context: { recentFocus?, fullTranscript?, currentTimestampSec?, supportMaterials?, ... }
//   - options: { thinkingGuide?, returnTimestamps?, allowInlineApp? }
//   - transcript: TranscriptSegment[]（supplied for tool execution，不注入 prompt）
//   - messages: UIMessage[]
//   - sessionId: string
//   - subject?: string
//
// 响应：沿用 toUIMessageStreamResponse()（AI SDK v6 帧）——前端 useChat 和 classroom
// 同桌的 UIMessage reader 都能直接消费。
//
// 设计原则：
//   - 单 agent + 工具调用（不引入 LangGraph）
//   - stopWhen: stepCountIs(6) 防无限循环
//   - onStepFinish 打 track() 埋点
//   - prompt 来源：`src/lib/prompts/tutor-prompts.ts` 的 buildTutorSystemPrompt
//   - 老 `<open_app:KEY/>` marker 路径仍然由前端（extractOpenAppMarker）消费，本
//     endpoint 不对 marker 做任何处理（透传 model 输出）。
//   - Inline app 生成：由 options.allowInlineApp 控制 system prompt 里是否注入
//     marker 合约；marker 出现与否由 model 决定。native tool call 的 4 个工具
//     依然挂着（makeFlashcards 等），但两条路径都走，避免 session 中途因切换
//     而丢能力。

import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createTutorTools } from '@/lib/tutor/tutor-tools';
import {
  buildTutorSystemPrompt,
  PROMPT_VERSIONS,
  type TutorMode,
} from '@/lib/prompts/tutor-prompts';
import { createLogger, track } from '@/lib/logger';
import { resolveTutorAgentProviderConfig } from '@/lib/utils/tutor-agent-provider';

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

const SupportMaterialSchema = z.object({
  title: z.string(),
  content: z.string(),
});

const ContextSchema = z
  .object({
    courseId: z.string().optional(),
    lessonId: z.string().optional(),
    recentFocus: z.string().optional(),
    fullTranscript: z.string().optional(),
    currentTimestampSec: z.number().optional(),
    supportMaterials: z.array(SupportMaterialSchema).optional(),
    learnerProfile: z.string().optional(),
  })
  .default({});

const OptionsSchema = z
  .object({
    thinkingGuide: z.boolean().optional(),
    returnTimestamps: z.boolean().optional(),
    allowInlineApp: z.boolean().optional(),
  })
  .default({});

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
  subject: z.string().optional(),
  /**
   * Tool 执行用的原始 segments（不注入 prompt）。
   * Prompt 注入用 context.fullTranscript（review）或 context.recentFocus（in-class）。
   */
  transcript: z.array(TranscriptSegmentSchema).default([]),
  /** M10：mode 驱动 prompt 骨架。老客户端没传时 fallback 到 'review'（最宽容） */
  mode: z.enum(['in-class', 'review']).default('review'),
  context: ContextSchema,
  options: OptionsSchema,
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
    const { messages, transcript, subject, mode, context, options } = parsed.data;
    sessionId = parsed.data.sessionId;

    const provider = resolveTutorAgentProviderConfig(process.env);
    if (!provider.apiKey) {
      track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_NO_API_KEY' });
      return new Response(JSON.stringify({ error: 'LLM API key not configured' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { apiKey, baseURL, modelId } = provider;
    const openai = createOpenAI({ apiKey, baseURL });
    const model = openai(modelId);

    const tools = createTutorTools({ sessionId, transcript, subject, model: modelId });
    const systemPrompt = buildTutorSystemPrompt(mode as TutorMode, context, options);

    track({
      kind: 'tutor.step',
      sessionId,
      step: 0,
      stepType: 'start',
      toolCalls: [],
    });
    log.debug('start', {
      sessionId,
      mode,
      model: modelId,
      hasRecentFocus: Boolean(context.recentFocus),
      hasFullTranscript: Boolean(context.fullTranscript),
      options,
    });

    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages as UIMessage[]),
      tools,
      stopWhen: stepCountIs(6),
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'tutor.agent',
        metadata: {
          promptVersion: PROMPT_VERSIONS.tutorSystem,
          sessionId,
          mode,
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
