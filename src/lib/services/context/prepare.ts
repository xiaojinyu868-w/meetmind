import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getContextConfig } from '@/lib/config/context';
import type { ContextMemory, ContextPrincipal, UserContextBundle } from '@/types/context';
import { assertPrincipalActive, requireCapability, requireSpace } from './access';
import { eventRecord, getContextEvent } from './events';
import { hindsightBackend, type HindsightBackend, type HindsightFact, type HindsightRecall } from './hindsight';
import { ContextError, parseInput, prepareSchema } from './validation';

/** All leaves must resolve. Missing/truncated/cyclic provenance is not permission. */
export function resolveFactSources(fact: HindsightFact, recall: HindsightRecall, visiting = new Set<string>()): string[] | null {
  if (visiting.has(fact.id) || visiting.size > 32) return null;
  const next = new Set(visiting).add(fact.id);
  if (fact.source_fact_ids?.length) {
    const leaves = fact.source_fact_ids.map((id) => {
      const source = recall.source_facts?.[id];
      return source ? resolveFactSources(source, recall, next) : null;
    });
    if (leaves.some((leaf) => !leaf?.length)) return null;
    return [...new Set(leaves.flatMap((leaf) => leaf ?? []))];
  }
  return fact.document_id ? [fact.document_id] : null;
}

export async function prepareContext(
  principal: ContextPrincipal, input: unknown, backend: HindsightBackend = hindsightBackend,
): Promise<UserContextBundle> {
  requireCapability(principal, 'read');
  const data = parseInput(prepareSchema, input);
  const spaces = [...new Set(data.scope?.spaceIds ?? (principal.owner ? ['personal'] : principal.spaceIds))];
  spaces.forEach((space) => requireSpace(principal, space));
  const config = getContextConfig();
  const maxTokens = data.budget?.maxTokens ?? config.defaultContextTokens;
  if (data.afterEventId) {
    const after = await getContextEvent(principal, data.afterEventId);
    if (!spaces.includes(after.spaceId)) throw new ContextError('scope_denied', 403);
  }
  let reason: string | undefined;
  const candidates: Array<ContextMemory & { spaceId: string }> = [];
  if (config.backendUrl) {
    const recalls = await Promise.allSettled(spaces.map((space) => backend.recall(
      principal.userId, space, data.task.intent, Math.max(128, Math.floor(maxTokens / spaces.length)),
    )));
    recalls.forEach((result, index) => {
      if (result.status === 'rejected') {
        reason = result.reason instanceof ContextError ? result.reason.code : 'backend_unavailable';
        return;
      }
      for (const fact of result.value.results) {
        const ids = resolveFactSources(fact, result.value);
        if (!ids?.length) continue;
        candidates.push({
          id: `${spaces[index]}:${fact.id}`, text: fact.text, kind: fact.type ?? 'memory',
          sourceEventIds: ids, observedAt: fact.mentioned_at ?? undefined, spaceId: spaces[index],
        });
      }
    });
  } else reason = 'backend_not_configured';

  // Read after the remote call: paused/forgotten sources cannot leak from stale recall.
  await assertPrincipalActive(principal);
  const citedIds = [...new Set(candidates.flatMap((memory) => memory.sourceEventIds))];
  const [cited, recent, requested] = await prisma.$transaction([
    prisma.contextEvent.findMany({ where: {
      id: { in: citedIds }, userId: principal.userId, spaceId: { in: spaces }, visibility: 'active',
    } }),
    prisma.contextEvent.findMany({
      where: {
        userId: principal.userId, spaceId: { in: spaces }, visibility: 'active',
        ...(reason ? {} : { deliveryStatus: { not: 'completed' } }),
      }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 12,
    }),
    prisma.contextEvent.findMany({ where: {
      id: data.afterEventId ?? '', userId: principal.userId, spaceId: { in: spaces }, visibility: 'active',
    } }),
  ]);
  const sourcesById = new Map(cited.map((row) => [row.id, row]));
  const memories = candidates.filter((memory) => memory.sourceEventIds.every((id) => sourcesById.get(id)?.spaceId === memory.spaceId));
  const bundle: UserContextBundle = {
    schemaVersion: 1, memories: [], observations: [], sources: [], text: '',
    contextVersion: '', pendingEventIds: [], degraded: Boolean(reason), ...(reason ? { reason } : {}),
  };
  // UTF-8 bytes are a conservative upper bound for common byte-tokenizing models.
  // This is a response budget, never a cap on stored memory or source history.
  const lines: string[] = [];
  let remaining = maxTokens;
  const observations = [...requested, ...recent.filter((row) => row.id !== data.afterEventId)];
  bundle.pendingEventIds = observations.filter((row) => row.deliveryStatus !== 'completed').map((row) => row.id);
  function includeObservation(row: typeof recent[number]): void {
    const observation = eventRecord(row);
    const line = JSON.stringify({ originalObservation: observation });
    const cost = Buffer.byteLength(line) + 1;
    if (cost > remaining) return;
    remaining -= cost;
    lines.push(line);
    bundle.observations.push(observation);
    sourcesById.set(row.id, row);
  }
  // A read-after-write source cannot be pushed out by a busy stream or recalled history.
  // Keep its authorized source handle even when the original exceeds this text budget.
  if (requested[0]) {
    sourcesById.set(requested[0].id, requested[0]);
    includeObservation(requested[0]);
  }
  for (const memory of memories) {
    const { spaceId: _spaceId, ...publicMemory } = memory;
    const line = JSON.stringify({ memory: publicMemory });
    const cost = Buffer.byteLength(line) + 1;
    if (cost > remaining) continue;
    remaining -= cost;
    lines.push(line);
    bundle.memories.push(publicMemory);
  }
  recent.filter((row) => row.id !== data.afterEventId).forEach(includeObservation);
  const includedIds = new Set([
    ...bundle.memories.flatMap((memory) => memory.sourceEventIds), ...bundle.observations.map((row) => row.id), ...requested.map((row) => row.id),
  ]);
  bundle.sources = [...sourcesById.values()].filter((row) => includedIds.has(row.id)).map((row) => ({
    id: row.id, appId: row.appId, spaceId: row.spaceId,
    source: row.sourceJson ? JSON.parse(row.sourceJson) : undefined, occurredAt: row.occurredAt.toISOString(),
  }));
  bundle.text = lines.join('\n');
  bundle.contextVersion = createHash('sha256').update(JSON.stringify({
    text: bundle.text, pending: bundle.pendingEventIds, reason,
  })).digest('hex').slice(0, 24);
  return bundle;
}
