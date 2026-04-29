/**
 * GET    /api/console/leads/[id]   线索详情（含对话回放）
 * PATCH  /api/console/leads/[id]   更新线索状态 / 备注
 */

import { academicRoute, AcademicError, resolveConsoleContext } from '@/lib/academic';
import { prisma } from '@/lib/prisma';
import { updateLeadStatus } from '@/lib/services/consult-lead-service';
import { getSessionMessages } from '@/lib/services/consult-session-service';

const STATUSES = new Set(['new', 'contacted', 'converted', 'dropped']);

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export const GET = academicRoute(async (req, ctxArg) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const raw = await ctxArg.params;
  const id = Array.isArray(raw.id) ? raw.id[0] : raw.id;
  if (!id) throw new AcademicError('INVALID_INPUT', 'lead id 缺失');

  const lead = await prisma.consultLead.findUnique({ where: { id } });
  if (!lead || lead.orgId !== ctx.orgId) {
    throw new AcademicError('NOT_FOUND', '线索不存在或不属于当前机构');
  }

  // 对话回放：lead.sessionId 存在就拉；否则 fallback 按 (orgId, studentKey) 找一条全学生 session
  let sessionBundle: Awaited<ReturnType<typeof getSessionMessages>> = null;
  if (lead.sessionId) {
    sessionBundle = await getSessionMessages(lead.sessionId);
  } else {
    const fallback = await prisma.consultSession.findUnique({
      where: {
        orgId_studentKey: {
          orgId: lead.orgId,
          studentKey: lead.studentKey,
        },
      },
      select: { id: true },
    });
    if (fallback) sessionBundle = await getSessionMessages(fallback.id);
  }

  return {
    data: {
      lead: {
        id: lead.id,
        scenarioName: lead.scenarioName,
        reason: lead.reason,
        headline: lead.headline,
        consultantHint: lead.consultantHint,
        wechat: lead.wechat,
        phone: lead.phone,
        status: lead.status,
        notes: lead.notes,
        profileSnapshot: safeJson(lead.profileSnapshot),
        studentKey: lead.studentKey,
        sessionId: lead.sessionId,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      },
      session: sessionBundle
        ? {
            activeScenarioName: sessionBundle.activeScenarioName,
            visitedScenarios: sessionBundle.visitedScenarios,
            runtime: sessionBundle.runtime,
            messageCount: sessionBundle.messageCount,
            messages: sessionBundle.messages,
            startedAt: sessionBundle.startedAt,
            updatedAt: sessionBundle.updatedAt,
          }
        : null,
    },
  };
});

export const PATCH = academicRoute(async (req, ctxArg) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const raw = await ctxArg.params;
  const id = Array.isArray(raw.id) ? raw.id[0] : raw.id;
  if (!id) throw new AcademicError('INVALID_INPUT', 'lead id 缺失');
  const body = (await req.json().catch(() => ({}))) as { status?: string; notes?: string };

  const lead = await prisma.consultLead.findUnique({ where: { id } });
  if (!lead || lead.orgId !== ctx.orgId) {
    throw new AcademicError('NOT_FOUND', '线索不存在或不属于当前机构');
  }
  if (body.status && !STATUSES.has(body.status)) {
    throw new AcademicError('INVALID_INPUT', `status 必须是 ${[...STATUSES].join(' / ')}`);
  }

  const updated = await updateLeadStatus(
    ctx.orgId,
    id,
    (body.status as 'new' | 'contacted' | 'converted' | 'dropped') ?? (lead.status as 'new'),
    body.notes,
  );
  return { data: { lead: { id: updated.id, status: updated.status, notes: updated.notes, updatedAt: updated.updatedAt } } };
});
