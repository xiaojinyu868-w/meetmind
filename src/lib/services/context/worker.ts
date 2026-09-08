import { loadEnvConfig } from '@next/env';
import { setTimeout } from 'node:timers/promises';
import { createLogger } from '@/lib/logger';

const log = createLogger('context-worker');

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { getContextConfig } = await import('@/lib/config/context');
  const { dispatchContextBatch } = await import('./dispatcher');
  const { prisma } = await import('@/lib/prisma');
  if (!getContextConfig().backendUrl) throw new Error('CONTEXT_HINDSIGHT_URL is required');
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort());
  process.once('SIGTERM', () => stop.abort());
  log.info('Context delivery worker started');
  try {
    while (!stop.signal.aborted) {
      try { await dispatchContextBatch(); }
      catch { log.error('Context delivery cycle failed', { code: 'worker_cycle_failed' }); }
      await setTimeout(getContextConfig().dispatchIntervalMs, undefined, { signal: stop.signal }).catch(() => undefined);
    }
  } finally { await prisma.$disconnect(); }
}

void main().catch(() => {
  log.error('Context worker could not start; check backend configuration and database schema');
  process.exitCode = 1;
});
