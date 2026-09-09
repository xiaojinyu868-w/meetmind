import { loadEnvConfig } from '@next/env';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Explicit recovery only for a recorded synthetic fixture in this local checkout. */
async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  assert(process.env.NODE_ENV !== 'production', 'local_only');
  const userId = process.env.CONTEXT_FIXTURE_ID ?? '';
  assert(/^context-live-[0-9a-f-]{36}$/.test(userId), 'exact_fixture_id_required');
  const output = path.resolve('out/context-live', userId);
  const report = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8')) as { userId: string };
  assert.equal(report.userId, userId, 'fixture_report_mismatch');
  const { prisma } = await import('../../src/lib/prisma');
  const { ownerPrincipal } = await import('../../src/lib/services/context/access');
  const { controlContextEvent } = await import('../../src/lib/services/context/controls');
  const { hindsightBackend } = await import('../../src/lib/services/context/hindsight');
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    assert.equal(user.username, userId, 'not_synthetic_fixture');
    const rows = await prisma.contextEvent.findMany({ where: { userId } });
    if (process.env.CONTEXT_VERIFY_STATES === 'true') {
      assert(rows.every((row) => row.visibility !== 'active'), 'state_check_requires_paused_fixture');
      const base = process.env.SMOKE_BASE ?? 'http://127.0.0.1:45673';
      assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local_only');
      const { authService } = await import('../../src/lib/services/auth-service');
      const { verifyContextStates } = await import('./context-live-browser');
      const session = await authService.createSessionForUserId(userId);
      assert(session.accessToken);
      await verifyContextStates(base, session.accessToken, output);
      await writeFile(path.join(output, 'UI_STATES.json'), JSON.stringify({ status: 'verified',
        empty: 'real paused fixture', degraded: 'explicit HTTP response fixture', finishedAt: new Date().toISOString() }, null, 2));
    }
    await prisma.contextGrant.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
    for (const row of rows) await controlContextEvent(ownerPrincipal(userId), row.id, { action: 'forget' });
    const deadline = Date.now() + 240_000;
    while (true) {
      const pending = await prisma.contextEvent.count({ where: { userId, OR: [{ visibility: { not: 'forgotten' } }, { cleanupPending: true }] } });
      if (!pending) break;
      assert(Date.now() < deadline, 'cleanup_pending_keep_worker_running_and_retry');
      await delay(5_000);
    }
    for (const row of rows) {
      const current = await prisma.contextEvent.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(current.content, null);
      assert.equal((await hindsightBackend.operation(row)).status, 'not_found');
    }
    for (const space of new Set(rows.map((row) => row.spaceId))) {
      assert.equal((await hindsightBackend.recall(userId, space, 'all learning history', 4_000)).results.length, 0);
    }
    await prisma.$transaction([
      prisma.contextGrant.deleteMany({ where: { userId } }), prisma.contextEvent.deleteMany({ where: { userId } }),
      prisma.pointTransaction.deleteMany({ where: { userId } }), prisma.pointAccount.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);
    await writeFile(path.join(output, 'RECOVERY.json'), JSON.stringify({ userId, status: 'verified', events: rows.length, finishedAt: new Date().toISOString() }, null, 2));
    process.stdout.write('Synthetic fixture cleanup verified.\n');
  } finally { await prisma.$disconnect(); }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Cleanup incomplete; preserve fixture records: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown_error'}\n`);
  process.exitCode = 1;
});
