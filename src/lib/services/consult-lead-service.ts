/**
 * consult-lead-service —— CTA 留资线索
 *
 * 职责：
 *   - 创建线索（ConsultLead）并关联到 (orgId, studentKey, consultStudentId)
 *   - 写入画像快照（审计用）
 *   - 列表查询（机构 /console/leads 用）
 */

import { prisma } from '@/lib/prisma';
import { snapshotProfile } from './consult-profile-service';
import { findSessionIdByStudent } from './consult-session-service';

export interface CreateLeadInput {
  orgId: string;
  studentKey: string;
  scenarioName: string;
  reason: string;
  headline?: string;
  consultantHint?: string;
  wechat?: string;
  phone?: string;
}

export async function createLead(input: CreateLeadInput) {
  const snap = await snapshotProfile(input.orgId, input.studentKey);
  // M.8 后 session 不按 scenarioName 分；一个学生 → 一个 session
  const sessionId = await findSessionIdByStudent(input.orgId, input.studentKey);
  const lead = await prisma.consultLead.create({
    data: {
      orgId: input.orgId,
      studentKey: input.studentKey,
      consultStudentId: snap.studentId,
      scenarioName: input.scenarioName,
      reason: input.reason,
      headline: input.headline ?? null,
      consultantHint: input.consultantHint ?? null,
      wechat: input.wechat ?? null,
      phone: input.phone ?? null,
      profileSnapshot: JSON.stringify(snap.profile),
      status: 'new',
      sessionId: sessionId || null,
    },
  });
  return lead;
}

export async function listLeads(orgId: string, opts: { status?: string; limit?: number } = {}) {
  const where: { orgId: string; status?: string } = { orgId };
  if (opts.status) where.status = opts.status;
  return prisma.consultLead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts.limit ?? 100,
  });
}

export async function updateLeadStatus(
  orgId: string,
  leadId: string,
  status: 'new' | 'contacted' | 'converted' | 'dropped',
  notes?: string,
) {
  return prisma.consultLead.update({
    where: { id: leadId, orgId } as { id: string; orgId: string },
    data: { status, notes: notes ?? null },
  });
}
