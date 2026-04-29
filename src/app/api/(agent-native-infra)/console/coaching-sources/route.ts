/**
 * GET  /api/console/coaching-sources           — 列出本机构的 CoachingSource
 * POST /api/console/coaching-sources           — 从一个 video/audio asset 创建 CoachingSource
 *   body: { assetId: string, title?: string }
 */

import { NextRequest } from 'next/server';
import { academicRoute, coachingSourceService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const list = await coachingSourceService.listByOrg(ctx.orgId);
  return { data: { sources: list } };
});

export const POST = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const body = await req.json();
  const src = await coachingSourceService.createFromAsset(
    ctx.orgId,
    ctx.userId,
    String(body.assetId || ''),
    body.title ? String(body.title) : undefined,
  );
  return { data: { source: src } };
});
