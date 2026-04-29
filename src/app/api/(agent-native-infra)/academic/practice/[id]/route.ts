/**
 * GET  /api/academic/practice/:id — 读会话（消息历史）
 * POST /api/academic/practice/:id/message — 追加一条学生消息，拿 AI 回复
 * POST /api/academic/practice/:id/finish  — 结束会话
 */

import { NextRequest } from 'next/server';
import { academicRoute, practiceSessionService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req);
  const { id } = await ctx.params;
  const sessionId = Array.isArray(id) ? id[0] : id;
  const data = await practiceSessionService.getSessionForUser(context.orgId, context.userId, sessionId);
  return { data };
});
