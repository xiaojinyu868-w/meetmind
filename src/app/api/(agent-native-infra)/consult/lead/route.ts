/**
 * POST /api/consult/lead
 *
 * CTA 卡上"留微信继续聊"按钮的落地接口。
 *
 * M.8 之后 scenarioName 变成**可选**：如果前端没传，后端从 session.activeScenarioName fallback；
 * 再没有就写 'general' 作为占位，机构仍然能拿到线索。
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createLead } from '@/lib/services/consult-lead-service';
import { getActiveScenario } from '@/lib/services/consult-session-service';

export const runtime = 'nodejs';

interface LeadBody {
  orgSlug: string;
  studentKey: string;
  scenarioName?: string; // 可选
  reason: string;
  headline?: string;
  consultantHint?: string;
  wechat?: string;
  phone?: string;
}

async function resolveOrgId(orgSlug: string): Promise<string | null> {
  const byId = await prisma.organization.findUnique({ where: { id: orgSlug } }).catch(() => null);
  if (byId) return byId.id;
  const byName = await prisma.organization.findFirst({ where: { name: { contains: orgSlug } } });
  if (byName) return byName.id;
  const fallback = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  return fallback?.id ?? null;
}

export async function POST(req: NextRequest) {
  let body: LeadBody;
  try {
    body = (await req.json()) as LeadBody;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }

  if (!body.orgSlug || !body.studentKey || !body.reason) {
    return NextResponse.json(
      { success: false, error: '缺少必填字段（orgSlug / studentKey / reason）' },
      { status: 400 },
    );
  }
  if (!body.wechat && !body.phone) {
    return NextResponse.json(
      { success: false, error: '请至少填写一个联系方式（微信号或手机号）' },
      { status: 400 },
    );
  }

  const orgId = await resolveOrgId(body.orgSlug);
  if (!orgId) {
    return NextResponse.json({ success: false, error: '机构不存在' }, { status: 404 });
  }

  // scenarioName 优先级：前端显式传 → session.activeScenarioName → 'general'
  let scenarioName = body.scenarioName;
  if (!scenarioName) {
    scenarioName = (await getActiveScenario(orgId, body.studentKey)) ?? 'general';
  }

  try {
    const lead = await createLead({
      orgId,
      studentKey: body.studentKey,
      scenarioName,
      reason: body.reason,
      headline: body.headline,
      consultantHint: body.consultantHint,
      wechat: body.wechat?.trim(),
      phone: body.phone?.trim(),
    });
    return NextResponse.json({
      success: true,
      data: { leadId: lead.id, createdAt: lead.createdAt },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
