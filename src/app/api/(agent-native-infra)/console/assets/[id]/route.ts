/**
 * GET    /api/console/assets/:id — 详情
 * DELETE /api/console/assets/:id — 删除（文件也会同时删）
 */

import { NextRequest } from 'next/server';
import { academicRoute, orgAssetService, resolveConsoleContext } from '@/lib/academic';

export const GET = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const { id } = await ctx.params;
  const assetId = Array.isArray(id) ? id[0] : id;
  const asset = await orgAssetService.getById(context.orgId, assetId);
  return { data: { asset } };
});

export const DELETE = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { id } = await ctx.params;
  const assetId = Array.isArray(id) ? id[0] : id;
  await orgAssetService.delete(context.orgId, assetId);
  return { data: { ok: true } };
});
