/**
 * POST /api/console/orgs/:id/onboarding — 推进 onboarding 步骤
 *
 * body: { step: 1 | 2 | 3 | 4 | 5 }
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgService, resolveConsoleContext } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const { id } = await ctx.params;
  const orgId = Array.isArray(id) ? id[0] : id;
  // 确保当前用户对这个 org 有 owner/consultant 权限
  const context = await resolveConsoleContext(req, {
    requireRole: ['owner', 'consultant'],
    overrideOrgId: orgId,
  });
  const body = await req.json();
  const org = await orgService.advanceOnboarding(context.orgId, Number(body.step));
  return { data: { org } };
});
