/**
 * POST /api/console/orgs  — 创建机构（onboarding step 1）
 * GET  /api/console/orgs  — 等价于 /api/console/orgs/me（简化路径）
 *
 * 创建机构时当前用户自动成为 owner 并被切到该机构。
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgService, resolveUserOnly } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest) => {
  const { userId } = await resolveUserOnly(req);
  const body = await req.json();
  const org = await orgService.createOrg(userId, {
    name: body.name,
    contactEmail: body.contactEmail,
    industry: body.industry,
  });
  return { data: { org } };
});

export const GET = academicRoute(async (req: NextRequest) => {
  const { userId } = await resolveUserOnly(req);
  const list = await orgService.listMyOrgs(userId);
  return { data: { orgs: list } };
});
