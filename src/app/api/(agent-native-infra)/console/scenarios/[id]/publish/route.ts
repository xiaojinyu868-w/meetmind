/**
 * POST /api/console/scenarios/:id/publish — 发布场景（创建 version 快照）
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgScenarioService, resolveConsoleContext } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { id } = await ctx.params;
  const scenarioId = Array.isArray(id) ? id[0] : id;
  const result = await orgScenarioService.publish(context.orgId, scenarioId);
  return { data: result };
});
