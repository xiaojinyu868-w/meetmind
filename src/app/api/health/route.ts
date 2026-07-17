import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const log = createLogger('health');

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const requiredTables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'User'
    `;
    if (requiredTables.length !== 1) {
      throw new Error('Required SQLite schema is missing');
    }

    return NextResponse.json(
      {
        status: 'ok',
        service: 'meetmind',
        uptimeSeconds: Math.floor(process.uptime()),
        checkedAt,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    log.error('readiness check failed', error);
    return NextResponse.json(
      {
        status: 'degraded',
        service: 'meetmind',
        checkedAt,
      },
      {
        status: 503,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
