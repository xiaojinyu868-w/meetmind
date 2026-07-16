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
//   - 单 agent、纯文字对话（不引入 LangGraph；结构化产物由应用矩阵承接）
//   - stopWhen: stepCountIs(3) 留安全余量，正常对话 1 步即完成
//   - experimental_transform 使用中英文兼容正则平滑流出
//   - onStepFinish 打 track() 埋点
//   - prompt 来源：`src/lib/prompts/tutor-prompts.ts` 的 buildTutorSystemPrompt
//   - global quick 默认走注册表里的低延迟 Tutor 模型；deep / 课堂 / 复习保留主模型

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  stepCountIs,
  smoothStream,
  convertToModelMessages,
  type UIMessage,
  type UIMessageChunk,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import {
  buildTutorSystemPrompt,
  PROMPT_VERSIONS,
  type TutorMode,
  type TutorSystemContext,
} from '@/lib/prompts/tutor-prompts';
import { createLogger, track } from '@/lib/logger';
import { ModelDefaults } from '@/lib/config/app.config';
import {
  formatTutorAgentUserError,
  resolveTutorAgentProviderFallbacks,
  shouldFallbackTutorAgentError,
  type TutorAgentProviderConfig,
} from '@/lib/utils/tutor-agent-provider';
import {
  getSharedAgentInternal,
  trackShareInteraction,
  SharedAgentSnapshotSchema,
  type SharedAgentSnapshot,
} from '@/lib/services/share-agent-service';

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
    /** 仅 mode='goal'：用户已经记下的目标 + bio 画像 + 这次会话的 hint */
    goal: z
      .object({
        existingGoals: z
          .array(
            z.object({
              title: z.string(),
              summary: z.string().optional(),
              updatedAt: z.string().optional(),
            }),
          )
          .optional(),
        existingBio: z
          .object({
            headline: z.string(),
            detail: z.string().optional(),
          })
          .optional(),
        sessionHint: z.string().optional(),
      })
      .optional(),
    /** 仅 mode='word'：选词解释浮窗（M13 收口）。 */
    word: z
      .object({
        selectionText: z.string().min(1).max(2000),
        nearbyContext: z.string().max(4000).optional(),
        fullTranscriptTail: z.string().max(8000).optional(),
      })
      .optional(),
    /** 全局 Ask MeetMind：长期记忆、近期学习现场与已确认的深度学习意图。 */
    global: z
      .object({
        depth: z.enum(['quick', 'deep']).optional(),
        intent: z
          .object({
            title: z.string().max(120),
            outcome: z.string().max(400),
            approach: z.string().max(40).optional(),
            checkpoints: z.array(z.string().max(160)).max(3).optional(),
          })
          .optional(),
        memories: z.array(z.object({
          title: z.string().max(160),
          detail: z.string().max(500).optional(),
          kind: z.string().max(40).optional(),
        })).max(12).optional(),
        recentActivities: z.array(z.object({
          title: z.string().max(160),
          detail: z.string().max(500).optional(),
          occurredAt: z.string().max(80).optional(),
        })).max(8).optional(),
        activeThread: z.object({
          title: z.string().max(160),
          lastSummary: z.string().max(800).optional(),
          nextStep: z.string().max(400).optional(),
        }).optional(),
        goals: z.array(z.object({
          title: z.string().max(160),
          summary: z.string().max(500).optional(),
        })).max(8).optional(),
        bio: z.object({
          headline: z.string().max(300),
          detail: z.string().max(600).optional(),
        }).optional(),
      })
      .optional(),
  })
  .default({});

const OptionsSchema = z
  .object({
    thinkingGuide: z.boolean().optional(),
    returnTimestamps: z.boolean().optional(),
  })
  .default({});

const BodySchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().optional(),
      role: z.enum(['user', 'assistant', 'system']),
      content: z.union([z.string(), z.array(z.any())]).optional(),
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
  /**
   * M10：mode 驱动 prompt 骨架。老客户端没传时 fallback 到 'review'（最宽容）。
   * v3.0：新增 'shared' —— 走 SharedAgent 公开对话路径，需配合 shareToken。
   * 「聊聊你想要的」：新增 'goal' —— 用户和教练对话梳理目标，无课堂上下文，禁用 native tools 和 inline app。
   */
  mode: z.enum(['in-class', 'review', 'shared', 'goal', 'word', 'global']).default('review'),
  /** v3.0 仅 shared 模式：分享 token，从 SharedAgent.snapshotJson 加载上下文 */
  shareToken: z.string().max(32).optional(),
  context: ContextSchema,
  options: OptionsSchema,
});

// ────────────────────────────────────────────────────────────────────
// v3.0 SharedAgent helpers — mode='shared' 时用 snapshot 拼上下文
// ────────────────────────────────────────────────────────────────────

type ParsedTutorAgentBody = z.infer<typeof BodySchema>;

const ARTIFACT_KIND_LABELS: Record<string, string> = {
  cheatsheet: '一张考试速查表',
  mindmap: '一张思维导图',
  quiz: '一组课堂测验',
  flashcards: '一组课堂闪卡',
  infographic: '一张课堂信息图',
  'audio-overview': '一期课堂播客',
  notes: '一份课堂笔记',
  'chat-only': '一段对这节课的对话',
};

function formatTranscriptDigest(snapshot: SharedAgentSnapshot): string {
  const segments = snapshot.transcriptDigest?.segments ?? [];
  if (segments.length === 0) return '';
  return segments
    .map((seg) => {
      const startMin = Math.floor(seg.startSec / 60).toString().padStart(2, '0');
      const startSec = Math.floor(seg.startSec % 60).toString().padStart(2, '0');
      const speaker = seg.speaker ? `${seg.speaker}：` : '';
      return `[${startMin}:${startSec}] ${speaker}${seg.text}`;
    })
    .join('\n');
}

interface SharedContextResolution {
  ok: true;
  context: TutorSystemContext;
  shareId: string;
}

interface SharedContextError {
  ok: false;
  status: number;
  error: string;
}

/**
 * 给 shared 模式注入上下文：根据 shareToken 加载 snapshot，拼成 context.shared。
 */
async function resolveSharedContext(
  shareToken: string | undefined,
  fallbackContext: TutorSystemContext,
): Promise<SharedContextResolution | SharedContextError> {
  if (!shareToken) {
    return { ok: false, status: 400, error: 'shared 模式需要 shareToken' };
  }
  const record = await getSharedAgentInternal(shareToken);
  if (!record) {
    return { ok: false, status: 404, error: '分享不存在或已撤销' };
  }
  if (!record.conversationEnabled) {
    return { ok: false, status: 403, error: '该分享禁用了对话' };
  }

  let snapshot: SharedAgentSnapshot;
  try {
    snapshot = SharedAgentSnapshotSchema.parse(JSON.parse(record.snapshotJson));
  } catch {
    return { ok: false, status: 500, error: '分享内容损坏' };
  }

  const transcriptDigest = formatTranscriptDigest(snapshot);
  const artifactDescription = ARTIFACT_KIND_LABELS[snapshot.artifactKind] ?? '一份分享产物';

  const context: TutorSystemContext = {
    // 保留客户端传上来的 supportMaterials 等通用字段，但显式抹掉 learnerProfile
    // —— 隐私铁律：分享态不注入访问者画像
    supportMaterials: fallbackContext.supportMaterials,
    shared: {
      sharerNickname: snapshot.sharerNickname ?? record.sharerNickname ?? '一位同学',
      courseTitle: snapshot.title || record.title,
      transcriptDigest,
      artifactDescription,
      extraContext: snapshot.conversationContext,
    },
  };
  return { ok: true, context, shareId: record.id };
}

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
        // M13: qwen3.x-plus / qwen3-* 是 thinking/reasoning 模型，默认会输出大量
        // reasoning_content（一次回复 200-300 reasoning tokens 拖慢 TTFT 5-10s）。
        // 透传 enable_thinking=false 关闭推理，让它当普通快速对话模型用。
        // AI SDK 的 createOpenAI 不暴露透传非标 OpenAI 字段的 API，只能 fetch hook 注入。
        const isQwenThinkingModel = /^qwen3?\.?(\d+)?[-.]?plus/i.test(modelId) || /^qwen3/i.test(modelId);
        const openaiOptions: Parameters<typeof createOpenAI>[0] = { apiKey, baseURL };
        if (isQwenThinkingModel) {
          openaiOptions.fetch = async (url, init) => {
            if (init?.body && typeof init.body === 'string') {
              try {
                const body = JSON.parse(init.body);
                if (body.enable_thinking === undefined) {
                  body.enable_thinking = false;
                  init = { ...init, body: JSON.stringify(body) };
                }
              } catch {
                /* keep init.body as-is */
              }
            }
            return fetch(url, init);
          };
        }
        const openai = createOpenAI(openaiOptions);
        const model = openai.chat(modelId);
        // M14.6：纯对话，不挂 native tools。结构化产物通过应用矩阵 SkillChip 直接打开。
        const tools = {};
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
          hasGlobalIntent: Boolean(body.context.global?.intent),
          globalDepth: body.context.global?.depth,
          options: body.options,
        });

        const result = streamText({
          model,
          system: systemPrompt,
          messages: modelMessages,
          tools,
          // 纯对话 1 步即完成；3 步留安全余量。
          stopWhen: stepCountIs(3),
          // 让 token 按"中文单字 / 英文词"为单位平滑流出，前端字符逐个浮现。
          //
          // ⚠️ 历史 bug（2026-05-31）：之前这里写的是 chunking: 'word'，但
          // Vercel AI SDK 的 'word' = 按 /\S+\s+/ 切（非空白 + 空白）。
          // 中文几乎不出现空白 → 整段中文永远等不到切分点 → 一次性吐出，
          // 用户体感"完全没有流式输出"。
          //
          // 修复：换成同时匹配 [中文单字] 或 [英文词+空白] 的正则。
          // 这样中文 1 字 1 切、英文 1 词 1 切。
          //
          // R9 节奏调优（2026-05-31 二次）：默认 delayInMs=10ms 配合中文 1 字 1 切 =
          // 50 字 0.5s 闪过，体感像"愣 → 整段砸出"。改 30ms 让逐字浮现可见。
          // 50 字 1.5s 浮现，符合人眼舒适阅读节奏，又不会让用户觉得 AI 在"打字慢"。
          //
          // M13 TTFT 优化（2026-06-02 晚）：30ms × 50 字 = 1500ms 才"读完整段"，
          // 实际拖慢用户"读到答案"的感知速度。压回 12ms：50 字 0.6s 浮现完，比 30ms
          // 快 60%。**首 token 不受 delayInMs 影响**——smoothStream 第一个 chunk 立即下发；
          // 这次调小是为了"看到第一个字到读完答案"的整体感知速度。
          experimental_transform: smoothStream({
            chunking: /[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]|\S+\s+/,
            delayInMs: 12,
          }),
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
    const { messages, mode, options } = parsed.data;
    let { context } = parsed.data;
    sessionId = parsed.data.sessionId;

    // v3.0 shared 模式：用 shareToken 加载 SharedAgent.snapshot 替换上下文
    let sharedShareId: string | null = null;
    if (mode === 'shared') {
      const resolved = await resolveSharedContext(parsed.data.shareToken, context);
      if (!resolved.ok) {
        track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_SHARED_CONTEXT_FAIL', errorMsg: resolved.error });
        return new Response(JSON.stringify({ error: resolved.error }), {
          status: resolved.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      context = resolved.context;
      sharedShareId = resolved.shareId;
    }

    const requestModel = parsed.data.model || (
      mode === 'global' && context.global?.depth === 'quick'
        ? ModelDefaults.tutorQuick
        : undefined
    );
    const providers = resolveTutorAgentProviderFallbacks(process.env, { modelId: requestModel });
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

    // 异步：分享态记一次 chat 互动
    if (sharedShareId && parsed.data.shareToken) {
      void trackShareInteraction({
        token: parsed.data.shareToken,
        visitorUserId: null, // 鉴权信息这层没读出来——后续可在 createTutorAttemptStream 里带
        eventType: 'chat',
      }).catch((err) => log.warn('shared chat track failed', { sessionId, err: (err as Error).message }));
    }

    // R9: 显式给 stream response 加 X-Accel-Buffering:no
    // —— 让 nginx 即使匹配到 /api/ 通用 location 也不缓冲。
    // —— 这是双保险，对所有反向代理都通用（CDN / Cloudflare / nginx）。
    // 之前用户反馈"完全没有流式输出"是因为 nginx proxy_buffering 把
    // SSE 帧缓冲成大块才转发，前端就感觉是"白屏 → 整段炸出"。
    return createUIMessageStreamResponse({
      stream,
      headers: {
        'X-Accel-Buffering': 'no',
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    // M14.5.5: 之前只 log msg，stack 没存——遇到 entryCSSFiles 这类 framework 错误根因不可见
    const errInfo = err instanceof Error
      ? { msg, name: err.name, stack: err.stack?.split('\n').slice(0, 4).join(' | ') }
      : { msg };
    log.error('fatal', { sessionId, ...errInfo, durationMs });
    track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_FATAL', errorMsg: msg });
    return new Response(
      JSON.stringify({ error: 'tutor agent failed', detail: msg, durationMs }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}
