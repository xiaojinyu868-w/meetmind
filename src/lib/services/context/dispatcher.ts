import { randomUUID } from 'node:crypto';
import type { ContextEvent, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getContextConfig } from '@/lib/config/context';
import { createLogger } from '@/lib/logger';
import { hindsightBackend, type HindsightBackend } from './hindsight';
import { ContextError } from './validation';

const log = createLogger('context-dispatch');
const availableLease = () => ({ OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] });

async function deliver(row: ContextEvent, backend: HindsightBackend): Promise<Prisma.ContextEventUpdateManyMutationInput> {
  if (row.cleanupPending) {
    if (row.attempts > 0) {
      if (row.cleanupStage !== 'document_removed') {
        const operation = await backend.operation(row);
        // A timed-out submission can still be accepted upstream. Never declare erasure
        // complete until that operation has reached a terminal state.
        if (operation.status === 'not_found') return { lastErrorCode: 'cleanup_unconfirmed' };
        if (operation.status === 'pending' || operation.status === 'processing' || operation.next_retry_at) return {};
        await backend.remove(row);
        const marked = await prisma.contextEvent.updateMany({
          where: { id: row.id, leaseToken: row.leaseToken }, data: { cleanupStage: 'document_removed' },
        });
        if (!marked.count) throw new ContextError('lease_lost', 409);
      }
      // Operations can contain the original task payload, even after document deletion.
      // Persist the prior stage so a lost delete acknowledgement is safely retryable.
      await backend.removeOperation(row);
    }
    return { cleanupPending: false, deliveryStatus: 'completed', lastErrorCode: null };
  }
  if (row.visibility !== 'active') return {};
  if (row.attempts > 0) {
    const operation = await backend.operation(row);
    if (operation.status === 'completed') return { deliveryStatus: 'completed', lastErrorCode: null };
    if (operation.status === 'failed' || operation.status === 'cancelled') {
      return { deliveryStatus: operation.next_retry_at ? 'submitted' : 'failed', lastErrorCode: 'backend_operation_failed' };
    }
    if (operation.status !== 'not_found') return { deliveryStatus: 'submitted', lastErrorCode: null };
  }
  // Record uncertainty before sending. A crash after send must poll/reuse this ID.
  const marked = await prisma.contextEvent.updateMany({
    where: { id: row.id, leaseToken: row.leaseToken, visibility: 'active', cleanupPending: false },
    data: { attempts: { increment: 1 } },
  });
  if (!marked.count) return {};
  await backend.retain(row);
  return { deliveryStatus: 'submitted', lastErrorCode: null };
}

/** Transport outbox only. Hindsight owns extraction, consolidation, and its worker. */
export async function dispatchContextBatch(backend: HindsightBackend = hindsightBackend): Promise<number> {
  if (!getContextConfig().backendUrl) return 0;
  const rows = await prisma.contextEvent.findMany({
    where: {
      nextAttemptAt: { lte: new Date() }, ...availableLease(),
      AND: [{ OR: [
        { cleanupPending: true },
        { visibility: 'active', deliveryStatus: { in: ['queued', 'retrying', 'submitted'] } },
      ] }],
    }, orderBy: { nextAttemptAt: 'asc' }, take: 16,
  });
  let processed = 0;
  for (const candidate of rows) {
    const leaseToken = randomUUID();
    const claimed = await prisma.contextEvent.updateMany({
      where: { id: candidate.id, ...availableLease() },
      data: { leaseToken, leaseUntil: new Date(Date.now() + 60_000) },
    });
    if (!claimed.count) continue;
    const row = await prisma.contextEvent.findUniqueOrThrow({ where: { id: candidate.id } });
    let update: Prisma.ContextEventUpdateManyMutationInput;
    try {
      update = await deliver(row, backend);
    } catch (error) {
      const code = error instanceof ContextError ? error.code : 'dispatch_failed';
      update = { deliveryStatus: 'retrying', lastErrorCode: code };
      log.warn('Context delivery deferred', { eventId: row.id, code });
    }
    await prisma.contextEvent.updateMany({
      where: { id: row.id, leaseToken },
      data: {
        ...update, leaseToken: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + (update.deliveryStatus === 'retrying' ? 30_000 : 5_000)),
      },
    });
    processed += 1;
  }
  return processed;
}
