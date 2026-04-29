/**
 * GET  /api/console/scenarios — 列出本机构所有场景
 * POST /api/console/scenarios — 新建场景草稿
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgScenarioService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const list = await orgScenarioService.listByOrg(ctx.orgId);
  return { data: { scenarios: list } };
});

export const POST = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const body = await req.json();
  const scenario = await orgScenarioService.create(ctx.orgId, body);
  return { data: { scenario } };
});
