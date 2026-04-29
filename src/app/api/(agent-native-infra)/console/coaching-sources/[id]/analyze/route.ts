/**
 * POST /api/console/coaching-sources/:id/analyze — 触发段级视频理解
 *
 * 这是一个同步执行的重操作（30-120s 取决于视频长度），不要设超时。
 */

import { NextRequest } from 'next/server';
import { academicRoute, coachingSourceService, resolveConsoleContext } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const { id } = await ctx.params;
  const sourceId = Array.isArray(id) ? id[0] : id;
  const analysis = await coachingSourceService.analyze(context.orgId, sourceId);
  return { data: { analysis } };
});

export const maxDuration = 300; // Next.js route timeout 5min
