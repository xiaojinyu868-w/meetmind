/**
 * academic-profile-service: 学生在当前机构下的 AcademicProfile
 *
 * Phase 1 只做最小 upsert：学生开始第一个场景时若没有 profile 则自动建空。
 * Phase 4 才真正做服务前诊断的全字段填充。
 */

import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';

export interface UpsertProfileInput {
  displayName?: string;
  stage?: string;
  goals?: Record<string, unknown>;
  background?: Record<string, unknown>;
  materials?: Record<string, unknown>;
  notes?: string;
}

export const academicProfileService = {
  async getOrCreate(orgId: string, userId: string) {
    const existing = await prisma.academicProfile.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (existing) return existing;
    return prisma.academicProfile.create({
      data: { orgId, userId },
    });
  },

  async get(orgId: string, userId: string) {
    return prisma.academicProfile.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
  },

  async upsert(orgId: string, userId: string, input: UpsertProfileInput) {
    return prisma.academicProfile.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: {
        orgId,
        userId,
        displayName: input.displayName,
        stage: input.stage,
        goalsJson: input.goals ? JSON.stringify(input.goals) : null,
        backgroundJson: input.background ? JSON.stringify(input.background) : null,
        materialsJson: input.materials ? JSON.stringify(input.materials) : null,
        notes: input.notes,
      },
      update: {
        displayName: input.displayName,
        stage: input.stage,
        goalsJson: input.goals ? JSON.stringify(input.goals) : undefined,
        backgroundJson: input.background ? JSON.stringify(input.background) : undefined,
        materialsJson: input.materials ? JSON.stringify(input.materials) : undefined,
        notes: input.notes,
      },
    });
  },

  async requireExists(orgId: string, userId: string) {
    const p = await this.get(orgId, userId);
    if (!p) throw new AcademicError('NOT_FOUND', '未找到学生画像');
    return p;
  },
};

export type AcademicProfileService = typeof academicProfileService;
