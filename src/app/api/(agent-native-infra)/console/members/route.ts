/**
 * GET  /api/console/members — 列出本机构成员
 * POST /api/console/members — 生成邀请 token（V0 不发邮件，返回 token，机构主手动把链接发出去）
 *   body: { role: 'teacher' | 'student' | 'consultant', email?: string }
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgMemberService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const members = await orgMemberService.listMembers(ctx.orgId);
  const invites = await orgMemberService.listInvites(ctx.orgId);
  return { data: { members, invites } };
});

export const POST = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const body = await req.json();
  const invite = await orgMemberService.createInvite(ctx.orgId, ctx.userId, {
    role: body.role,
    email: body.email,
  });
  return { data: { invite } };
});
