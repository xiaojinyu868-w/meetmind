/**
 * learning-event-service — 学习记忆事件管道（P0 事件化）
 *
 * 事件表（prisma `LearningEvent`）是学习者画像的唯一写入口：
 * - `appendLearningEvent`：zod 校验 + 落事件；idempotencyKey 撞 unique 静默返回已有
 * - `processLearningEvent`：读画像 → 蒸馏（对话类事件，复用
 *   learning-memory-distillation-service）→ merge（复用 lib/utils/learning-context
 *   纯函数）→ 写回 `learnerProfileJson`（物化视图，仍保留 24 条上限）
 * - `triggerLearningEventProcessing`：按用户串行的 fire-and-forget 处理队列；
 *   蒸馏/合并失败只 log.warn，事件仍在表内可回放（沿用现有静默降级哲学）
 *
 * 访客一期不进服务端记忆（route 层要求 Bearer 登录）。
 */

import { z } from 'zod';
import type { LearningEvent } from '@prisma/client';
import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import { distillLearningMemories } from '@/lib/services/learning-memory-distillation-service';
import {
  learningContextFromProfile,
  mergeLearningActivity,
  mergeLearningMemory,
} from '@/lib/utils/learning-context';
import type { LearningEventInput } from '@/types/learning-event';
import type { LearnerProfile, LearningContextState } from '@/types/user';

const log = createLogger('learning-event');

const ConversationPayloadSchema = z.object({
  v: z.literal(1),
  userText: z.string().min(1).max(3_000),
  assistantText: z.string().min(1).max(8_000),
});

const ActivityPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.enum(['conversation', 'lesson', 'app', 'capture']),
  title: z.string().min(1).max(80),
  detail: z.string().max(240).optional(),
  sessionId: z.string().max(120).optional(),
  appKey: z.string().max(60).optional(),
});

const EventBaseShape = {
  appId: z.string().min(1).max(40),
  sourceId: z.string().min(1).max(160).optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
  occurredAt: z.string().max(40).optional(),
};

const EventInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['confusion', 'mastery', 'error', 'preference', 'progress']),
    payload: ConversationPayloadSchema,
    ...EventBaseShape,
  }),
  z.object({
    type: z.literal('activity'),
    payload: ActivityPayloadSchema,
    ...EventBaseShape,
  }),
]);

type ParsedLearningEventInput = z.infer<typeof EventInputSchema>;

function isP2002(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

function parseOccurredAt(value: string | undefined): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** 落事件。校验失败返回 null；幂等键冲突返回已存在的事件；其余错误抛给调用方。 */
export async function appendLearningEvent(
  userId: string,
  rawInput: LearningEventInput,
): Promise<LearningEvent | null> {
  const parsed = EventInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    log.warn('learning event rejected', {
      userId,
      issues: parsed.error.issues.map((issue) => issue.message).slice(0, 3).join('; '),
    });
    return null;
  }
  const input: ParsedLearningEventInput = parsed.data;
  try {
    return await prisma.learningEvent.create({
      data: {
        userId,
        appId: input.appId,
        type: input.type,
        payloadJson: JSON.stringify(input.payload),
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        occurredAt: parseOccurredAt(input.occurredAt),
      },
    });
  } catch (error) {
    if (isP2002(error) && input.idempotencyKey) {
      return prisma.learningEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    }
    throw error;
  }
}

function readProfile(learnerProfileJson: string | null): LearnerProfile {
  if (!learnerProfileJson) return { stage: 'unknown' } as LearnerProfile;
  try {
    return JSON.parse(learnerProfileJson) as LearnerProfile;
  } catch {
    return { stage: 'unknown' } as LearnerProfile;
  }
}

function applyConversationEvent(state: LearningContextState, distilled: Array<{
  kind: LearningContextState['memories'][number]['kind'];
  title: string;
  detail?: string;
  replaceId?: string;
}>, eventId: string, now: string): LearningContextState {
  let next = state;
  distilled.forEach((memory, index) => {
    const replacement = memory.replaceId
      ? next.memories.find((item) => item.id === memory.replaceId)
      : undefined;
    if (replacement) {
      next = {
        ...next,
        memories: next.memories.map((item) => (
          item.id === replacement.id
            ? { ...item, kind: memory.kind, title: memory.title, detail: memory.detail, status: 'active' as const, updatedAt: now }
            : item
        )),
      };
    } else {
      next = mergeLearningMemory(next, {
        id: `memory-${eventId}-${index}`,
        kind: memory.kind,
        title: memory.title,
        detail: memory.detail,
        status: 'active',
        source: 'ai',
        // sourceId 携带事件ID：同一事件重放时 merge 按 sourceId 去重，不双写
        sourceId: `learning-event:${eventId}:${index}`,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
  return next;
}

/** 处理单条事件：蒸馏（对话类）/ 直接合并（activity）后写回画像物化视图。 */
export async function processLearningEvent(event: LearningEvent): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: event.userId },
    select: { learnerProfileJson: true },
  });
  if (!user) {
    log.warn('learning event user missing', { eventId: event.id, userId: event.userId });
    return;
  }

  const profile = readProfile(user.learnerProfileJson);
  let state = learningContextFromProfile(profile);

  if (event.type === 'activity') {
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(event.payloadJson);
    } catch {
      rawPayload = null;
    }
    const payload = ActivityPayloadSchema.safeParse(rawPayload);
    if (!payload.success) {
      log.warn('learning event activity payload invalid', { eventId: event.id });
      return;
    }
    state = mergeLearningActivity(state, {
      id: `activity-${event.id}`,
      kind: payload.data.kind,
      title: payload.data.title,
      detail: payload.data.detail,
      sessionId: payload.data.sessionId,
      appKey: payload.data.appKey,
      sourceId: event.sourceId ?? `learning-event:${event.id}`,
      occurredAt: event.occurredAt.toISOString(),
    });
  } else {
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(event.payloadJson);
    } catch {
      rawPayload = null;
    }
    const payload = ConversationPayloadSchema.safeParse(rawPayload);
    if (!payload.success) {
      log.warn('learning event conversation payload invalid', { eventId: event.id });
      return;
    }
    // 蒸馏失败返回 []（distill 内部已降级并记日志）：事件仍在表内，画像不动
    const distilled = await distillLearningMemories({
      userText: payload.data.userText,
      assistantText: payload.data.assistantText,
      existingMemories: state.memories,
    });
    if (distilled.length > 0) {
      state = applyConversationEvent(state, distilled, event.id, new Date().toISOString());
    }
  }

  await prisma.user.update({
    where: { id: event.userId },
    data: {
      learnerProfileJson: JSON.stringify({
        ...profile,
        memories: state.memories,
        recentLearningActivities: state.recentActivities,
      }),
    },
  });
}

// 同一用户的事件按到达顺序串行处理，避免并发读改写画像互相覆盖。
// 进程内队列足够：部署形态是单进程 PM2（server.js）。
const processingQueues = new Map<string, Promise<void>>();

/**
 * 触发异步处理（fire-and-forget 由调用方决定）。返回队列 promise 供测试 await；
 * 失败只记日志，事件仍在表内可回放。
 */
export function triggerLearningEventProcessing(event: LearningEvent): Promise<void> {
  const previous = processingQueues.get(event.userId) ?? Promise.resolve();
  const next = previous
    .then(() => processLearningEvent(event))
    .catch((error) => {
      log.warn('learning event processing failed', {
        eventId: event.id,
        userId: event.userId,
        message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
      });
    });
  processingQueues.set(event.userId, next);
  return next;
}
