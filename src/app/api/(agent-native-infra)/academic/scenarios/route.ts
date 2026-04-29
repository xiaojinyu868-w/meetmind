/**
 * GET /api/academic/scenarios — 学生端：当前 org 的已发布场景列表
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgScenarioService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  // 学生也必须先是 org 成员才能看；consultant/teacher/owner 也可以看
  const ctx = await resolveConsoleContext(req);
  const scenarios = await orgScenarioService.listPublishedForStudent(ctx.orgId);
  return { data: { scenarios } };
});
