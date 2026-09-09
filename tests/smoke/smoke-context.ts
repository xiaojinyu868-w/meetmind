import { loadEnvConfig } from '@next/env';
import { sharedContextCopy } from '@/lib/ui/shared-context-copy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { ContextClient, type UserContextBundle } from '../../packages/context-sdk/src';
import { COPY } from '../../src/lib/ui/copy';
import { buildQuizAttemptObservation } from '../../src/components/apps/windows/quiz-observation';
import { verifyQuizBrowser } from './context-quiz-browser';
import { verifyMcpProcess } from './context-mcp-process';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3101';
  assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local_only');
  assert(process.env.NODE_ENV !== 'production', 'local_only');
  assert(process.env.JWT_SECRET && process.env.CONTEXT_ENABLED === 'true', 'local_context_config_required');
  assert(!process.env.CONTEXT_HINDSIGHT_URL, 'synthetic_smoke_requires_no_remote_backend');
  const { prisma } = await import('../../src/lib/prisma');
  const { authService } = await import('../../src/lib/services/auth-service');
  const userId = `context-smoke-${randomUUID()}`;
  const fixtureUserIds = [userId, `${userId}-quiz`];
  const output = path.resolve('out/context-smoke');
  await mkdir(output, { recursive: true });
  const checks: string[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await prisma.user.create({ data: { id: userId, username: userId, nickname: 'Context 合成验收账户' } });
    const session = await authService.createSessionForUserId(userId);
    assert(session.accessToken, 'fixture_login_failed');
    const owner = new ContextClient({ baseUrl: `${base}/api/context/v1`, token: session.accessToken });
    const noAuth = await fetch(`${base}/api/context/v1/events`);
    assert.equal(noAuth.status, 401); checks.push('HTTP rejects anonymous access');
    const writerGrant = await owner.grant({ appId: 'classroom-demo', label: '课堂验收应用', capabilities: ['read', 'write'], spaceIds: ['personal'] });
    const readerGrant = await owner.grant({ appId: 'quiz-demo', label: '测验验收应用', capabilities: ['read'], spaceIds: ['personal'] });
    const writer = new ContextClient({ baseUrl: `${base}/api/context/v1`, token: writerGrant.token });
    const reader = new ContextClient({ baseUrl: `${base}/api/context/v1`, token: readerGrant.token });
    const event = {
      schemaVersion: 1 as const, clientEventId: randomUUID(), type: 'conversation.turn', spaceId: 'personal',
      content: '【合成验收数据】学生：我总是把 P(A|B) 和 P(B|A) 搞反。助手：下次可以画树状图再试一道题。这是建议，还不能说明学生已经掌握。',
      source: { title: '条件概率 · 课堂练习（合成验收）', kind: 'classroom' }, occurredAt: new Date().toISOString(),
    };
    const receipt = await writer.append(event);
    assert.equal((await writer.append(event)).eventId, receipt.eventId);
    const bundle = await reader.prepare({ task: { intent: '给我安排下一次概率练习' }, budget: { maxTokens: 4_000 } });
    assert(bundle.degraded && bundle.memories.length === 0);
    assert.equal(bundle.observations[0]?.id, receipt.eventId);
    checks.push('Separate app grants share authorized history; duplicate POST is idempotent');
    await assert.rejects(reader.append({ ...event, clientEventId: randomUUID() }), { status: 403 });
    checks.push('Read-only grant cannot write');

    browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER ?? 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1360, height: 1050 } });
    await page.addInitScript((token) => { localStorage.setItem('meetmind_access_token', token); }, session.accessToken);
    await page.goto(`${base}/context`);
    await page.getByText(event.source.title, { exact: true }).waitFor({ timeout: 60_000 });
    await page.getByText(sharedContextCopy.settings, { exact: true }).click();
    const appInput = page.getByLabel(sharedContextCopy.appId, { exact: true });
    await appInput.fill('invalid!');
    assert.equal(await appInput.evaluate((node) => (node as HTMLInputElement).checkValidity()), false);
    await appInput.fill('quiz-demo');
    assert.equal(await appInput.evaluate((node) => (node as HTMLInputElement).checkValidity()), true);
    await page.getByText(sharedContextCopy.settings, { exact: true }).click();
    checks.push('Browser validates app identifiers before grant creation');
    await page.getByLabel(sharedContextCopy.task, { exact: true }).fill('帮我安排一次条件概率练习');
    await page.getByRole('button', { name: sharedContextCopy.prepare, exact: true }).click();
    await page.getByTestId('context-task-result').getByText(sharedContextCopy.degraded, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'context-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'context-mobile.png'), fullPage: true });
    checks.push('Browser renders sources and honest degraded state on desktop/mobile');
    await page.getByRole('button', { name: sharedContextCopy.pause, exact: true }).click();
    await page.getByRole('button', { name: sharedContextCopy.resume, exact: true }).waitFor();
    assert.equal((await reader.prepare({ task: { intent: 'next quiz' } })).observations.length, 0);
    checks.push('User pause immediately removes the source from another app');
    await owner.control(receipt.eventId, 'forget');
    assert.equal((await owner.source(receipt.eventId)).event.content, null);
    await writer.append(event);
    assert.equal((await owner.source(receipt.eventId)).event.visibility, 'forgotten');
    checks.push('Forget erases the original and old delivery cannot resurrect it');
    const internalAttempt = await fetch(`${base}/api/memory/events`, {
      method: 'POST', headers: { Authorization: `Bearer ${writerGrant.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'application-matrix', type: 'activity' }),
    });
    assert.equal(internalAttempt.status, 401, 'legacy middleware must reject external grants');
    const fullObservation = buildQuizAttemptObservation({
      question: { id: 'synthetic-q1', type: 'single', stem: '【合成验收题面】条件概率的完整题干。'.repeat(25), options: ['A', 'B'], answer: 'A' },
      picked: 'B', referencePreviouslySeen: false,
    });
    const activity = await fetch(`${base}/api/memory/events`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: 'application-matrix', type: 'activity', sourceId: 'synthetic-quiz-session',
        idempotencyKey: `synthetic-quiz-${randomUUID()}`, observation: fullObservation, payload: { v: 1, kind: 'app', title: '合成测验活动摘要', detail: '合成数据：学生选择 B；本题答案为 A。', sessionId: 'synthetic-quiz-session', appKey: 'quiz' } }),
    });
    assert.equal(activity.status, 202);
    const acceptedActivity = await activity.json() as { eventId: string; backend: string };
    assert.equal(acceptedActivity.backend, 'context');
    assert((await reader.prepare({ task: { intent: 'next quiz' }, budget: { maxTokens: 8_000 } })).observations.some((observation) => observation.id === acceptedActivity.eventId));
    assert.equal((await reader.source(acceptedActivity.eventId)).event.content, fullObservation.content);
    checks.push('Full quiz evidence survives the internal adapter and cross-app reading; external grants cannot impersonate an internal app');
    const externalEvent = { ...event, clientEventId: randomUUID(), content: '【合成验收数据】独立练习应用：用户提交了 B 选项，本题答案是 A。' };
    const eventPath = path.join(output, 'external-event.json');
    await writeFile(eventPath, JSON.stringify(externalEvent));
    const child = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'examples/context-client/main.ts'], {
      timeout: 30_000, maxBuffer: 1_000_000,
      env: { ...process.env, MEETMIND_CONTEXT_URL: `${base}/api/context/v1`, MEETMIND_CONTEXT_TOKEN: writerGrant.token,
        MEETMIND_CONTEXT_EVENT_PATH: eventPath, MEETMIND_CONTEXT_TASK: '继续下一次练习' },
    });
    const independentBundle = JSON.parse(child.stdout) as UserContextBundle;
    assert.equal(independentBundle.observations[0]?.content, externalEvent.content);
    assert(independentBundle.degraded && independentBundle.memories.length === 0);
    checks.push('Independent application process writes an explicit event file and reads it through the portable SDK');
    await verifyMcpProcess(base, writerGrant.token, externalEvent);
    checks.push('Distributed MCP stdio process performs idempotent append, prepare and source reads through the real HTTP service');
    await owner.revoke(readerGrant.grant.id);
    await assert.rejects(reader.prepare({ task: { intent: 'next quiz' } }), { status: 401 });
    checks.push('Grant revocation is enforced through the real HTTP stack');
    const quizUserId = fixtureUserIds[1];
    await prisma.user.create({ data: { id: quizUserId, username: quizUserId, nickname: '测验合成验收账户' } });
    const quizSession = await authService.createSessionForUserId(quizUserId);
    assert(quizSession.accessToken);
    await verifyQuizBrowser(browser, base, quizSession.accessToken);
    checks.push('Real quiz UI preserves full selected answers, distinguishes self-assessment and records reference exposure on a separate repeat attempt');
    await writeFile(path.join(output, 'REPORT.md'), `# Context local acceptance\n\nSynthetic fixtures only; no model or Hindsight effect is claimed.\n\n${checks.map((check) => `- PASS: ${check}`).join('\n')}\n\nTemporary user and credentials removed after the run.\n`);
    process.stdout.write(`${JSON.stringify({ passed: checks.length, report: path.join(output, 'REPORT.md') })}\n`);
  } finally {
    await browser?.close();
    await prisma.contextGrant.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.contextEvent.deleteMany({ where: { userId: { in: fixtureUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const detail = error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'unknown_error';
  const location = error instanceof Error ? error.stack?.split('\n').find((line) => line.includes('smoke-context.ts:'))?.trim() : undefined;
  process.stderr.write(`Context smoke failed: ${detail}${location ? ` (${location})` : ''}\n`);
  process.exitCode = 1;
});
