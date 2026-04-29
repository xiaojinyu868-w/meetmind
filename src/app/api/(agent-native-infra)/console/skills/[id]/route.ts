/**
 * PATCH  /api/console/skills/[id]  审核 / 驳回
 *   body: { action: "approve" | "reject", reason?: string }
 * DELETE /api/console/skills/[id]  删除
 */

import { NextRequest } from 'next/server';
import { academicRoute, AcademicError, resolveConsoleContext } from '@/lib/academic';
import {
  approveOrgSkill,
  rejectOrgSkill,
  deleteOrgSkill,
  SkillImportError,
} from '@/lib/services/consult-skill-import-service';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const PATCH = academicRoute(async (req, ctxArg) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner'] });
  const raw = await ctxArg.params;
  const id = Array.isArray(raw.id) ? raw.id[0] : raw.id;
  if (!id) throw new AcademicError('INVALID_INPUT', 'skill id 缺失');
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };

  try {
    if (body.action === 'approve') {
      await approveOrgSkill(ctx.orgId, id, ctx.userId);
      return { data: { id, status: 'approved' } };
    }
    if (body.action === 'reject') {
      if (!body.reason || !body.reason.trim()) {
        throw new AcademicError('INVALID_INPUT', '驳回必须填写 reason');
      }
      await rejectOrgSkill(ctx.orgId, id, ctx.userId, body.reason.trim());
      return { data: { id, status: 'rejected' } };
    }
    throw new AcademicError('INVALID_INPUT', 'action 必须是 approve 或 reject');
  } catch (e) {
    if (e instanceof SkillImportError) {
      throw new AcademicError('INVALID_INPUT', e.message + (e.details ? `\n${e.details}` : ''));
    }
    throw e;
  }
});

export const DELETE = academicRoute(async (req, ctxArg) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner'] });
  const raw = await ctxArg.params;
  const id = Array.isArray(raw.id) ? raw.id[0] : raw.id;
  if (!id) throw new AcademicError('INVALID_INPUT', 'skill id 缺失');
  try {
    await deleteOrgSkill(ctx.orgId, id);
    return { data: { id, status: 'deleted' } };
  } catch (e) {
    if (e instanceof SkillImportError) {
      throw new AcademicError('INVALID_INPUT', e.message);
    }
    throw e;
  }
});
