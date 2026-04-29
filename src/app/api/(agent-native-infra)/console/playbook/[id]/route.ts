/**
 * PUT    /api/console/playbook/:id — 改
 * DELETE /api/console/playbook/:id — 删
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgPlaybookService, resolveConsoleContext } from '@/lib/academic';

export const PUT = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { id } = await ctx.params;
  const sectionId = Array.isArray(id) ? id[0] : id;
  const body = await req.json();
  const section = await orgPlaybookService.update(context.orgId, sectionId, body);
  return { data: { section } };
});

export const DELETE = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { id } = await ctx.params;
  const sectionId = Array.isArray(id) ? id[0] : id;
  await orgPlaybookService.delete(context.orgId, sectionId);
  return { data: { ok: true } };
});
