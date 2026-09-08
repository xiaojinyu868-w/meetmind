import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { ContextPrincipal } from '@/types/context';
import { requireOwner } from './access';
import { getContextEvent, eventRecord } from './events';
import { actionSchema, ContextError, parseInput } from './validation';
import { hindsightBackend, type HindsightBackend } from './hindsight';

export async function controlContextEvent(principal: ContextPrincipal, id: string, input: unknown) {
  requireOwner(principal);
  const { action } = parseInput(actionSchema, input);
  const existing = await getContextEvent(principal, id);
  if (existing.visibility === 'forgotten') {
    if (action !== 'forget') throw new ContextError('source_forgotten', 409);
    return { event: eventRecord(existing), cleanupPending: existing.cleanupPending };
  }
  if (action === 'resume') {
    if (existing.visibility === 'active') return { event: eventRecord(existing), cleanupPending: existing.cleanupPending };
    const result = await prisma.contextEvent.updateMany({
      where: { id, visibility: 'paused', cleanupPending: false, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
      data: {
        visibility: 'active', deliveryStatus: 'queued', backendOperationId: randomUUID(),
        attempts: 0, nextAttemptAt: new Date(), lastErrorCode: null, cleanupStage: 'pending',
      },
    });
    if (!result.count) throw new ContextError('cleanup_in_progress', 409);
  } else {
    await prisma.contextEvent.updateMany({
      where: { id, userId: principal.userId, visibility: { not: 'forgotten' } },
      data: {
        visibility: action === 'forget' ? 'forgotten' : 'paused', cleanupPending: true, nextAttemptAt: new Date(),
        ...(action === 'forget' ? { content: null, sourceJson: null, metadataJson: '{}' } : {}),
      },
    });
    // A source never handed to a worker has nothing upstream to remove.
    // CAS on attempts and lease avoids racing a first submission.
    await prisma.contextEvent.updateMany({
      where: { id, visibility: { not: 'active' }, attempts: 0, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
      data: { cleanupPending: false, deliveryStatus: 'completed', lastErrorCode: null },
    });
  }
  const row = await getContextEvent(principal, id);
  return { event: eventRecord(row), cleanupPending: row.cleanupPending };
}

export async function retryContextEvent(principal: ContextPrincipal, id: string, backend: HindsightBackend = hindsightBackend) {
  requireOwner(principal);
  const row = await getContextEvent(principal, id);
  if (row.visibility !== 'active' || row.deliveryStatus !== 'failed') throw new ContextError('not_retryable', 409);
  const leaseToken = randomUUID();
  const claimed = await prisma.contextEvent.updateMany({
    where: { id, visibility: 'active', deliveryStatus: 'failed', OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { leaseToken, leaseUntil: new Date(Date.now() + 60_000) },
  });
  if (!claimed.count) throw new ContextError('not_retryable', 409);
  let submitted = false;
  try { await backend.retry(row); submitted = true; }
  finally {
    await prisma.contextEvent.updateMany({
      where: { id, leaseToken },
      data: {
        deliveryStatus: submitted ? 'submitted' : 'retrying', nextAttemptAt: new Date(),
        leaseToken: null, leaseUntil: null,
      },
    });
  }
  return { jobId: id };
}
