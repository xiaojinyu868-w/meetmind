/**
 * GET  /api/console/coaching-sources/:id          — 详情（含 analysisJson）
 * POST /api/console/coaching-sources/:id/analyze  — 触发段级分析（同步，可能 30-120s）
 */

import { NextRequest } from 'next/server';
import { academicRoute, coachingSourceService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const { id } = await ctx.params;
  const sourceId = Array.isArray(id) ? id[0] : id;
  const source = await coachingSourceService.getById(context.orgId, sourceId);
  return { data: { source } };
});
