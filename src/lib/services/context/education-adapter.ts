import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertPrincipalActive, ownerPrincipal } from './access';
import { appendContextEvent } from './events';
import { ContextError, parseInput } from './validation';

const legacyObservation = z.object({
  appId: z.string().min(1).max(40), type: z.string().min(1).max(40),
  sourceId: z.string().max(160).optional(), idempotencyKey: z.string().max(200).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  observation: z.object({
    type: z.string().regex(/^[\w.:-]{1,100}$/), content: z.string().min(1).max(40_000), locator: z.string().max(500).optional(),
  }).strict().optional(),
  payload: z.union([
    z.object({ v: z.literal(1), userText: z.string().min(1).max(3_000), assistantText: z.string().min(1).max(8_000) }).strict(),
    z.object({ v: z.literal(1), kind: z.string().max(60), title: z.string().min(1).max(80), detail: z.string().max(240).optional(), sessionId: z.string().max(120).optional(), appKey: z.string().max(60).optional() }).strict(),
  ]),
}).strict();

/** Education is a thin producer adapter, not an ontology in the memory core. */
export async function appendEducationObservation(userId: string, input: unknown) {
  const data = parseInput(legacyObservation, input);
  const principal = ownerPrincipal(userId);
  await assertPrincipalActive(principal);
  const clientEventId = createHash('sha256').update(JSON.stringify([
    data.appId, data.idempotencyKey ?? data.sourceId ?? randomUUID(),
  ])).digest('hex');
  const payload = data.payload;
  const content = data.observation?.content ?? ('userText' in payload
    ? JSON.stringify({ user: payload.userText, assistant: payload.assistantText })
    : JSON.stringify({ observedActivity: payload, note: 'An activity record does not establish understanding or mastery.' }));
  const key = { userId, appId: 'meetmind', clientEventId };
  const existing = !data.occurredAt ? await prisma.contextEvent.findUnique({ where: { userId_appId_clientEventId: key } }) : null;
  const event = {
    schemaVersion: 1 as const, clientEventId, type: data.observation?.type ?? ('userText' in payload ? 'conversation.turn' : 'learning.activity'),
    content, spaceId: 'personal', occurredAt: data.occurredAt ?? existing?.occurredAt.toISOString() ?? new Date().toISOString(),
    source: { title: 'title' in payload ? payload.title : data.appId, kind: data.appId, externalId: data.sourceId, locator: data.observation?.locator },
    metadata: { adapter: 'meetmind-education', reportedEventType: data.type },
  };
  try { return await appendContextEvent(principal, event); }
  catch (error) {
    // Older producers lack timestamps. Resolve an insert race to the first receipt time.
    if (data.occurredAt || !(error instanceof ContextError && error.code === 'idempotency_conflict')) throw error;
    const first = await prisma.contextEvent.findUnique({ where: { userId_appId_clientEventId: key } });
    if (!first) throw error;
    return appendContextEvent(principal, { ...event, occurredAt: first.occurredAt.toISOString() });
  }
}
