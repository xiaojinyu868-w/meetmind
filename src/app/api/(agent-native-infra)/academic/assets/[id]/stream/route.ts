/**
 * GET /api/academic/assets/:id/stream — 读取原始资产字节流（文件类）
 *
 * 权限：登录且是该机构成员，即可读取。
 * 不支持 Range（V0 足够；后续若需要视频进度条 seek 再加）。
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  AcademicError,
  academicRoute,
  orgAssetService,
  resolveConsoleContext,
} from '@/lib/academic';
import { STORAGE_ROOT } from '@/lib/academic/services/org-asset-service';

export const GET = academicRoute(async (req: NextRequest, ctx) => {
  const context = await resolveConsoleContext(req);
  const { id } = await ctx.params;
  const assetId = Array.isArray(id) ? id[0] : id;
  const asset = await orgAssetService.getById(context.orgId, assetId);
  if (!asset.storagePath) {
    throw new AcademicError('INVALID_INPUT', '该资产不是文件类型');
  }
  const abs = path.join(STORAGE_ROOT, asset.storagePath);
  const buf = await fs.readFile(abs);
  // 转成 Uint8Array 防止类型冲突
  const body = new Uint8Array(buf);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': asset.mimeType || 'application/octet-stream',
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'private, max-age=0',
    },
  });
});
