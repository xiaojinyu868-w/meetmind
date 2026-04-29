/**
 * GET /api/console/scenarios/:id — 读单场景
 * PUT /api/console/scenarios/:id — 改草稿
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgScenarioService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const { id } = await ctx.params;
  const scenarioId = Array.isArray(id) ? id[0] : id;
  const scenario = await orgScenarioService.getById(context.orgId, scenarioId);
  return { data: { scenario } };
});

export const PUT = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { id } = await ctx.params;
  const scenarioId = Array.isArray(id) ? id[0] : id;
  const body = await req.json();
  const scenario = await orgScenarioService.updateDraft(context.orgId, scenarioId, body);
  return { data: { scenario } };
});
