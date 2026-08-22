/**
 * point-meter — 积分机制 Phase 1：影子计量服务
 *
 * 只计量不扣费：每次 LLM 调用按 pricing.ts 定价表折算真实成本
 * （costMilliYuan，毫元）写一条 PointTransaction 流水（kind='spend'，
 * delta=0 不动 PointAccount 余额），为内测积分定价收集真实成本数据。
 *
 * 设计约束：
 * - 写库失败只记 warn，绝不阻塞业务请求（调用方用 meterLLMUsage 火忘）
 * - idempotencyKey 冲突（P2002）静默跳过，保证重试/重复回调不重复记账
 * - feature/userId 通过 AsyncLocalStorage 计量上下文自动归属：
 *   路由/service 入口 runWithMeterContext 包一层，底层 chat() 零侵入埋点
 */

import { AsyncLocalStorage } from 'async_hooks';
import prisma from '@/lib/prisma';
import { calcCostMilliYuan } from '@/lib/config/pricing';
import { createLogger } from '@/lib/logger';
import { registerLLMUsageHook } from '@/lib/services/llm-usage-hook';

const log = createLogger('point-meter');

// ==================== 计量上下文（AsyncLocalStorage） ====================

export interface MeterContext {
  /** 功能归属，如 tutor:review / apps:flashcards / understanding / wechat-agent */
  feature: string;
  userId?: string | null;
  refType?: string;
  refId?: string;
}

const meterStorage = new AsyncLocalStorage<MeterContext>();

/** 在计量上下文里执行 fn；其异步子树内的 LLM 调用自动继承该归属 */
export function runWithMeterContext<T>(context: MeterContext, fn: () => T): T {
  return meterStorage.run(context, fn);
}

export function getMeterContext(): MeterContext | undefined {
  return meterStorage.getStore();
}

// ==================== 影子记账 ====================

export interface RecordLLMUsageInput {
  userId?: string | null;
  feature: string;
  modelId: string;
  usage: { promptTokens?: number; completionTokens?: number };
  refType?: string;
  refId?: string;
  reason?: string;
  idempotencyKey?: string;
}

/** 未登录用户的流水归属：调用方尽量传 guest_xxx，拿不到时兜底 anonymous */
function normalizeUserId(userId?: string | null): string {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';
  return trimmed || 'anonymous';
}

/**
 * 从请求推导计量归属 userId：已登录用真实 userId；
 * 未登录用 `guest_<ip>`（对齐 rate-limit 的取头顺序），取不到 IP 兜底 anonymous。
 */
export function meterUserIdFromRequest(request: Request, userId?: string | null): string {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';
  if (trimmed) return trimmed;
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = request.headers.get('x-real-ip')?.trim();
  const ip = cf || forwarded || real;
  return ip ? `guest_${ip}` : 'anonymous';
}

/**
 * 记一笔影子流水。返回 true 表示落库，false 表示幂等跳过或写库失败。
 * 永不抛异常——计量是旁路，不能打挂业务链路。
 */
export async function recordLLMUsage(input: RecordLLMUsageInput): Promise<boolean> {
  const promptTokens = Math.max(0, Math.round(input.usage.promptTokens ?? 0));
  const completionTokens = Math.max(0, Math.round(input.usage.completionTokens ?? 0));
  if (promptTokens === 0 && completionTokens === 0) return false;

  const costMilliYuan = calcCostMilliYuan(input.modelId, promptTokens, completionTokens);

  try {
    await prisma.pointTransaction.create({
      data: {
        userId: normalizeUserId(input.userId),
        // Phase 1 影子模式：只记真实成本，不动积分余额
        delta: 0,
        kind: 'spend',
        reason: input.reason ?? input.feature,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        points: 0,
        costMilliYuan,
        modelId: input.modelId,
        promptTokens,
        completionTokens,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    return true;
  } catch (error) {
    // Prisma P2002：idempotencyKey 唯一冲突 → 已记过，静默跳过
    if ((error as { code?: string })?.code === 'P2002') return false;
    log.warn('record LLM usage failed', {
      feature: input.feature,
      modelId: input.modelId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * 火忘版计量：自动合并 AsyncLocalStorage 计量上下文（显式入参优先），
 * 吞掉所有异常。业务代码一律用这个，不要 await recordLLMUsage。
 */
export function meterLLMUsage(input: RecordLLMUsageInput): void {
  const context = getMeterContext();
  void recordLLMUsage({
    ...input,
    feature: input.feature || context?.feature || 'other',
    userId: input.userId ?? context?.userId,
    refType: input.refType ?? context?.refType,
    refId: input.refId ?? context?.refId,
  }).catch((error) => {
    log.warn('meter LLM usage unexpected failure', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

// ==================== 自注册：接管 llm-service 的用量发射 ====================
// llm-service 只静态依赖客户端安全的 llm-usage-hook（避免把 prisma/async_hooks
// 拉进浏览器 bundle）；本模块被服务端路由 import 时自动完成注册。
// 未注册前的 chat() 调用不计量——Phase 1 已覆盖全部高成本入口（tutor / apps /
// understanding / captures / wechat），零散的轻量路由缺口可接受。
registerLLMUsageHook((record) => {
  meterLLMUsage({ feature: record.feature, modelId: record.modelId, usage: record.usage });
});
