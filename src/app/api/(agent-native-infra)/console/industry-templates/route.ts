/**
 * GET /api/console/industry-templates — 6 个预置模板
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgService, resolveUserOnly } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  await resolveUserOnly(req); // 仅登录即可（onboarding 第 1 步需要看列表）
  const templates = await orgService.listIndustryTemplates();
  return { data: { templates } };
});
