/**
 * GET  /api/console/assets                — 列出本机构资产（?kind=document|audio|video|image|url）
 * POST /api/console/assets                — 上传文件（multipart/form-data）或登记 URL
 *   multipart 字段：file, title, kind
 *   JSON body（url 模式）：{ kind:'url'|'video'|'audio'|'document', title, url }
 */

import { NextRequest } from 'next/server';
import { AcademicError, academicRoute, orgAssetService, resolveConsoleContext, type AssetKind } from '@/lib/academic';

const KIND_BY_MIME = (mime: string): AssetKind => {
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'document';
};

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });
  const kind = req.nextUrl.searchParams.get('kind') as AssetKind | null;
  const list = await orgAssetService.listByOrg(ctx.orgId, kind ?? undefined);
  return { data: { assets: list } };
});

export const POST = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant', 'teacher'] });

  const contentType = req.headers.get('content-type') || '';

  // URL 登记模式（application/json）
  if (contentType.includes('application/json')) {
    const body = await req.json();
    const asset = await orgAssetService.createUrl({
      orgId: ctx.orgId,
      uploadedBy: ctx.userId,
      kind: (body.kind as AssetKind) || 'url',
      title: String(body.title || ''),
      url: String(body.url || ''),
    });
    return { data: { asset } };
  }

  // multipart 上传
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const title = String(form.get('title') || '');
  const kindHint = (form.get('kind') as AssetKind | null) || null;
  if (!file) {
    throw new AcademicError('INVALID_INPUT', '缺少 file 字段');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const kind: AssetKind = kindHint ?? KIND_BY_MIME(file.type || '');
  const asset = await orgAssetService.createFile({
    orgId: ctx.orgId,
    uploadedBy: ctx.userId,
    kind,
    title: title || file.name,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    buffer,
  });
  return { data: { asset } };
});
