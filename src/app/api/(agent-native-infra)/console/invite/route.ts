/**
 * GET /api/console/invite/resolve?token=xxx — 登录前后都可查询邀请信息（展示机构名、角色）
 * POST /api/console/invite/accept — 登录后接受邀请
 *   body: { token: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { academicRoute, orgMemberService, resolveUserOnly } from '@/lib/academic';
import { AcademicError } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) throw new AcademicError('INVALID_INPUT', '缺少 token');
  const invite = await prisma.orgInvite.findUnique({
    where: { token },
    include: { org: { select: { id: true, name: true, industry: true } } },
  });
  if (!invite) throw new AcademicError('NOT_FOUND', '邀请链接无效');
  return {
    data: {
      invite: {
        role: invite.role,
        email: invite.email,
        expiresAt: invite.expiresAt,
        usedAt: invite.usedAt,
        org: invite.org,
      },
    },
  };
});

export const POST = academicRoute(async (req: NextRequest) => {
  const { userId } = await resolveUserOnly(req);
  const body = await req.json();
  const token = String(body.token || '');
  if (!token) throw new AcademicError('INVALID_INPUT', '缺少 token');
  const result = await orgMemberService.acceptInvite(token, userId);
  return { data: result };
});

// 兼容性：有些前端工具会对 OPTIONS 做预检
export const OPTIONS = async () => NextResponse.json({ ok: true });
