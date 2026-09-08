import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { ContextClient, type ContextEventRecord, type UserContextBundle } from '../../packages/context-sdk/src';
import { verifyQuizBrowser } from './context-quiz-browser';
import { verifyContextStates, verifyLiveContextBrowser } from './context-live-browser';
import { liveTask, liveTutor } from './context-live-tutor';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:45673';
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local_only');
  assert(process.env.NODE_ENV !== 'production', 'local_only');
  assert(process.env.JWT_SECRET && process.env.CONTEXT_ENABLED === 'true' && process.env.CONTEXT_HINDSIGHT_URL, 'live_config_required');
  const { prisma } = await import('../../src/lib/prisma');
  const { authService } = await import('../../src/lib/services/auth-service');
  const { hindsightBackend } = await import('../../src/lib/services/context/hindsight');
  const userId = `context-live-${randomUUID()}`;
  const output = path.resolve('out/context-live', userId);
  await mkdir(output, { recursive: true });
  const report: Record<string, unknown> = { userId, startedAt: new Date().toISOString(), status: 'running',
    scope: 'Synthetic learner; actual MeetMind HTTP, worker, Hindsight, Tutor and Context UI. Quiz generation alone is a fixture. Classroom observation enters through the internal HTTP adapter, not audio capture.' };
  const checks: string[] = [];
  let owner: ContextClient | undefined;
  let failure: unknown;
  function pass(check: string): void { checks.push(check); process.stdout.write(`PASS ${check}\n`); }
  async function save(): Promise<void> { await writeFile(path.join(output, 'result.json'), JSON.stringify({ ...report, checks }, null, 2)); }
  async function waitJobs(ids: string[], cleanup = false): Promise<void> {
    const until = Date.now() + 240_000;
    while (true) {
      const jobs = await Promise.all(ids.map((id) => owner!.job(id)));
      if (jobs.every((job) => cleanup ? !job.cleanupPending : job.status === 'completed' && !job.cleanupPending)) return;
      assert(!jobs.some((job) => job.status === 'failed'), 'worker_failed');
      assert(Date.now() < until, `worker_deadline_${cleanup ? 'cleanup' : 'delivery'}`);
      await delay(5_000);
    }
  }
  function nonempty(bundle: UserContextBundle): void {
    assert.equal(bundle.degraded, false, `prepare_degraded_${bundle.reason}`);
    assert(bundle.memories.length > 0, 'live_memory_missing');
    assert(bundle.memories.every((memory) => memory.sourceEventIds.length > 0), 'uncited_memory');
  }
  try {
    // Compile routes before the SDK's normal 15-second request deadline starts.
    for (const route of ['/api/context/v1/events', '/api/memory/events', '/api/tutor/agent', '/context']) {
      await fetch(`${base}${route}`, { signal: AbortSignal.timeout(120_000) });
    }
    await prisma.user.create({ data: { id: userId, username: userId, nickname: '共享记忆真实联调（合成账户）' } });
    const session = await authService.createSessionForUserId(userId);
    assert(session.accessToken, 'fixture_login_failed');
    const token = session.accessToken;
    owner = new ContextClient({ baseUrl: `${base}/api/context/v1`, token });
    report.baseline = await liveTutor(base, token, true);
    pass('Actual Tutor completes a fresh conversation before history exists');
    await save();
    const classroom = '【合成验收学习经历】学生说：我一直把 P(A|B) 和 P(B|A) 搞反，尤其不知道分母应该选哪一群人。我希望先用我熟悉的羽毛球社团人数举例，每次只练一道题，不要先告诉答案。老师建议先圈出条件对应的人群；这只是建议，不代表学生已经掌握。';
    const accepted = await fetch(`${base}/api/memory/events`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'classroom', type: 'activity', sourceId: userId, idempotencyKey: `${userId}-classroom`,
        observation: { type: 'learning.observation', content: classroom },
        payload: { v: 1, kind: 'lesson', title: '条件概率课堂 · 合成联调', detail: '学生对条件方向和分母的困惑，保留原话及教师建议归属。' } }) });
    assert.equal(accepted.status, 202);
    const receipt = await accepted.json() as { eventId: string; backend: string };
    assert.equal(receipt.backend, 'context');
    assert.equal((await owner.source(receipt.eventId)).event.content, classroom);
    await waitJobs([receipt.eventId]);
    pass('Classroom observation reaches real Hindsight through internal HTTP and the running worker');
    const firstBundle = await owner.prepare({ task: { intent: liveTask }, budget: { maxTokens: 4_000 } });
    report.classroomBundle = firstBundle; await save(); nonempty(firstBundle);
    assert(firstBundle.memories.some((memory) => memory.sourceEventIds.includes(receipt.eventId)), 'classroom_citation_missing');
    report.withClassroom = await liveTutor(base, token, true);
    report.currentOnly = await liveTutor(base, token, false);
    pass('Real Tutor with history and current-only both complete the identical task');
    const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER ?? 'msedge', headless: true });
    try { await verifyQuizBrowser(browser, base, token); } finally { await browser.close(); }
    let events = (await owner.events()).events;
    const attempts = events.filter((event) => event.type === 'practice.attempt');
    assert.equal(attempts.length, 3, 'quiz_requires_three_real_ui_attempts');
    await waitJobs(events.map((event) => event.id));
    pass('Real quiz UI writes objective answer, self-report and repeat/reference exposure to shared memory');
    report.afterQuiz = await liveTutor(base, token, true);
    const corrected = await owner.append({ schemaVersion: 1, clientEventId: randomUUID(), type: 'learner.correction',
      content: '【合成验收，学生新的自述】更正我的旧偏好：我现在想改用天文观测的例子，不再用羽毛球。我能区分条件方向了，但基准率变化时还是会算错；这是我的自述，还没有新的独立测验验证。下一题请先练基准率。',
      source: { title: '学生更新 · 合成联调' }, occurredAt: new Date().toISOString() });
    await waitJobs([corrected.eventId]);
    report.correctionBundle = await owner.prepare({ task: { intent: liveTask }, budget: { maxTokens: 4_000 } });
    nonempty(report.correctionBundle as UserContextBundle);
    report.afterCorrection = await liveTutor(base, token, true);
    const correctionAnswer = (report.afterCorrection as Awaited<ReturnType<typeof liveTutor>>).answer;
    report.screenshots = await verifyLiveContextBrowser(base, token, receipt.eventId, output);
    pass('Context page displays real recalled memory and exact original source on desktop/mobile');
    assert(/天文|星空|行星|月相|观测/u.test(correctionAnswer), 'correction_not_reflected_in_tutor_answer');
    // Judge the exercise setting, not a historical comparison elsewhere in the answer.
    assert(!/羽毛球[^。！？\n]{0,30}(?:有|共有|其中)\s*\d/u.test(correctionAnswer), 'stale_exercise_setting');
    events = (await owner.events()).events;
    const correctionBundle = report.correctionBundle as UserContextBundle;
    assert(correctionBundle.sources.every((source) => events.some((event) => event.id === source.id)), 'foreign_source_in_bundle');
    assert(correctionBundle.sources.some((source) => source.id === corrected.eventId), 'correction_source_missing');
    pass('An explicit learner correction changes the next Tutor action and all recalled sources belong to this fixture');
    events = (await owner.events()).events;
    report.events = events;
    for (const event of events) await owner.control(event.id, 'pause');
    const paused = await owner.prepare({ task: { intent: liveTask } });
    assert.equal(paused.memories.length + paused.observations.length, 0, 'pause_leaked_context');
    report.pausedBundle = paused;
    report.afterPause = await liveTutor(base, token, true);
    pass('Pause immediately excludes every fixture source and derived memory from app reads');
    await verifyContextStates(base, token, output);
    pass('Real paused account renders empty portrait; an explicitly mocked outage renders degraded UI');
    await waitJobs(events.map((event) => event.id), true);
    const beforeResume = await prisma.contextEvent.findUniqueOrThrow({ where: { id: receipt.eventId } });
    await owner.control(receipt.eventId, 'resume');
    await waitJobs([receipt.eventId]);
    const resumedRow = await prisma.contextEvent.findUniqueOrThrow({ where: { id: receipt.eventId } });
    assert.notEqual(resumedRow.backendOperationId, beforeResume.backendOperationId);
    const resumed = await owner.prepare({ task: { intent: liveTask } }); nonempty(resumed);
    assert(resumed.memories.some((memory) => memory.sourceEventIds.includes(receipt.eventId)));
    pass('Resume waits for cleanup and reprocesses the original with a new upstream operation');
  } catch (error) {
    failure = error;
    report.error = error instanceof Error ? error.message.slice(0, 2_000) : 'unknown_error';
  } finally {
    try {
      const fixtureRows = await prisma.contextEvent.findMany({ where: { userId } });
      assert(owner || fixtureRows.length === 0, 'cleanup_requires_authenticated_owner');
      if (owner) {
        const rows = await prisma.contextEvent.findMany({ where: { userId } });
        for (const row of rows) await owner.control(row.id, 'forget');
        await waitJobs(rows.map((row) => row.id), true);
        for (const row of rows) {
          const source: ContextEventRecord = (await owner.source(row.id)).event;
          assert.equal(source.visibility, 'forgotten', 'forget_not_requested');
          assert.equal(source.cleanupPending, false, 'cleanup_not_complete');
          assert.equal(source.content, null, 'forget_original_survived');
          assert.equal((await hindsightBackend.operation(row)).status, 'not_found', 'operation_payload_survived');
        }
        const remote = await hindsightBackend.recall(userId, 'personal', liveTask, 4_000);
        assert.equal(remote.results.length, 0, 'upstream_memory_survived_forget');
        const bundle = await owner.prepare({ task: { intent: liveTask } });
        assert.equal(bundle.memories.length + bundle.observations.length, 0);
        pass('Forget removes originals, upstream memories and terminal operation payloads before fixture deletion');
      }
      await prisma.contextGrant.deleteMany({ where: { userId } });
      await prisma.contextEvent.deleteMany({ where: { userId } });
      await prisma.pointTransaction.deleteMany({ where: { userId } });
      await prisma.pointAccount.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      report.cleanup = 'verified';
    } catch (error) {
      failure ??= error;
      report.cleanup = 'incomplete; fixture records preserved. Re-run explicit cleanup; the worker cannot initiate a failed forget request.';
      report.cleanupError = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'unknown_error';
      await prisma.contextGrant.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
    }
    report.status = failure ? 'failed' : 'passed';
    report.finishedAt = new Date().toISOString();
    await save();
    const answers = ['baseline', 'withClassroom', 'currentOnly', 'afterQuiz', 'afterCorrection', 'afterPause'].map((key) => {
      const answer = report[key] as Awaited<ReturnType<typeof liveTutor>> | undefined;
      return answer ? `## ${key}\n\n${answer.answer}\n\nFinish: ${answer.finishReason}; duration: ${answer.durationMs} ms.` : '';
    }).filter(Boolean).join('\n\n');
    await writeFile(path.join(output, 'REPORT.md'), `# Context live application acceptance\n\nStatus: ${report.status}\n\n${report.scope}\n\nIdentical task in every fresh Tutor conversation: ${liveTask}\n\n${checks.map((check) => `- PASS: ${check}`).join('\n')}\n\n${answers}\n\nCleanup: ${report.cleanup}\n\nFull evidence and any failure: result.json. This single synthetic journey does not establish educational efficacy or a percentage improvement.\n`);
    process.stdout.write(`${JSON.stringify({ status: report.status, report: path.join(output, 'REPORT.md') })}\n`);
    await prisma.$disconnect();
  }
  if (failure) throw failure;
}

void main().catch((error: unknown) => {
  process.stderr.write(`Live Context acceptance failed: ${error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'unknown_error'}\n`);
  process.exitCode = 1;
});
