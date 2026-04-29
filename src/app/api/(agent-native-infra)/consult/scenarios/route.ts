/**
 * GET /api/consult/scenarios
 * 返回当前可用的 consult scenario 清单（name + description）
 */

import { NextResponse } from 'next/server';
import { listScenarios } from '@/lib/services/consult-skill-registry';

export const runtime = 'nodejs';

export async function GET() {
  const list = await listScenarios();
  return NextResponse.json({
    success: true,
    data: {
      scenarios: list.map((s) => ({ name: s.name, description: s.description })),
    },
  });
}
