/**
 * GET /api/console/knowledge
 *
 * 统一返回机构"知识库"里的所有东西，供新 /console/knowledge 页面一次性拉取：
 *   - assets：文件/链接资产（文档/视频/音频/图片/URL）
 *   - sources：老师辅导视频（CoachingSource）
 *   - playbook：Playbook 片段
 *
 * 合并后前端可在同一页内用 kind 切 tab，不必三次往返。
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { academicRoute, orgAssetService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });

  const [assets, sources, playbook] = await Promise.all([
    orgAssetService.listByOrg(ctx.orgId),
    prisma.coachingSource.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { id: true, nickname: true, username: true } } },
    }),
    prisma.orgPlaybookSection.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return {
    data: {
      assets,
      sources,
      playbook: playbook.map((p) => ({
        ...p,
        tags: safeJson<string[]>(p.tags, []),
      })),
    },
  };
});

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
