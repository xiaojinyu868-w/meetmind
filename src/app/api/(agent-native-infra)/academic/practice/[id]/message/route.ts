/**
 * POST /api/academic/practice/:id/message — 追加一条学生消息，拿 AI 回复
 *   body: { content: string }
 */

import { NextRequest } from 'next/server';
import { academicRoute, practiceSessionService, resolveConsoleContext } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req);
  const { id } = await ctx.params;
  const sessionId = Array.isArray(id) ? id[0] : id;
  const body = await req.json();
  const result = await practiceSessionService.sendMessage({
    sessionId,
    userId: context.userId,
    orgId: context.orgId,
    content: String(body.content || ''),
  });
  return { data: result };
});
