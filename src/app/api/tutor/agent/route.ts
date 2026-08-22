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
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { applyRateLimit, getUserIdFromRequest } from '@/lib/utils/rate-limit';
import {
  PROMPT_VERSIONS,
  type TutorMode,
  type TutorSystemContext,
} from '@/lib/prompts/tutor-prompts';
import { createLogger, track } from '@/lib/logger';
import { ModelDefaults } from '@/lib/config/app.config';
import {
  formatTutorAgentUserError,
  createTutorAgentChatModel,
  resolveTutorAgentProviderFallbacks,
  resolveTutorFirstTokenTimeoutMs,
  shouldFallbackTutorAgentError,
  type TutorAgentProviderConfig,
} from '@/lib/utils/tutor-agent-provider';
import {
  getSharedAgentInternal,
  trackShareInteraction,
  SharedAgentSnapshotSchema,
  type SharedAgentSnapshot,
} from '@/lib/services/share-agent-service';
import { buildControlledTutorPrompt } from '@/lib/services/ai-control-service';
import { meterLLMUsage, meterUserIdFromRequest } from '@/lib/services/point-meter';
import { getMembershipPlan, getTutorModePrice, type MembershipTier } from '@/lib/config/pricing';
import { checkCanSpend, checkGuestDailyCost, spendPoints } from '@/lib/services/point-account-service';
import { getActiveMembership } from '@/lib/services/membership-service';

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
    'text-delta',
    'reasoning-delta',
    'source-url',
    'source-document',
    'file',
    'tool-input-available',
    'tool-output-available',
    'tool-output-error',
  ].includes(chunk.type);
}

interface TutorCharge {
  userId: string;
  points: number;
  /** 幂等键的轮次区分段（同一 session 多轮对话各自计费） */
  turnKey: string;
}

/** 从 UIMessage 形态的 messages 里提取纯文本（parts 优先，兼容 content string/array） */
function extractMessageText(message: { content?: unknown; parts?: unknown }): string {
  const fromParts = (parts: unknown[]): string =>
    parts
      .map((part) => {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .join('');
  if (Array.isArray(message.parts)) return fromParts(message.parts);
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) return fromParts(message.content);
  return '';
}

/**
 * L2 堵漏：轮次键不再用客户端消息 id（客户端可以同一 id 换内容重发 → 幂等跳过 → 免费）。
 * 改用消息内容哈希：同内容重试 = 同键幂等跳过（防双击重复扣），新内容 = 新键正常计费。
 * 已知取舍：同一 session 里逐字重发同一问题只扣一次（边缘场景，可接受）。
 */
function tutorTurnKey(message: { content?: unknown; parts?: unknown } | undefined, fallbackIndex: number): string {
  const text = message ? extractMessageText(message).trim() : '';
  if (!text) return `n${fallbackIndex}`;
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function createTutorAttemptStream({
  providers,
  body,
  systemPrompt,
  modelMessages,
  userId,
  charge,
}: {
  providers: TutorAgentProviderConfig[];
  body: ParsedTutorAgentBody;
  systemPrompt: string;
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  userId: string | null;
  charge: TutorCharge | null;
}) {
  return createUIMessageStream<UIMessage>({
    onError: (error) => formatTutorAgentUserError(error),
    async execute({ writer }) {
      let attemptedProviderFallback = false;
      const firstTokenTimeoutMs = resolveTutorFirstTokenTimeoutMs(process.env);

      for (let attemptIndex = 0; attemptIndex < providers.length; attemptIndex += 1) {
        const provider = providers[attemptIndex];
        if (!provider.apiKey) continue;

  const { modelId } = provider;
        // 思考分档：deep（陪我学会）开思考并流式回传思维链；其余全部显式关——
        // DeepSeek V4 默认带思维链，不关就是白付首 token 延迟。
        const thinkingEnabled = body.context.global?.depth === 'deep';
        // 正式 Tutor 与管理员试跑共用模型构造，确保 Qwen thinking 等 provider 细节完全一致。
        const model = createTutorAgentChatModel(provider, { thinking: thinkingEnabled });
        const firstTokenController = new AbortController();
        const firstTokenTimer = setTimeout(() => {
          firstTokenController.abort(new Error(`Tutor first token timeout after ${firstTokenTimeoutMs}ms`));
        }, firstTokenTimeoutMs);
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
          firstTokenTimeoutMs,
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
          abortSignal: firstTokenController.signal,
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
            // 积分影子计量（Phase 1）：AI SDK 这条链不走 llm-service.chat()，
            // 在 step 回调里顺手记账；失败只 warn，不影响流式响应。
            if (step.usage) {
              meterLLMUsage({
                userId,
                feature: `tutor:${body.mode}`,
                modelId,
                usage: {
                  promptTokens: step.usage.inputTokens ?? 0,
                  completionTokens: step.usage.outputTokens ?? 0,
                },
                refType: 'tutor',
                refId: body.sessionId,
                idempotencyKey: `tutor:${body.sessionId}:${attemptIndex}:${toolCalls.length}`,
              });
            }
            // 积分真扣费（Phase 2）：预检已在流开始前完成，这里在首个计费 step
            // 成功后结算。幂等键按 轮次+provider attempt 区分：
            // - 同一轮内多个 step（stopWhen 余量）靠 P2002 去重 → 一轮只扣一次
            // - provider fallback 时失败的 attempt 没有 onStepFinish，不扣
            // - 客户端整轮重发（同内容 → 同 turnKey）幂等跳过；新一轮对话 turnKey 不同
            if (charge && step.usage) {
              const chargeUserId = charge.userId;
              void spendPoints({
                userId: chargeUserId,
                points: charge.points,
                reason: `tutor:${body.mode}`,
                refType: 'tutor',
                refId: body.sessionId,
                // 真实成本已由影子流水（meterLLMUsage）计入熔断累计，这里记 0 防双算
                costMilliYuan: 0,
                idempotencyKey: `tutor-charge:${body.sessionId}:${charge.turnKey}:${attemptIndex}`,
              }).then((spend) => {
                if (!spend.ok) {
                  // L4 对账信号：产物已交付但扣费失败，需要补偿——升到 error + track 聚合
                  log.error('tutor charge failed after precheck', {
                    sessionId: body.sessionId,
                    mode: body.mode,
                    error: spend.error,
                    balance: spend.balance,
                  });
                  track({
                    kind: 'points.charge_failed',
                    feature: `tutor:${body.mode}`,
                    userId: chargeUserId,
                    errorCode: spend.error,
                  });
                }
              }).catch((error) => {
                log.warn('tutor charge unexpected failure', {
                  sessionId: body.sessionId,
                  error: error instanceof Error ? error.message : String(error),
                });
              });
            }
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

        try {
          for await (const chunk of uiStream) {
            const chunkDeliveredOutput = hasDeliveredAssistantOutput(chunk);
            if (chunkDeliveredOutput) clearTimeout(firstTokenTimer);

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
            deliveredOutput = deliveredOutput || chunkDeliveredOutput;
          }
        } finally {
          clearTimeout(firstTokenTimer);
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

    // 积分真扣费（Phase 2）：review 与 global deep 档按 getTutorModePrice 计，其余模式免费。
    // 预检在流开始前完成，402 直接返回。
    const userId = getUserIdFromRequest(request);
    const meteringUserId = meterUserIdFromRequest(request, userId);

    // L1 堵漏：guest（无 Bearer）不再零成本——按当日影子成本限额，
    // 超限返回 402 guest_daily_cap，前端引导登录（rate-limit 之外的第二道闸）。
    if (!userId) {
      const allowance = await checkGuestDailyCost(meteringUserId);
      if (!allowance.ok) {
        track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_GUEST_DAILY_CAP' });
        return new Response(JSON.stringify({ error: 'guest_daily_cap' }), {
          status: 402,
          headers: { 'content-type': 'application/json' },
        });
      }
    }

    const tutorPrice = getTutorModePrice(mode, context.global?.depth ?? null);

    // 会员闸门与权益：global 模式查一次档位——deep 档是 Pro/Max 专属（免费档
    // 402 membership_required，前端弹会员 Tab）；Max 档 quick 路由到主模型（优先模型权益）。
    let globalTier: MembershipTier = 'free';
    if (mode === 'global') {
      globalTier = userId ? (await getActiveMembership(userId)).tier : 'free';
      if (context.global?.depth === 'deep' && !getMembershipPlan(globalTier)?.deepUnlock) {
        track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_MEMBERSHIP_REQUIRED' });
        return new Response(
          JSON.stringify({ error: 'membership_required', requiredTier: 'pro' }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        );
      }
    }

    let charge: TutorCharge | null = null;
    if (userId && tutorPrice > 0) {
      const check = await checkCanSpend(userId, tutorPrice);
      if (!check.ok) {
        track({ kind: 'tutor.fail', sessionId, errorCode: 'TUTOR_PAYMENT_REQUIRED', errorMsg: check.error });
        return new Response(
          JSON.stringify({ error: check.error, balance: check.balance, required: check.required }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        );
      }
      const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
      charge = {
        userId,
        points: tutorPrice,
        turnKey: tutorTurnKey(lastUserMessage, messages.length),
      };
    }

    const controlled = await buildControlledTutorPrompt(mode as TutorMode, context, options);
    const requestModel = controlled.modelId || parsed.data.model || (
      mode === 'global' && context.global?.depth === 'quick' && globalTier !== 'max'
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

    // 老客户端/旧缓存页面可能发 content-string 形态（zod schema 允许），
    // convertToModelMessages 只吃 UIMessage parts —— 缺 parts 时先规整，防 500。
    const uiMessages = messages.map((message, index) => {
      if (Array.isArray(message.parts)) return message as UIMessage;
      const text = extractMessageText(message);
      return {
        id: message.id ?? `m${index}`,
        role: message.role,
        parts: [{ type: 'text', text }],
      } as UIMessage;
    });

    const stream = createTutorAttemptStream({
      providers,
      body: parsed.data,
      systemPrompt: controlled.systemPrompt,
      modelMessages: await convertToModelMessages(uiMessages),
      userId: meteringUserId,
      charge,
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
