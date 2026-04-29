/**
 * POST /api/console/orgs/:id/switch — 切换 activeOrgId
 */

import { NextRequest } from 'next/server';
import { academicRoute, resolveUserOnly, setActiveOrg } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const { userId } = await resolveUserOnly(req);
  const { id } = await ctx.params;
  const orgId = Array.isArray(id) ? id[0] : id;
  await setActiveOrg(userId, orgId);
  return { data: { ok: true, activeOrgId: orgId } };
});
