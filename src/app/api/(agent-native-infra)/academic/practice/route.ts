/**
 * POST /api/academic/practice — 开启一次 PracticeSession
 *   body: { scenarioId: string, mode: 'text' | 'voice', studentInput?: Record<string,string> }
 */

import { NextRequest } from 'next/server';
import {
  academicProfileService,
  academicRoute,
  practiceSessionService,
  resolveConsoleContext,
} from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req);
  const body = await req.json();

  // 确保学生画像存在（V0 最小：没有就建空的）
  await academicProfileService.getOrCreate(ctx.orgId, ctx.userId);

  const result = await practiceSessionService.start({
    scenarioId: body.scenarioId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    mode: body.mode === 'voice' ? 'voice' : 'text',
    studentInput: body.studentInput,
  });
  return { data: result };
});

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req);
  const list = await practiceSessionService.listRecentForUser(ctx.orgId, ctx.userId);
  return { data: { sessions: list } };
});
