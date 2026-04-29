/**
 * GET    /api/console/playbook — 列出当前机构 playbook 片段
 * POST   /api/console/playbook — 新增片段
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgPlaybookService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const list = await orgPlaybookService.listByOrg(ctx.orgId);
  return { data: { sections: list } };
});

export const POST = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const body = await req.json();
  const section = await orgPlaybookService.create(ctx.orgId, {
    title: body.title,
    sectionKind: body.sectionKind,
    body: body.body,
    tags: body.tags,
  });
  return { data: { section } };
});
