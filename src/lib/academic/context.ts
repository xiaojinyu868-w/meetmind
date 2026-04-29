/**
 * Academic Service OS: Request Context
 *
 * 所有 /api/console/* 与 /api/academic/* 路由都应该先走这里解出：
 *   - userId   当前登录用户
 *   - orgId    当前激活机构（activeOrgId）
 *   - role     该用户在该机构里的角色（owner / consultant / teacher / student）
 *
 * 使用：
 *
 *   export async function GET(req: NextRequest) {
 *     try {
 *       const ctx = await resolveConsoleContext(req, { requireRole: ['owner', 'consultant'] });
 *       const list = await orgScenarioService.listByOrg(ctx.orgId);
 *       return NextResponse.json({ ok: true, scenarios: list });
 *     } catch (err) {
 *       const { status, body } = toHttpError(err);
 *       return NextResponse.json({ ok: false, error: body }, { status });
 *     }
 *   }
 *
 * 详见 specs/academic-service-v0/multi-tenant-contract.md
 */

import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';
import { AcademicError } from './errors';

export type OrgRole = 'owner' | 'consultant' | 'teacher' | 'student';

export interface AcademicContext {
  userId: string;
  username: string;
  orgId: string;
  role: OrgRole;
}

/**
 * 不强制机构 context：只解出 userId（新用户首次调 /api/console/orgs 时用）
 */
export interface AuthOnlyContext {
  userId: string;
  username: string;
}

function extractBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('Authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice(7);
  }
  // 兜底：从 cookie 读（MeetMind 老代码也有这个习惯）
  const cookieToken = req.cookies.get('accessToken')?.value;
  return cookieToken || null;
}

export async function resolveUserOnly(req: NextRequest): Promise<AuthOnlyContext> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AcademicError('UNAUTHORIZED', '未登录');
  }
  const payload = authService.verifyToken(token);
  if (!payload) {
    throw new AcademicError('UNAUTHORIZED', '登录已过期');
  }
  return { userId: payload.sub, username: payload.username };
}

interface ResolveOptions {
  /** 指定要求的角色；命中其一即可。不传 = 不校验角色 */
  requireRole?: OrgRole[];
  /** 要求机构已完成 onboarding（默认 false，因为 onboarding 本身也要用 context） */
  requireActive?: boolean;
  /** 覆盖 activeOrgId：某些接口（跨机构邀请接受）允许从 body/query 指定 orgId */
  overrideOrgId?: string;
}

export async function resolveConsoleContext(
  req: NextRequest,
  options: ResolveOptions = {},
): Promise<AcademicContext> {
  const { userId, username } = await resolveUserOnly(req);

  const targetOrgId = await resolveTargetOrgId(userId, options.overrideOrgId);

  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId: targetOrgId, userId } },
    include: { org: true },
  });
  if (!membership) {
    throw new AcademicError('NOT_A_MEMBER', '你不是该机构的成员');
  }

  const role = membership.role as OrgRole;
  if (options.requireRole && options.requireRole.length > 0 && !options.requireRole.includes(role)) {
    throw new AcademicError('INSUFFICIENT_ROLE', `需要 ${options.requireRole.join('/')} 角色，当前是 ${role}`);
  }

  if (options.requireActive && membership.org.status !== 'active') {
    throw new AcademicError('ONBOARDING_REQUIRED', '机构尚未完成接入引导');
  }

  return { userId, username, orgId: targetOrgId, role };
}

/**
 * 解析当前用户应该用哪个 orgId：
 * 1. 显式 override 优先
 * 2. 否则读 user.activeOrgId
 * 3. 否则选第一个 membership（seed 机构主的常态）
 * 4. 如果没任何 membership，抛 NO_ACTIVE_ORG
 */
async function resolveTargetOrgId(userId: string, override?: string): Promise<string> {
  if (override) return override;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeOrgId: true },
  });

  if (user?.activeOrgId) {
    return user.activeOrgId;
  }

  const firstMembership = await prisma.orgMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: { orgId: true },
  });
  if (!firstMembership) {
    throw new AcademicError('NO_ACTIVE_ORG', '当前账号还未加入任何机构');
  }

  // 懒同步：把首个 membership 设为 activeOrgId，减少下次查询
  await prisma.user.update({
    where: { id: userId },
    data: { activeOrgId: firstMembership.orgId },
  });

  return firstMembership.orgId;
}

/**
 * 切换当前激活机构。由 /api/console/orgs/:id/switch 调用。
 */
export async function setActiveOrg(userId: string, orgId: string): Promise<void> {
  const membership = await prisma.orgMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { id: true },
  });
  if (!membership) {
    throw new AcademicError('NOT_A_MEMBER', '你不是该机构的成员');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { activeOrgId: orgId },
  });
}
