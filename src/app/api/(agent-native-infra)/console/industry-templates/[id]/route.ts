/**
 * GET /api/console/industry-templates/:id — 单个模板（含 seedPlaybook + recommendedScenarios）
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgService, resolveUserOnly } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest, ctx) => {
  await resolveUserOnly(req);
  const { id } = await ctx.params;
  const templateId = Array.isArray(id) ? id[0] : id;
  const template = await orgService.getIndustryTemplate(templateId);
  return { data: { template } };
});
