/**
 * consult-skill-import-service —— 机构上传的 scenario skill 审核 + 落地
 *
 * 职责：
 *   1. 接收机构上传的 .skill 包（zip）或 skill 目录 tarball
 *   2. 解压到临时目录 → 跑 `quick_validate.py` 确认合规
 *   3. 解析 SKILL.md 的 frontmatter，拿 name/description
 *   4. 写 OrgSkill 表（status=pending），等审核
 *   5. 审核通过后：把解压目录同步到 orgs/<orgId>/skills/<name>/
 *      consult-skill-registry 读这里，机构学生立即能看到
 *
 * 存储约定：
 *   - 上传包缓存：storage/consult-skill-bundles/<orgId>/<skillName>-<ts>.skill
 *   - 解压后:     orgs/<orgId>/skills/<name>/
 *
 * 复用：@prisma, document-parser-service? 不，用 node 内置 + 官方 python validator
 */

import { mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '@/lib/prisma';
import { parseFrontmatter, validateSkillDir } from './consult-skill-registry';

const execFileP = promisify(execFile);

const BUNDLE_ROOT = path.resolve(process.cwd(), 'storage/consult-skill-bundles');
const ORG_SKILLS_ROOT = path.resolve(process.cwd(), 'orgs');

export class SkillImportError extends Error {
  constructor(
    message: string,
    public readonly details?: string,
  ) {
    super(message);
  }
}

// ────────────── 接收 + 解压 ──────────────

async function unzipTo(bundlePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  // 用系统 unzip（macOS / 大多 linux 环境可用）；失败再 fallback
  try {
    await execFileP('unzip', ['-o', '-q', bundlePath, '-d', destDir], { timeout: 30_000 });
  } catch (e) {
    throw new SkillImportError(
      'skill 包解压失败',
      `unzip 失败：${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * 解压后的目录可能是：
 *   destDir/SKILL.md           （平整的 root）
 *   destDir/<name>/SKILL.md    （带 wrapper 的 root）
 * 找出真正含 SKILL.md 的那一层返回
 */
async function locateSkillDir(destDir: string): Promise<string> {
  if (existsSync(path.join(destDir, 'SKILL.md'))) return destDir;
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(destDir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (subdirs.length === 1) {
    const inner = path.join(destDir, subdirs[0]);
    if (existsSync(path.join(inner, 'SKILL.md'))) return inner;
  }
  throw new SkillImportError('压缩包里找不到 SKILL.md');
}

// ────────────── 上传入口 ──────────────

export interface UploadSkillInput {
  orgId: string;
  uploadedById: string;
  bundleBuffer: ArrayBuffer;
  bundleOriginalName: string; // e.g. cv-diagnose.skill
}

export interface UploadedSkill {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
}

export async function uploadSkill(input: UploadSkillInput): Promise<UploadedSkill> {
  // 1. 存 bundle
  await mkdir(path.join(BUNDLE_ROOT, input.orgId), { recursive: true });
  const ts = Date.now();
  const bundlePath = path.join(
    BUNDLE_ROOT,
    input.orgId,
    `${input.bundleOriginalName.replace(/\.[^.]+$/, '')}-${ts}.skill`,
  );
  await writeFile(bundlePath, Buffer.from(input.bundleBuffer));

  // 2. 解压到临时目录
  const tmpDir = path.join(BUNDLE_ROOT, input.orgId, `_unpack-${ts}`);
  try {
    await unzipTo(bundlePath, tmpDir);
    const skillRoot = await locateSkillDir(tmpDir);

    // 3. 跑 OpenClaw 官方 validator
    const validation = await validateSkillDir(skillRoot);
    if (!validation.ok) {
      throw new SkillImportError(
        'skill 不符合 AgentSkills 规范',
        validation.message.slice(0, 1500),
      );
    }

    // 4. 解析 frontmatter
    const skillMd = await readFile(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const { fm } = parseFrontmatter(skillMd);
    if (!fm.name || !fm.description) {
      throw new SkillImportError('frontmatter 缺少 name 或 description');
    }

    // 5. 写 DB（upsert：同 orgId + name 就覆盖，重新等审核）
    const record = await prisma.orgSkill.upsert({
      where: { orgId_name: { orgId: input.orgId, name: fm.name } },
      update: {
        description: fm.description,
        status: 'pending',
        rejectReason: null,
        bundlePath,
        skillDirPath: null,
        uploadedById: input.uploadedById,
        reviewedById: null,
        reviewedAt: null,
      },
      create: {
        orgId: input.orgId,
        name: fm.name,
        description: fm.description,
        status: 'pending',
        bundlePath,
        uploadedById: input.uploadedById,
      },
    });

    return {
      id: record.id,
      name: record.name,
      description: record.description,
      status: record.status as 'pending',
    };
  } finally {
    // 清理临时解压目录
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ────────────── 审核 ──────────────

export async function listOrgSkills(orgId: string, opts: { status?: string } = {}) {
  return prisma.orgSkill.findMany({
    where: { orgId, ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function approveOrgSkill(orgId: string, skillId: string, reviewerUserId: string) {
  const rec = await prisma.orgSkill.findUnique({ where: { id: skillId } });
  if (!rec || rec.orgId !== orgId) throw new SkillImportError('skill 不存在或不属于当前机构');
  if (!rec.bundlePath) throw new SkillImportError('skill 没有 bundle 路径，无法部署');

  // 解压到 orgs/<orgId>/skills/<name>/
  const destDir = path.join(ORG_SKILLS_ROOT, orgId, 'skills', rec.name);
  // 先清空再部署，避免旧文件残留
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });

  // 解压到一个临时目录，再定位真正 skill 目录，再整体复制到 destDir
  const tmpDir = path.join(BUNDLE_ROOT, orgId, `_deploy-${Date.now()}`);
  try {
    await unzipTo(rec.bundlePath, tmpDir);
    const skillRoot = await locateSkillDir(tmpDir);
    await cp(skillRoot, destDir, { recursive: true });

    // 二次 validate（部署后的位置）
    const validation = await validateSkillDir(destDir);
    if (!validation.ok) {
      await rm(destDir, { recursive: true, force: true });
      throw new SkillImportError(
        '部署后验证失败',
        validation.message.slice(0, 1500),
      );
    }

    await prisma.orgSkill.update({
      where: { id: skillId },
      data: {
        status: 'approved',
        skillDirPath: path.relative(process.cwd(), destDir),
        reviewedById: reviewerUserId,
        reviewedAt: new Date(),
      },
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function rejectOrgSkill(
  orgId: string,
  skillId: string,
  reviewerUserId: string,
  reason: string,
) {
  const rec = await prisma.orgSkill.findUnique({ where: { id: skillId } });
  if (!rec || rec.orgId !== orgId) throw new SkillImportError('skill 不存在或不属于当前机构');
  await prisma.orgSkill.update({
    where: { id: skillId },
    data: {
      status: 'rejected',
      rejectReason: reason,
      reviewedById: reviewerUserId,
      reviewedAt: new Date(),
    },
  });
}

export async function deleteOrgSkill(orgId: string, skillId: string) {
  const rec = await prisma.orgSkill.findUnique({ where: { id: skillId } });
  if (!rec || rec.orgId !== orgId) throw new SkillImportError('skill 不存在或不属于当前机构');
  if (rec.skillDirPath) {
    await rm(path.resolve(process.cwd(), rec.skillDirPath), { recursive: true, force: true }).catch(() => {});
  }
  if (rec.bundlePath) {
    await rm(rec.bundlePath, { force: true }).catch(() => {});
  }
  await prisma.orgSkill.delete({ where: { id: skillId } });
}
