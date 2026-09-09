import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', async () => {
  const { createContextTestDatabase } = await import('./sqlite-fixture');
  const prisma = await createContextTestDatabase();
  return { prisma, default: prisma };
});
vi.mock('@/lib/services/auth-service', () => ({ authService: {
  verifyToken: (token: string) => ['alice', 'bob'].includes(token) ? { sub: token } : null,
} }));

import { prisma } from '@/lib/prisma';
import { authenticateContext, createGrant, ownerPrincipal, revokeGrant } from './access';
import { appendContextEvent, getContextEvent } from './events';
import { controlContextEvent, retryContextEvent } from './controls';
import { dispatchContextBatch } from './dispatcher';
import { HindsightBackend, contextBankId, hindsightBackend } from './hindsight';
import { prepareContext, resolveFactSources } from './prepare';
import { handleContextRequest } from './http';
import { appendEducationObservation } from './education-adapter';
import { tutorContextSuffix } from './tutor-adapter';
import { recordLearningObservation } from '../learning-observation-service';

const alice = ownerPrincipal('alice');
const bob = ownerPrincipal('bob');
const event = (key = 'turn-1', spaceId = 'personal') => ({
  schemaVersion: 1, clientEventId: key, type: 'conversation.turn', spaceId,
  content: 'User: I confuse conditional probability with the reverse conditional.',
  occurredAt: '2026-09-05T10:00:00.000Z', source: { title: 'Probability tutoring' },
});

async function due(): Promise<void> {
  await prisma.contextEvent.updateMany({ data: { nextAttemptAt: new Date(0) } });
}

function backendFixture() {
  const operations = new Map<string, string>();
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push({ url: path, body });
    if (path.endsWith('/memories')) {
      operations.set(String(body.operation_id), 'pending');
      return Response.json({ success: true, operation_id: body.operation_id });
    }
    if (path.endsWith('/delete')) {
      operations.delete(path.split('/').at(-2)!);
      return Response.json({ success: true });
    }
    if (path.includes('/operations/')) return Response.json({ status: operations.get(path.split('/').at(-1)!) ?? 'not_found' });
    return Response.json({ success: true });
  });
  return { backend: new HindsightBackend(fetcher as typeof fetch), operations, requests, fetcher };
}

beforeEach(async () => {
  vi.stubEnv('JWT_SECRET', 'isolated-test-secret');
  vi.stubEnv('CONTEXT_ENABLED', 'false');
  vi.stubEnv('CONTEXT_HINDSIGHT_URL', 'http://hindsight.test');
  await prisma.contextGrant.deleteMany();
  await prisma.contextEvent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({ data: { id: 'alice', username: 'alice', passwordHash: 'test-only', nickname: 'Alice' } });
  await prisma.user.create({ data: { id: 'bob', username: 'bob', passwordHash: 'test-only', nickname: 'Bob' } });
});
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });

describe('durable source and scoped application access', () => {
  it('refuses owner authentication when the deployment has no signing secret', async () => {
    vi.stubEnv('JWT_SECRET', '');
    await expect(authenticateContext('Bearer alice')).rejects.toMatchObject({ code: 'auth_not_configured' });
  });

  it('adapts classroom and dialog evidence without imposing cognitive categories', async () => {
    const input = { appId: 'global-ask', type: 'progress', sourceId: 'turn-1', payload: { v: 1, userText: 'I am stuck', assistantText: 'Try a tree diagram' } };
    const first = await appendEducationObservation('alice', input);
    const second = await appendEducationObservation('alice', input);
    expect(second.eventId).toBe(first.eventId);
    const row = await getContextEvent(alice, first.eventId);
    expect(row.type).toBe('conversation.turn');
    expect(JSON.parse(row.content!)).toEqual({ user: 'I am stuck', assistant: 'Try a tree diagram' });
    const lesson = await appendEducationObservation('alice', { appId: 'classroom', type: 'activity', payload: { v: 1, kind: 'lesson', title: 'Bayes', detail: 'Classroom topic' } });
    expect((await getContextEvent(alice, lesson.eventId)).content).toContain('does not establish understanding');
    vi.stubEnv('CONTEXT_ENABLED', 'true');
    const recorded = await recordLearningObservation('alice', { appId: 'classroom', type: 'activity', sourceId: 'classroom-hook', payload: { v: 1, kind: 'lesson', title: 'From the classroom producer' } });
    expect(await prisma.contextEvent.count({ where: { userId: 'alice' } })).toBe(3);
    // 双写：事实表同一条也在（掌握轨迹 / P0 画像的原料不因 Context 开启而断）
    expect(recorded.eventId).toBeTruthy();
    expect(recorded.receipt?.eventId).toBeTruthy();
    expect(await prisma.learningEvent.count({ where: { userId: 'alice' } })).toBe(1);
    // 应用矩阵的 assessment 载荷也进 Context：按概念的结果 + 自评 / 应用判分的依据标注
    const assessment = await appendEducationObservation('alice', { appId: 'apps', type: 'assessment', sourceId: 'quiz-1', idempotencyKey: 'assess-1',
      payload: { v: 1, appKey: 'flashcards', sessionId: 's1', lessonTitle: 'Bayes', items: [{ concept: 'P(A|B) vs P(B|A)', outcome: 'missed', evidence: { startMs: 30000 } }] } });
    const assessmentRow = await getContextEvent(alice, assessment.eventId);
    expect(assessmentRow.type).toBe('practice.assessment');
    const parsed = JSON.parse(assessmentRow.content!);
    expect(parsed.items[0]).toMatchObject({ concept: 'P(A|B) vs P(B|A)', outcome: 'missed', basis: 'learner_self_report' });
    expect(JSON.parse(assessmentRow.sourceJson!).locator).toBe('session:s1');
  });
  it('isolates idempotency across users and apps and rejects changed contents', async () => {
    const first = await appendContextEvent(alice, event());
    const duplicate = await appendContextEvent(alice, event());
    expect(duplicate).toMatchObject({ eventId: first.eventId, duplicate: true });
    expect((await appendContextEvent(bob, event())).eventId).not.toBe(first.eventId);
    expect((await appendContextEvent({ ...alice, appId: 'quiz' }, event())).eventId).not.toBe(first.eventId);
    await expect(appendContextEvent(alice, { ...event(), content: 'changed' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await expect(getContextEvent(bob, first.eventId)).rejects.toMatchObject({ status: 404 });
  });

  it('preserves full application evidence beyond the legacy summary without accepting identity overrides', async () => {
    const content = JSON.stringify({ question: 'Original question '.repeat(60), response: 'B', answerRevealed: false });
    const input = { appId: 'application-matrix', type: 'activity', sourceId: 'lesson-1', idempotencyKey: 'attempt-1',
      payload: { v: 1, kind: 'app', title: 'Quiz summary', detail: 'A short display summary.' },
      observation: { type: 'practice.attempt', content, locator: 'question:q-1' } };
    const receipt = await appendEducationObservation('alice', input);
    const row = await getContextEvent(alice, receipt.eventId);
    expect(row).toMatchObject({ content, type: 'practice.attempt', appId: 'meetmind', spaceId: 'personal' });
    expect(JSON.parse(row.sourceJson!).locator).toBe('question:q-1');
    await expect(appendEducationObservation('alice', { ...input, observation: { ...input.observation, userId: 'bob' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('enforces capabilities, spaces, expiration and revocation; only saves a token hash', async () => {
    const { token, grant } = await createGrant(alice, { appId: 'quiz', label: 'Quiz', capabilities: ['read'], spaceIds: ['math'] });
    const principal = await authenticateContext(`Bearer ${token}`);
    expect(principal).toMatchObject({ userId: 'alice', appId: 'quiz', owner: false });
    expect((await prisma.contextGrant.findUniqueOrThrow({ where: { id: grant.id } })).tokenHash).not.toContain(token);
    await expect(appendContextEvent(principal, event())).rejects.toMatchObject({ status: 403 });
    await expect(prepareContext(principal, { task: { intent: 'math' }, scope: { spaceIds: ['personal'] } })).rejects.toMatchObject({ status: 403 });
    await expect(createGrant(principal, {})).rejects.toMatchObject({ code: 'owner_required' });
    await revokeGrant(alice, grant.id);
    await expect(authenticateContext(`Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    const second = await createGrant(alice, { appId: 'quiz', label: 'Quiz', capabilities: ['read'], spaceIds: ['math'] });
    await prisma.contextGrant.update({ where: { id: second.grant.id }, data: { expiresAt: new Date(0) } });
    await expect(authenticateContext(`Bearer ${second.token}`)).rejects.toMatchObject({ status: 401 });
  });

  it('never accepts a caller-supplied user identity and returns stable HTTP errors', async () => {
    const request = (body: unknown, token = 'alice') => new Request('http://localhost/api/context/v1/events', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    expect((await handleContextRequest(request({ ...event(), userId: 'bob' }), ['events'])).status).toBe(400);
    expect((await handleContextRequest(request(event(), 'invalid'), ['events'])).status).toBe(401);
    const response = await handleContextRequest(request(event()), ['events']);
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ duplicate: false, status: 'queued' });
    expect((await handleContextRequest(request({ content: 'a'.repeat(200_000) }), ['events'])).status).toBe(413);
  });

  it('forgets raw content and prevents idempotent replay from resurrecting it', async () => {
    const receipt = await appendContextEvent(alice, event());
    await controlContextEvent(alice, receipt.eventId, { action: 'forget' });
    await appendContextEvent(alice, event());
    expect(await getContextEvent(alice, receipt.eventId)).toMatchObject({ content: null, visibility: 'forgotten', sourceJson: null, metadataJson: '{}' });
    await expect(controlContextEvent(alice, receipt.eventId, { action: 'resume' })).rejects.toMatchObject({ code: 'source_forgotten' });
  });

  it('does not expose a forgotten receipt through a later grant to another space', async () => {
    const app = { ...alice, appId: 'quiz' };
    const receipt = await appendContextEvent(app, event('shared-key', 'private-course'));
    await controlContextEvent(alice, receipt.eventId, { action: 'forget' });
    const restricted = { ...app, owner: false, spaceIds: ['personal'] };
    await expect(appendContextEvent(restricted, event('shared-key'))).rejects.toMatchObject({ status: 403 });
  });
});

describe('upstream worker reuse and recovery', () => {
  it('resumes a never-submitted source without requiring a configured backend', async () => {
    vi.stubEnv('CONTEXT_HINDSIGHT_URL', '');
    const { eventId } = await appendContextEvent(alice, event());
    await controlContextEvent(alice, eventId, { action: 'pause' });
    expect((await getContextEvent(alice, eventId)).cleanupPending).toBe(false);
    await controlContextEvent(alice, eventId, { action: 'resume' });
    expect((await getContextEvent(alice, eventId)).visibility).toBe('active');
  });

  it('removes the task payload and recovers a lost operation-delete acknowledgement', async () => {
    const fixture = backendFixture();
    const { eventId } = await appendContextEvent(alice, event());
    await dispatchContextBatch(fixture.backend);
    const row = await getContextEvent(alice, eventId);
    fixture.operations.set(row.backendOperationId, 'completed');
    await controlContextEvent(alice, eventId, { action: 'forget' });
    const realRemove = fixture.backend.removeOperation.bind(fixture.backend);
    vi.spyOn(fixture.backend, 'removeOperation').mockImplementationOnce(async (record) => {
      await realRemove(record); throw new Error('lost delete acknowledgement');
    });
    await due(); await dispatchContextBatch(fixture.backend);
    expect(await getContextEvent(alice, eventId)).toMatchObject({ cleanupPending: true, cleanupStage: 'document_removed' });
    await due(); await dispatchContextBatch(fixture.backend);
    expect(await getContextEvent(alice, eventId)).toMatchObject({ cleanupPending: false, content: null });
    expect(fixture.operations.has(row.backendOperationId)).toBe(false);
  });

  it('serializes an explicit retry with concurrent forgetting', async () => {
    const fixture = backendFixture();
    const { eventId } = await appendContextEvent(alice, event());
    await prisma.contextEvent.update({ where: { id: eventId }, data: { attempts: 1, deliveryStatus: 'failed' } });
    const row = await getContextEvent(alice, eventId);
    fixture.operations.set(row.backendOperationId, 'failed');
    vi.spyOn(fixture.backend, 'retry').mockImplementation(async () => {
      await controlContextEvent(alice, eventId, { action: 'forget' });
      expect(await dispatchContextBatch(fixture.backend)).toBe(0);
      fixture.operations.set(row.backendOperationId, 'pending');
    });
    await retryContextEvent(alice, eventId, fixture.backend);
    await due(); await dispatchContextBatch(fixture.backend);
    expect((await getContextEvent(alice, eventId)).cleanupPending).toBe(true);
    expect(fixture.operations.get(row.backendOperationId)).toBe('pending');
  });
  it('keeps one operation across a lost acknowledgement and resumes after restart', async () => {
    const fixture = backendFixture();
    const { eventId } = await appendContextEvent(alice, event());
    const original = await getContextEvent(alice, eventId);
    const realRetain = fixture.backend.retain.bind(fixture.backend);
    const failedAck = vi.spyOn(fixture.backend, 'retain').mockImplementationOnce(async (row) => {
      await realRetain(row);
      throw new Error('lost acknowledgement');
    });
    await dispatchContextBatch(fixture.backend);
    expect(await getContextEvent(alice, eventId)).toMatchObject({ deliveryStatus: 'retrying', attempts: 1 });
    await due();
    await dispatchContextBatch(fixture.backend);
    expect(failedAck).toHaveBeenCalledTimes(1);
    fixture.operations.set(original.backendOperationId, 'completed');
    await due();
    await dispatchContextBatch(fixture.backend);
    expect(await getContextEvent(alice, eventId)).toMatchObject({ deliveryStatus: 'completed', backendOperationId: original.backendOperationId });
  });

  it('a live lease prevents a second dispatcher; expired leases can recover', async () => {
    const { backend } = backendFixture();
    const { eventId } = await appendContextEvent(alice, event());
    await prisma.contextEvent.update({ where: { id: eventId }, data: { leaseToken: 'dead-process', leaseUntil: new Date(Date.now() + 60_000) } });
    expect(await dispatchContextBatch(backend)).toBe(0);
    await prisma.contextEvent.update({ where: { id: eventId }, data: { leaseUntil: new Date(0) } });
    expect(await dispatchContextBatch(backend)).toBe(1);
  });

  it('waits for an in-flight retain before deleting upstream, then allows a fresh resume', async () => {
    const fixture = backendFixture();
    const { eventId } = await appendContextEvent(alice, event());
    await dispatchContextBatch(fixture.backend);
    await controlContextEvent(alice, eventId, { action: 'pause' });
    await due();
    await dispatchContextBatch(fixture.backend);
    await expect(controlContextEvent(alice, eventId, { action: 'resume' })).rejects.toMatchObject({ code: 'cleanup_in_progress' });
    expect(fixture.requests.some((request) => request.url.includes('/documents/'))).toBe(false);
    const old = await getContextEvent(alice, eventId);
    fixture.operations.set(old.backendOperationId, 'completed');
    await due();
    await dispatchContextBatch(fixture.backend);
    expect(fixture.requests.some((request) => request.url.endsWith(`/documents/${eventId}`))).toBe(true);
    await controlContextEvent(alice, eventId, { action: 'resume' });
    const resumed = await getContextEvent(alice, eventId);
    expect(resumed.backendOperationId).not.toBe(old.backendOperationId);
    expect(resumed).toMatchObject({ visibility: 'active', deliveryStatus: 'queued', attempts: 0 });
  });

  it('retains a pending cleanup when a timed-out operation cannot yet be confirmed', async () => {
    const { backend } = backendFixture();
    const { eventId } = await appendContextEvent(alice, event());
    await prisma.contextEvent.update({ where: { id: eventId }, data: { attempts: 1 } });
    await controlContextEvent(alice, eventId, { action: 'forget' });
    await dispatchContextBatch(backend);
    expect(await getContextEvent(alice, eventId)).toMatchObject({ cleanupPending: true, lastErrorCode: 'cleanup_unconfirmed' });
  });
});

describe('context preparation with grounded provenance', () => {
  it('preserves the latest completed correction when older recalled memories consume the Tutor budget', async () => {
    vi.stubEnv('CONTEXT_ENABLED', 'true');
    const old = await appendContextEvent(alice, event('old-preference'));
    const corrected = await appendContextEvent(alice, { ...event('correction'), type: 'learner.correction',
      content: 'My current preference is astronomy examples. This is a self-report, not a test result.', occurredAt: '2026-09-08T10:00:00.000Z' });
    await prisma.contextEvent.updateMany({ data: { deliveryStatus: 'completed' } });
    const recall = vi.spyOn(hindsightBackend, 'recall').mockResolvedValue({ results: [
      { id: 'old', text: 'Use badminton examples. '.repeat(100), document_id: old.eventId },
    ] });
    try {
      const suffix = await tutorContextSuffix({ authorization: 'Bearer alice', mode: 'global', personalContext: true, task: 'Next practice' });
      expect(suffix).toContain('My current preference is astronomy examples.');
      expect(suffix).toContain(corrected.eventId);
    } finally { recall.mockRestore(); }
  });
  it('keeps a requested source ahead of a busy stream and leaves a handle when its budget is too small', async () => {
    const { eventId } = await appendContextEvent(alice, event('requested'));
    await prisma.contextEvent.update({ where: { id: eventId }, data: { createdAt: new Date(0) } });
    for (let index = 0; index < 13; index += 1) await appendContextEvent(alice, event(`newer-${index}`));
    const { backend } = backendFixture();
    vi.spyOn(backend, 'recall').mockResolvedValue({ results: [{ id: 'history', text: 'history '.repeat(90), document_id: eventId }] });
    const input = { task: { intent: 'continue from the submitted answer' }, afterEventId: eventId, budget: { maxTokens: 1_000 } };
    const bundle = await prepareContext(alice, input, backend);
    expect(bundle.observations[0]?.id).toBe(eventId);
    expect(bundle.pendingEventIds).toContain(eventId);
    const small = await prepareContext(alice, { ...input, budget: { maxTokens: 128 } }, backend);
    expect(small.sources.map((source) => source.id)).toContain(eventId);
    expect(Buffer.byteLength(small.text)).toBeLessThanOrEqual(128);
    await controlContextEvent(alice, eventId, { action: 'pause' });
    const paused = await prepareContext(alice, input, backend);
    expect(paused.sources.map((source) => source.id)).not.toContain(eventId);
  });

  it('keeps shared/current-only/guest Tutor paths private and connects an owner global turn', async () => {
    vi.stubEnv('CONTEXT_ENABLED', 'true');
    vi.stubEnv('CONTEXT_HINDSIGHT_URL', '');
    await appendContextEvent(alice, event());
    const input = { authorization: 'Bearer alice', mode: 'global', personalContext: true, task: 'Next practice' };
    expect(await tutorContextSuffix({ ...input, mode: 'shared' })).toBe('');
    expect(await tutorContextSuffix({ ...input, personalContext: false })).toBe('');
    expect(await tutorContextSuffix({ ...input, authorization: null })).toBe('');
    expect(await tutorContextSuffix(input)).toContain(event().content);
    vi.stubEnv('CONTEXT_ENABLED', 'false');
    expect(await tutorContextSuffix(input)).toBe('');
  });
  it('shares authorized history across applications and removes paused/stale/foreign evidence', async () => {
    const { eventId } = await appendContextEvent(alice, event());
    const foreign = await appendContextEvent(bob, event());
    const { backend } = backendFixture();
    vi.spyOn(backend, 'recall').mockResolvedValue({ results: [
      { id: 'good', text: 'Conditional probability needs another example.', document_id: eventId },
      { id: 'foreign', text: 'private', document_id: foreign.eventId },
      { id: 'unsupported', text: 'uncited' },
    ] });
    const { token } = await createGrant(alice, { appId: 'quiz', label: 'Quiz', capabilities: ['read'], spaceIds: ['personal'] });
    const quiz = await authenticateContext(`Bearer ${token}`);
    const bundle = await prepareContext(quiz, { task: { intent: 'Choose a probability quiz' } }, backend);
    expect(bundle.memories.map((memory) => memory.id)).toEqual(['personal:good']);
    expect(bundle.sources[0].id).toBe(eventId);
    await controlContextEvent(alice, eventId, { action: 'pause' });
    expect((await prepareContext(quiz, { task: { intent: 'quiz' } }, backend)).memories).toEqual([]);
  });

  it('rechecks grant revocation after a slow recall', async () => {
    const { backend } = backendFixture();
    const { token, grant } = await createGrant(alice, { appId: 'quiz', label: 'Quiz', capabilities: ['read'], spaceIds: ['personal'] });
    const principal = await authenticateContext(`Bearer ${token}`);
    vi.spyOn(backend, 'recall').mockImplementation(async () => {
      await revokeGrant(alice, grant.id);
      return { results: [] };
    });
    await expect(prepareContext(principal, { task: { intent: 'quiz' } }, backend)).rejects.toMatchObject({ status: 401 });
  });

  it('distinguishes unprocessed observations from memories during backend outages', async () => {
    vi.stubEnv('CONTEXT_HINDSIGHT_URL', '');
    const { eventId } = await appendContextEvent(alice, event());
    const bundle = await prepareContext(alice, { task: { intent: 'quiz' } });
    expect(bundle).toMatchObject({ degraded: true, reason: 'backend_not_configured', memories: [], pendingEventIds: [eventId] });
    expect(bundle.observations[0].content).toBe(event().content);
    const small = await prepareContext(alice, { task: { intent: 'quiz' }, budget: { maxTokens: 128 } });
    expect(Buffer.byteLength(small.text)).toBeLessThanOrEqual(128);
  });

  it('requires all source leaves; cycles and truncated provenance never authorize memory', () => {
    const observation = { id: 'o', text: 'combined', source_fact_ids: ['a', 'b'] };
    expect(resolveFactSources(observation, { results: [], source_facts: { a: { id: 'a', text: 'a', document_id: 'doc-a' } } })).toBeNull();
    expect(resolveFactSources(observation, { results: [], source_facts: {
      a: { id: 'a', text: 'a', document_id: 'doc-a' }, b: { id: 'b', text: 'b', document_id: 'doc-b' },
    } })).toEqual(['doc-a', 'doc-b']);
    expect(resolveFactSources({ id: 'o', text: '', source_fact_ids: ['o'] }, { results: [], source_facts: { o: observation } })).toBeNull();
    expect(contextBankId('alice', 'personal')).not.toBe(contextBankId('bob', 'personal'));
    expect(contextBankId('alice', 'personal')).not.toBe(contextBankId('alice', 'math'));
  });
});
