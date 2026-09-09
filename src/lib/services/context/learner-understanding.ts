import { getContextConfig } from '@/lib/config/context';
import { createLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import type { LearnerUnderstanding } from '@/types/learner-context';
import { assertPrincipalActive, ownerPrincipal } from './access';
import { prepareContext } from './prepare';

const log = createLogger('context-learner');

/**
 * 「这个学习者」读槽里"有来源的理解"那一半：按当前任务向 Hindsight 召回，经 prepare 的来源链校验与
 * 暂停 / 忘记过滤，返回预算内的 JSON 证据文本 + 来源句柄。
 *
 * 与 learner-context-provider 的分工：那边是可核对的事实（检验结果 → 掌握状态，规则聚合）；这边是模型整理过的
 * 理解（跨应用记忆），每条都能打开原文。两半合在 LearnerContext 里给应用矿阵 / Tutor / teach 一起用。
 *
 * afterEventId 取最近一条 active 的个人经历：学生刚说的纠正（"我其实已经懂了"）优先占预算，不被语义相似的旧记忆挤掉。
 * 只保护最近一条，不是完整的矛盾消解。任何失败返回 null——读槽是"多知道一点"，不是执行前提。
 */
export async function prepareLearnerUnderstanding(input: {
  userId: string;
  /** 召回用的任务意图（学生这一句 / 应用目标 + 概念 / 课题） */
  task: string;
  maxTokens?: number;
}): Promise<LearnerUnderstanding | null> {
  if (!getContextConfig().enabled) return null;
  const task = input.task.replace(/\s+/g, ' ').trim();
  if (!task) return null;
  try {
    const principal = ownerPrincipal(input.userId);
    await assertPrincipalActive(principal);
    const latest = await prisma.contextEvent.findFirst({
      where: { userId: principal.userId, spaceId: 'personal', visibility: 'active' },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], select: { id: true },
    });
    const bundle = await prepareContext(principal, {
      task: { intent: task.slice(0, 4_000) },
      scope: { spaceIds: ['personal'] },
      budget: { maxTokens: input.maxTokens ?? 1_800 },
      ...(latest ? { afterEventId: latest.id } : {}),
    });
    if (!bundle.text && bundle.memories.length === 0 && bundle.observations.length === 0) {
      return bundle.degraded ? { text: '', sources: [], degraded: true, reason: bundle.reason } : null;
    }
    return {
      text: bundle.text,
      sources: bundle.sources.slice(0, 40).map((source) => ({
        id: source.id,
        appId: source.appId,
        title: source.source?.title,
        occurredAt: source.occurredAt,
      })),
      degraded: bundle.degraded,
      reason: bundle.reason,
    };
  } catch (error) {
    log.warn('learner understanding unavailable', { code: error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'unknown' });
    return null;
  }
}
