// ASR 纠错服务（M5 T5.1）
//
// 不做 prompt injection 过滤——term 是用户的正确文本，会直接进 LLM prompt；
// 这里只做基础长度限制，真正防注入在 prompt 层。

import { prisma } from '@/lib/prisma';
import { createLogger, track } from '@/lib/logger';

const log = createLogger('asr-corrections');

const MAX_TERM_LENGTH = 40;
const MAX_CONTEXT_LENGTH = 200;
const AGGREGATE_MIN_FREQUENCY = 2; // 同一 (wrong, correct) 对出现 N 次才升级为热词

export interface RecordCorrectionInput {
  sessionId: string;
  userId?: string;
  workspaceId?: string;
  wrongText: string;
  correctedText: string;
  beginMs?: number;
  endMs?: number;
  context?: string;
  asrMode?: 'realtime' | 'fast' | 'async' | 'unknown';
}

export async function recordCorrection(input: RecordCorrectionInput): Promise<{ id: string } | null> {
  try {
    const wrong = input.wrongText.trim();
    const correct = input.correctedText.trim();

    if (!wrong || !correct) return null;
    if (wrong === correct) return null; // 无意义
    if (wrong.length > MAX_TERM_LENGTH * 4 || correct.length > MAX_TERM_LENGTH * 4) {
      log.warn('correction too long, dropped', { sessionId: input.sessionId });
      return null;
    }

    const created = await prisma.asrCorrection.create({
      data: {
        sessionId: input.sessionId,
        userId: input.userId ?? null,
        workspaceId: input.workspaceId ?? null,
        wrongText: wrong,
        correctedText: correct,
        beginMs: input.beginMs ?? null,
        endMs: input.endMs ?? null,
        context: input.context ? input.context.slice(0, MAX_CONTEXT_LENGTH) : null,
        asrMode: input.asrMode ?? 'unknown',
      },
      select: { id: true },
    });

    track({
      kind: 'asr.correction.record',
      sessionId: input.sessionId,
      asrMode: input.asrMode ?? 'unknown',
      correctionId: created.id,
    });
    return { id: created.id };
  } catch (err) {
    log.error('recordCorrection failed', { err: (err as Error).message });
    track({
      kind: 'asr.correction.fail',
      sessionId: input.sessionId,
      asrMode: input.asrMode ?? 'unknown',
      errorCode: 'DB_ERROR',
      errorMsg: (err as Error).message,
    });
    return null;
  }
}

export interface AggregateOptions {
  scope: 'user' | 'workspace';
  id: string;
  minFrequency?: number;
  windowDays?: number;
}

export interface AggregateResult {
  newlyCreated: number;
  updated: number;
  totalMarked: number;
}

/**
 * 聚合未处理的 AsrCorrection 为 AsrHotword。
 * 每周 cron 调用一次；也可以按需调。
 *
 * 策略：
 *   - 按 correctedText 分组，count >= minFrequency（默认 2）升级为热词
 *   - 已有 term → weight += 新增 count，更新 lastUsedAt
 *   - 新 term → 创建，weight = count
 *   - 处理完的 corrections.aggregated = true
 */
export async function aggregateHotwords(opts: AggregateOptions): Promise<AggregateResult> {
  const min = opts.minFrequency ?? AGGREGATE_MIN_FREQUENCY;
  const whereBase = {
    aggregated: false,
    ...(opts.scope === 'user' ? { userId: opts.id } : { workspaceId: opts.id }),
    ...(opts.windowDays
      ? { createdAt: { gte: new Date(Date.now() - opts.windowDays * 24 * 60 * 60 * 1000) } }
      : {}),
  };

  const pending = await prisma.asrCorrection.findMany({
    where: whereBase,
    select: { id: true, correctedText: true, wrongText: true },
  });

  if (pending.length === 0) {
    return { newlyCreated: 0, updated: 0, totalMarked: 0 };
  }

  // 按 correctedText 聚合
  const groups = new Map<string, { count: number; ids: string[]; wrongs: Set<string> }>();
  for (const c of pending) {
    const key = c.correctedText.trim();
    if (!key) continue;
    const g = groups.get(key) ?? { count: 0, ids: [], wrongs: new Set<string>() };
    g.count += 1;
    g.ids.push(c.id);
    g.wrongs.add(c.wrongText);
    groups.set(key, g);
  }

  // 先过滤出达标的分组，并一次性拉取所有已存在热词（避免 N+1）
  const eligible = Array.from(groups.entries()).filter(
    ([term, g]) => g.count >= min && term.length <= MAX_TERM_LENGTH,
  );
  const terms = eligible.map(([term]) => term);

  const scopeWhere =
    opts.scope === 'user' ? { userId: opts.id } : { workspaceId: opts.id };

  const existingRows =
    terms.length > 0
      ? await prisma.asrHotword.findMany({
          where: { ...scopeWhere, term: { in: terms } },
          select: { id: true, term: true, weight: true, aliases: true },
        })
      : [];
  const existingByTerm = new Map(existingRows.map((r) => [r.term, r]));

  const now = new Date();
  const writes: Promise<unknown>[] = [];
  const idsToMark: string[] = [];
  let newlyCreated = 0;
  let updated = 0;

  for (const [term, g] of eligible) {
    const aliasesJoined = Array.from(g.wrongs).slice(0, 5).join(',');
    const existing = existingByTerm.get(term);

    if (existing) {
      writes.push(
        prisma.asrHotword.update({
          where: { id: existing.id },
          data: {
            weight: existing.weight + g.count,
            aliases: aliasesJoined || existing.aliases,
            lastUsedAt: now,
          },
        }),
      );
      updated += 1;
    } else {
      writes.push(
        prisma.asrHotword.create({
          data: {
            ...scopeWhere,
            term,
            aliases: aliasesJoined || null,
            weight: g.count,
            source: 'correction',
            lastUsedAt: now,
          },
        }),
      );
      newlyCreated += 1;
    }
    idsToMark.push(...g.ids);
  }

  // 并发写入所有 hotword 变更 + 标记 corrections（单次 round-trip 写锁命中）
  await Promise.all(writes);
  if (idsToMark.length > 0) {
    await prisma.asrCorrection.updateMany({
      where: { id: { in: idsToMark } },
      data: { aggregated: true },
    });
  }

  log.info('aggregated corrections', {
    scope: opts.scope,
    id: opts.id,
    newlyCreated,
    updated,
    totalMarked: idsToMark.length,
    pendingCount: pending.length,
  });

  return { newlyCreated, updated, totalMarked: idsToMark.length };
}

export interface GetHotwordsOptions {
  userId?: string;
  workspaceId?: string;
  limit?: number;
}

/** 获取有权重降序的热词列表——供 buildASRContextHint 的 userHotwords 参数用 */
export async function getHotwords(opts: GetHotwordsOptions): Promise<string[]> {
  if (!opts.userId && !opts.workspaceId) return [];
  const limit = opts.limit ?? 20;

  const rows = await prisma.asrHotword.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
    },
    orderBy: [{ weight: 'desc' }, { lastUsedAt: 'desc' }],
    take: limit,
    select: { term: true },
  });

  return rows.map((r) => r.term);
}
