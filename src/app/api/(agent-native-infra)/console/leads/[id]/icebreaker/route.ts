/**
 * POST /api/console/leads/[id]/icebreaker
 *
 * 给顾问生成 2-3 条候选开场白。返回 drafts 数组。
 * 用于机构端 /console/leads/[id] 页面的"一键破冰"卡。
 */

import { academicRoute, AcademicError, resolveConsoleContext } from '@/lib/academic';
import { generateIcebreakers } from '@/lib/services/consult-icebreaker-service';

export const POST = academicRoute(async (req, ctxArg) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const raw = await ctxArg.params;
  const id = Array.isArray(raw.id) ? raw.id[0] : raw.id;
  if (!id) throw new AcademicError('INVALID_INPUT', 'lead id 缺失');

  const result = await generateIcebreakers({ orgId: ctx.orgId, leadId: id });
  if (result.drafts.length === 0) {
    throw new AcademicError('INTERNAL', 'LLM 返回为空或解析失败，请重试');
  }
  return { data: { drafts: result.drafts, costMs: result.ms } };
});
