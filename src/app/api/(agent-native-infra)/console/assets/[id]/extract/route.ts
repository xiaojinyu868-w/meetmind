/**
 * POST /api/console/assets/:id/extract — 文档拆分（同步执行；30-60s 可能）
 *
 * 成功后 asset.status = ready，并在 OrgPlaybookSection 里生成 N 个片段（带 sourceAssetId）。
 */

import { NextRequest } from 'next/server';
import { academicRoute, documentExtractService, resolveConsoleContext } from '@/lib/academic';

export const POST = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { id } = await ctx.params;
  const assetId = Array.isArray(id) ? id[0] : id;
  const result = await documentExtractService.processAsset(context.orgId, assetId);
  return { data: result };
});
