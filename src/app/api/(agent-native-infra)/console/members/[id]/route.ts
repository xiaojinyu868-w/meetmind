/**
 * DELETE /api/console/members/:id — 移除成员
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgMemberService, resolveConsoleContext } from '@/lib/academic';

export const DELETE = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { id } = await ctx.params;
  const memberId = Array.isArray(id) ? id[0] : id;
  await orgMemberService.removeMember(context.orgId, memberId, context.role);
  return { data: { ok: true } };
});
