/**
 * GET  /api/console/leads          列出机构的线索
 */

import { NextRequest } from 'next/server';
import { academicRoute, resolveConsoleContext } from '@/lib/academic';
import { prisma } from '@/lib/prisma';
import { listLeads } from '@/lib/services/consult-lead-service';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const limit = Math.min(Number(searchParams.get('limit') || '100'), 500);
  const leads = await listLeads(ctx.orgId, { status, limit });

  // 一次性拉所有相关 session 的 messageCount（给列表卡"回看对话 N 轮"用）
  const sessionIds = leads.map((l) => l.sessionId).filter(Boolean) as string[];
  const sessions = sessionIds.length
    ? await prisma.consultSession.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, messageCount: true },
      })
    : [];
  const sessionMsgMap = new Map(sessions.map((s) => [s.id, s.messageCount]));

  return {
    data: {
      leads: leads.map((l) => ({
        id: l.id,
        scenarioName: l.scenarioName,
        reason: l.reason,
        headline: l.headline,
        consultantHint: l.consultantHint,
        wechat: l.wechat,
        phone: l.phone,
        status: l.status,
        notes: l.notes,
        profileSnapshot: safeJson(l.profileSnapshot),
        studentKey: l.studentKey,
        sessionId: l.sessionId,
        messageCount: l.sessionId ? sessionMsgMap.get(l.sessionId) ?? 0 : 0,
        createdAt: l.createdAt,
      })),
    },
  };
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
