/**
 * GET /api/console/orgs/me — 当前用户所属机构 + activeOrgId
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { academicRoute, orgService, resolveUserOnly } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const { userId } = await resolveUserOnly(req);
  const [memberships, user] = await Promise.all([
    orgService.listMyOrgs(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { activeOrgId: true } }),
  ]);
  return {
    data: {
      orgs: memberships,
      activeOrgId: user?.activeOrgId ?? null,
    },
  };
});
