/**
 * org-service: Organization 生命周期
 *
 * - 创建机构（绑定 owner）
 * - 列出当前用户所属机构
 * - 完成/推进 onboarding 步骤
 *
 * 所有写操作内部都基于 userId 做权限校验。查询操作要求调用方显式传入 orgId。
 */

import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';
import type { OrgRole } from '../context';

const KNOWN_INDUSTRIES = new Set(['shenbo', 'baoyan', 'liuxue', 'lunwen', 'jingsai', 'blank']);

export interface CreateOrgInput {
  name: string;
  contactEmail: string;
  industry: string;
}

async function ensureTemplateExists(industry: string): Promise<void> {
  if (!KNOWN_INDUSTRIES.has(industry)) {
    throw new AcademicError('INVALID_INPUT', `未知行业模板：${industry}`);
  }
  const template = await prisma.orgIndustryTemplate.findUnique({ where: { id: industry } });
  if (!template) {
    throw new AcademicError('INVALID_INPUT', `行业模板 ${industry} 未初始化（请先跑 seed-industry-templates）`);
  }
}

export const orgService = {
  async createOrg(ownerId: string, input: CreateOrgInput) {
    if (!input.name?.trim()) {
      throw new AcademicError('INVALID_INPUT', '机构名称不能为空');
    }
    if (!input.contactEmail?.trim()) {
      throw new AcademicError('INVALID_INPUT', '联系邮箱不能为空');
    }
    await ensureTemplateExists(input.industry);

    const template = await prisma.orgIndustryTemplate.findUniqueOrThrow({
      where: { id: input.industry },
    });

    // 创建机构 + owner 成员 + seed playbook section（overview 类目）
    const org = await prisma.organization.create({
      data: {
        name: input.name.trim(),
        contactEmail: input.contactEmail.trim(),
        industry: input.industry,
        status: 'onboarding',
        onboardingStep: 1,
        members: {
          create: {
            userId: ownerId,
            role: 'owner' as OrgRole,
          },
        },
        playbookSections: {
          create: {
            title: `${template.displayName} · 默认骨架`,
            sectionKind: 'overview',
            body: template.seedPlaybook,
            tags: JSON.stringify(['seed', input.industry]),
          },
        },
      },
      include: { members: true },
    });

    // 把该用户的 activeOrgId 切到这个新机构
    await prisma.user.update({
      where: { id: ownerId },
      data: { activeOrgId: org.id },
    });

    return org;
  },

  async listMyOrgs(userId: string) {
    const memberships = await prisma.orgMember.findMany({
      where: { userId },
      include: { org: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => ({
      orgId: m.orgId,
      role: m.role as OrgRole,
      joinedAt: m.joinedAt,
      org: m.org,
    }));
  },

  async advanceOnboarding(orgId: string, step: number) {
    if (step < 1 || step > 5) {
      throw new AcademicError('INVALID_INPUT', 'onboardingStep 必须在 1..5');
    }
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new AcademicError('NOT_FOUND', '机构不存在');

    const data: { onboardingStep: number; status?: string } = {
      onboardingStep: Math.max(org.onboardingStep, step),
    };
    if (step >= 5) {
      data.status = 'active';
    }
    return prisma.organization.update({
      where: { id: orgId },
      data,
    });
  },

  async getOrg(orgId: string) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new AcademicError('NOT_FOUND', '机构不存在');
    return org;
  },

  async listIndustryTemplates() {
    const all = await prisma.orgIndustryTemplate.findMany({ orderBy: { id: 'asc' } });
    return all.map((t) => ({
      id: t.id,
      displayName: t.displayName,
      description: t.description,
      recommendedScenarios: JSON.parse(t.recommendedScenarios),
    }));
  },

  async getIndustryTemplate(id: string) {
    const t = await prisma.orgIndustryTemplate.findUnique({ where: { id } });
    if (!t) throw new AcademicError('NOT_FOUND', `模板 ${id} 不存在`);
    return {
      id: t.id,
      displayName: t.displayName,
      description: t.description,
      recommendedScenarios: JSON.parse(t.recommendedScenarios),
      seedPlaybook: t.seedPlaybook,
    };
  },
};

export type OrgService = typeof orgService;
