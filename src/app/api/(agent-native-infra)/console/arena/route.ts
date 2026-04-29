/**
 * GET /api/console/arena
 *
 * 机构 Agent Arena v0：从真实 ConsultSession 中抽取 flagship case，
 * 对 tool trace / profile 状态做自动 scorecard。
 */

import { NextRequest } from 'next/server';
import { academicRoute, resolveConsoleContext } from '@/lib/academic';
import { getConsultArenaOverview } from '@/lib/services/consult-arena-service';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const arena = await getConsultArenaOverview(ctx.orgId);
  return { data: { arena } };
});
