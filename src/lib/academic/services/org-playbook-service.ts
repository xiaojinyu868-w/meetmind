/**
 * org-playbook-service: 机构 Playbook 片段管理
 *
 * 所有查询都基于 orgId 做行级隔离。
 */

import prisma from '@/lib/prisma';
import { AcademicError } from '../errors';

export type PlaybookSectionKind = 'overview' | 'sop' | 'rubric' | 'script' | 'sample' | 'case';

export interface CreatePlaybookSectionInput {
  title: string;
  sectionKind: PlaybookSectionKind;
  body: string;
  tags?: string[];
}

export interface UpdatePlaybookSectionInput {
  title?: string;
  sectionKind?: PlaybookSectionKind;
  body?: string;
  tags?: string[];
}

export const orgPlaybookService = {
  async listByOrg(orgId: string) {
    const rows = await prisma.orgPlaybookSection.findMany({
      where: { orgId },
      orderBy: [{ sectionKind: 'asc' }, { updatedAt: 'desc' }],
    });
    return rows.map(deserialize);
  },

  async create(orgId: string, input: CreatePlaybookSectionInput) {
    if (!input.title?.trim()) throw new AcademicError('INVALID_INPUT', '标题不能为空');
    if (!input.body?.trim()) throw new AcademicError('INVALID_INPUT', '内容不能为空');

    const row = await prisma.orgPlaybookSection.create({
      data: {
        orgId,
        title: input.title.trim(),
        sectionKind: input.sectionKind,
        body: input.body,
        tags: JSON.stringify(input.tags ?? []),
      },
    });
    return deserialize(row);
  },

  async update(orgId: string, id: string, patch: UpdatePlaybookSectionInput) {
    const existing = await prisma.orgPlaybookSection.findUnique({ where: { id } });
    if (!existing || existing.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', 'playbook 片段不存在');
    }
    const row = await prisma.orgPlaybookSection.update({
      where: { id },
      data: {
        title: patch.title?.trim() ?? existing.title,
        sectionKind: patch.sectionKind ?? existing.sectionKind,
        body: patch.body ?? existing.body,
        tags: patch.tags !== undefined ? JSON.stringify(patch.tags) : existing.tags,
      },
    });
    return deserialize(row);
  },

  async delete(orgId: string, id: string) {
    const existing = await prisma.orgPlaybookSection.findUnique({ where: { id } });
    if (!existing || existing.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', 'playbook 片段不存在');
    }
    await prisma.orgPlaybookSection.delete({ where: { id } });
  },
};

function deserialize(row: {
  id: string;
  orgId: string;
  title: string;
  sectionKind: string;
  body: string;
  tags: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    sectionKind: row.sectionKind as PlaybookSectionKind,
    body: row.body,
    tags: safeJsonArray(row.tags),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export type OrgPlaybookService = typeof orgPlaybookService;
