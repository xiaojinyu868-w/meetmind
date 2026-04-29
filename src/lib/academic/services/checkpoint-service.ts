/**
 * checkpoint-service: 老师端待处理 CheckpointPack
 *
 * Phase 1：只做读。真正的"自动触发 checkpoint"在 Phase 3 通过 practiceSession 反馈生成。
 * Phase 1 提供 UI 需要的读接口和一个手工创建接口（方便测试或老师主动挂 checkpoint）。
 */

import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';

export interface CreateCheckpointInput {
  practiceSessionId: string;
  assigneeUserId?: string;
  headline: string;
  summary: string;
  risks?: string[];
  materialSnapshot?: string;
}

export const checkpointService = {
  async listOpenForOrg(orgId: string, assigneeUserId?: string) {
    return prisma.checkpointPack.findMany({
      where: {
        orgId,
        status: 'open',
        ...(assigneeUserId ? { assigneeUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        practiceSession: {
          select: {
            id: true,
            userId: true,
            startedAt: true,
            scenario: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  async listForTeacher(orgId: string, teacherId: string) {
    // 老师可以看到：1) 指派给他的；2) 未指派的（所有老师可认领）
    return prisma.checkpointPack.findMany({
      where: {
        orgId,
        OR: [{ assigneeUserId: teacherId }, { assigneeUserId: null }],
        status: { in: ['open', 'in_progress'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        practiceSession: {
          select: {
            id: true,
            userId: true,
            startedAt: true,
            scenario: { select: { id: true, name: true } },
          },
        },
      },
    });
  },

  async getById(orgId: string, id: string) {
    const row = await prisma.checkpointPack.findUnique({
      where: { id },
      include: {
        practiceSession: true,
      },
    });
    if (!row || row.orgId !== orgId) throw new AcademicError('NOT_FOUND', 'checkpoint 不存在');
    return row;
  },

  async create(orgId: string, input: CreateCheckpointInput) {
    const ps = await prisma.practiceSession.findUnique({
      where: { id: input.practiceSessionId },
    });
    if (!ps || ps.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', '找不到对应的 PracticeSession');
    }
    return prisma.checkpointPack.create({
      data: {
        orgId,
        practiceSessionId: input.practiceSessionId,
        assigneeUserId: input.assigneeUserId,
        headline: input.headline,
        summary: input.summary,
        risksJson: input.risks ? JSON.stringify(input.risks) : null,
        materialSnapshot: input.materialSnapshot,
      },
    });
  },
};

export type CheckpointService = typeof checkpointService;
