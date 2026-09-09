import type { ContextEvent } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ContextDeliveryStatus, ContextEventReceipt, ContextEventRecord, ContextPrincipal, ContextVisibility } from '@/types/context';
import { requireCapability, requireSpace } from './access';
import { ContextError, eventSchema, parseInput } from './validation';

export function eventRecord(row: ContextEvent): ContextEventRecord {
  return {
    id: row.id, appId: row.appId, spaceId: row.spaceId, type: row.type, content: row.content,
    source: row.sourceJson ? JSON.parse(row.sourceJson) : undefined,
    metadata: JSON.parse(row.metadataJson), occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.createdAt.toISOString(), visibility: row.visibility as ContextVisibility,
    status: row.deliveryStatus as ContextDeliveryStatus,
    cleanupPending: row.cleanupPending,
  };
}

export async function appendContextEvent(principal: ContextPrincipal, input: unknown): Promise<ContextEventReceipt> {
  requireCapability(principal, 'write');
  const data = parseInput(eventSchema, input);
  requireSpace(principal, data.spaceId);
  const key = { userId: principal.userId, appId: principal.appId, clientEventId: data.clientEventId };
  const sourceJson = data.source ? JSON.stringify(data.source) : null;
  let duplicate = false;
  let row: ContextEvent;
  try {
    // The original and its durable delivery intent are one atomic insert.
    row = await prisma.contextEvent.create({ data: {
      ...key, spaceId: data.spaceId, type: data.type, content: data.content,
      sourceJson, metadataJson: JSON.stringify(data.metadata), occurredAt: new Date(data.occurredAt),
    } });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error;
    const existing = await prisma.contextEvent.findUnique({ where: { userId_appId_clientEventId: key } });
    if (!existing) throw error;
    requireSpace(principal, existing.spaceId);
    // A forgotten tombstone cannot be replayed to resurrect its original contents.
    if (existing.visibility !== 'forgotten' && (
      existing.content !== data.content || existing.spaceId !== data.spaceId || existing.type !== data.type ||
      existing.occurredAt.getTime() !== new Date(data.occurredAt).getTime() || existing.sourceJson !== sourceJson ||
      existing.metadataJson !== JSON.stringify(data.metadata)
    )) throw new ContextError('idempotency_conflict', 409);
    row = existing;
    duplicate = true;
  }
  return { eventId: row.id, jobId: row.id, status: row.deliveryStatus as ContextDeliveryStatus, duplicate };
}

export async function getContextEvent(principal: ContextPrincipal, id: string): Promise<ContextEvent> {
  const row = await prisma.contextEvent.findFirst({ where: { id, userId: principal.userId } });
  if (!row || (!principal.owner && !principal.spaceIds.includes(row.spaceId))) throw new ContextError('not_found', 404);
  return row;
}

export async function listContextEvents(principal: ContextPrincipal, cursor?: string, spaceId?: string) {
  requireCapability(principal, 'read');
  if (spaceId) requireSpace(principal, spaceId);
  const after = cursor ? await getContextEvent(principal, cursor) : undefined;
  const rows = await prisma.contextEvent.findMany({
    where: {
      userId: principal.userId,
      spaceId: spaceId ?? (principal.owner ? undefined : { in: principal.spaceIds }),
      visibility: principal.owner ? undefined : 'active',
      ...(after ? { OR: [
        { createdAt: { lt: after.createdAt } },
        { createdAt: after.createdAt, id: { lt: after.id } },
      ] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
  });
  return { events: rows.slice(0, 50).map(eventRecord), nextCursor: rows.length > 50 ? rows[49].id : null };
}
