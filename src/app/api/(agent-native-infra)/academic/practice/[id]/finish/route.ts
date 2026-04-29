/**
 * POST /api/academic/practice/:id/finish — 结束会话
 */

import { NextRequest } from 'next/server';
import { academicRoute, practiceSessionService, resolveConsoleContext } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req);
  const { id } = await ctx.params;
  const sessionId = Array.isArray(id) ? id[0] : id;
  const session = await practiceSessionService.finish(context.orgId, context.userId, sessionId);
  return { data: { session } };
});
