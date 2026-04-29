/**
 * GET /api/academic/checkpoints — 老师看：自己负责 + 未指派的 open checkpoint 列表
 */

import { NextRequest } from 'next/server';
import { academicRoute, checkpointService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['teacher', 'owner', 'consultant'] });
  const list = await checkpointService.listForTeacher(ctx.orgId, ctx.userId);
  return { data: { checkpoints: list } };
});
