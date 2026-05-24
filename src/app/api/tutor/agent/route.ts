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
//   - model?: string（设置页选择；不传则走服务端默认）
//
// 响应：使用 createUIMessageStreamResponse() 输出 AI SDK v6 帧——前端 useChat 和 classroom
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
//     marker 合约；marker 出现与否由 model 决定。课中不挂 native tools，轻产物
//     由前端拿 marker 后走 /api/apps/execute，减少首 token 延迟。

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
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
import {
  formatTutorAgentUserError,
  resolveTutorAgentProviderFallbacks,
  shouldFallbackTutorAgentError,
  type TutorAgentProviderConfig,
} from '@/lib/utils/tutor-agent-provider';

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
  model: z.string().optional(),
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

type ParsedTutorAgentBody = z.infer<typeof BodySchema>;

function getRawTutorAgentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function hasDeliveredAssistantOutput(chunk: UIMessageChunk): boolean {
  if (chunk.type.startsWith('data-')) return true;
  return [
    'text-start',
    'text-delta',
    'reasoning-start',
    'reasoning-delta',
    'source-url',
    'source-document',
    'file',
    'tool-input-available',
    'tool-output-available',
    'tool-output-error',
  ].includes(chunk.type);
}

function createTutorAttemptStream({
  providers,
  body,
  systemPrompt,
  modelMessages,
}: {
  providers: TutorAgentProviderConfig[];
  body: ParsedTutorAgentBody;
  systemPrompt: string;
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
}) {
  return createUIMessageStream<UIMessage>({
    onError: (error) => formatTutorAgentUserError(error),
    async execute({ writer }) {
      let attemptedProviderFallback = false;

      for (let attemptIndex = 0; attemptIndex < providers.length; attemptIndex += 1) {
        const provider = providers[attemptIndex];
        if (!provider.apiKey) continue;

        const { apiKey, baseURL, modelId } = provider;
        const openai = createOpenAI({ apiKey, baseURL });
        const model = openai.chat(modelId);
        const tools = createTutorTools({
          sessionId: body.sessionId,
          transcript: body.transcript,
          subject: body.subject,
          model: modelId,
          mode: body.mode as TutorMode,
        });
        let deliveredOutput = false;

        track({
          kind: 'tutor.step',
          sessionId: body.sessionId,
          step: attemptIndex,
          stepType: attemptIndex === 0 ? 'start' : 'provider-fallback',
          toolCalls: [],
        });
        log.debug('start', {
          sessionId: body.sessionId,
          mode: body.mode,
          model: modelId,
          providerAttempt: attemptIndex + 1,
          providerAttempts: providers.length,
          hasRecentFocus: Boolean(body.context.recentFocus),
          hasFullTranscript: Boolean(body.context.fullTranscript),
          options: body.options,
        });

        const result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(6),
          experimental_telemetry: {
            isEnabled: true,
            functionId: 'tutor.agent',
            metadata: {
              promptVersion: PROMPT_VERSIONS.tutorSystem,
              sessionId: body.sessionId,
              mode: body.mode,
              subject: body.subject ?? '',
              model: modelId,
              providerAttempt: attemptIndex + 1,
            },
          },
          onStepFinish(step) {
            const toolCalls = step.toolCalls ?? [];
            track({
              kind: 'tutor.step',
              sessionId: body.sessionId,
              step: attemptIndex,
              stepType: toolCalls.length > 0 ? 'tool-call' : 'assistant',
              toolCalls: toolCalls.map((t) => t.toolName),
              usage: step.usage,
            });
            log.debug('step', {
              model: modelId,
              tools: toolCalls.map((t) => t.toolName),
              tokens: step.usage,
            });
          },
          onError({ error }) {
            const msg = error instanceof Error ? error.message : String(error);
            track({
              kind: 'tutor.fail',
              sessionId: body.sessionId,
              errorCode: 'TUTOR_STREAM_ERROR',
              errorMsg: msg,
            });
            log.error('streamText error', { sessionId: body.sessionId, model: modelId, err: msg });
          },
        });

        let shouldTryNextProvider = false;
        const uiStream = result.toUIMessageStream<UIMessage>({
          sendStart: attemptIndex === 0,
          onError: getRawTutorAgentErrorMessage,
        });

        for await (const chunk of uiStream) {
          if (chunk.type === 'error' && !deliveredOutput && attemptIndex < providers.length - 1) {
            const rawError = chunk.errorText;
            if (shouldFallbackTutorAgentError(rawError)) {
              shouldTryNextProvider = true;
              attemptedProviderFallback = true;
              track({
                kind: 'tutor.fail',
                sessionId: body.sessionId,
                errorCode: 'TUTOR_PROVIDER_FALLBACK',
                errorMsg: rawError,
              });
              log.warn('provider fallback', {
                sessionId: body.sessionId,
                fromModel: modelId,
                toModel: providers[attemptIndex + 1]?.modelId,
                err: rawError,
              });
              break;
            }
          }

          if (chunk.type === 'error') {
            writer.write({
              ...chunk,
              errorText: formatTutorAgentUserError(chunk.errorText, {
                attemptedFallback: attemptedProviderFallback,
              }),
            });
          } else {
            writer.write(chunk);
          }
          // 工具调用帧也可能已被前端渲染；一旦有可见输出，就不再切换 provider，避免 UI 状态错乱。
          deliveredOutput = deliveredOutput || hasDeliveredAssistantOutput(chunk);
        }

        if (shouldTryNextProvider) continue;
        return;
      }
    },
  });
}

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
    const { messages, mode, context, options } = parsed.data;
    sessionId = parsed.data.sessionId;

    const providers = resolveTutorAgentProviderFallbacks(process.env, { modelId: parsed.data.model });
    if (providers.length === 0) {
      track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_NO_API_KEY' });
      return new Response(JSON.stringify({ error: 'LLM API key not configured' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }

    const systemPrompt = buildTutorSystemPrompt(mode as TutorMode, context, options);
    const stream = createTutorAttemptStream({
      providers,
      body: parsed.data,
      systemPrompt,
      modelMessages: await convertToModelMessages(messages as UIMessage[]),
    });

    return createUIMessageStreamResponse({ stream });
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
