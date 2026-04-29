/**
 * POST /api/console/skills        上传 .skill 包
 * GET  /api/console/skills        列出机构 skills
 */

import { NextRequest } from 'next/server';
import { academicRoute, AcademicError, resolveConsoleContext } from '@/lib/academic';
import {
  uploadSkill,
  listOrgSkills,
  SkillImportError,
} from '@/lib/services/consult-skill-import-service';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const GET = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || undefined;
  const list = await listOrgSkills(ctx.orgId, { status });
  return {
    data: {
      skills: list.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status,
        rejectReason: s.rejectReason,
        skillDirPath: s.skillDirPath,
        reviewedAt: s.reviewedAt,
        createdAt: s.createdAt,
      })),
    },
  };
});

export const POST = academicRoute(async (req: NextRequest) => {
  const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new AcademicError('INVALID_INPUT', '请用 multipart/form-data 上传 .skill 文件');
  }
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AcademicError('INVALID_INPUT', '缺少 file 字段');
  }
  if (!/\.(skill|zip)$/i.test(file.name)) {
    throw new AcademicError('INVALID_INPUT', '文件扩展名必须是 .skill 或 .zip');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new AcademicError('INVALID_INPUT', 'skill 包不得超过 5MB');
  }

  try {
    const result = await uploadSkill({
      orgId: ctx.orgId,
      uploadedById: ctx.userId,
      bundleBuffer: await file.arrayBuffer(),
      bundleOriginalName: file.name,
    });
    return { data: { skill: result } };
  } catch (e) {
    if (e instanceof SkillImportError) {
      throw new AcademicError('INVALID_INPUT', e.message + (e.details ? `\n${e.details}` : ''));
    }
    throw e;
  }
});
