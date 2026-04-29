/**
 * org-member-service: 机构成员与邀请
 *
 * V0 只支持"生成邀请链接（token），让被邀请人用邮箱密码注册/登录后自动加入"。
 * 不发邮件（Phase 3 再集成），机构主把链接手动发给学员/老师。
 */

import prisma from '@/lib/prisma';
import crypto from 'crypto';
import { AcademicError } from '../errors';
import type { OrgRole } from '../context';

const VALID_INVITE_ROLES: OrgRole[] = ['teacher', 'student', 'consultant'];

export interface CreateInviteInput {
  role: OrgRole;
  email?: string;
}

export const orgMemberService = {
  async listMembers(orgId: string) {
    const rows = await prisma.orgMember.findMany({
      where: { orgId },
      include: { user: { select: { id: true, username: true, nickname: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role as OrgRole,
      joinedAt: m.joinedAt,
      user: m.user,
    }));
  },

  async removeMember(orgId: string, memberId: string, actingRole: OrgRole) {
    const member = await prisma.orgMember.findUnique({ where: { id: memberId } });
    if (!member || member.orgId !== orgId) {
      throw new AcademicError('NOT_FOUND', '成员不存在');
    }
    if (member.role === 'owner') {
      throw new AcademicError('INSUFFICIENT_ROLE', '不能移除机构主');
    }
    if (actingRole !== 'owner' && actingRole !== 'consultant') {
      throw new AcademicError('INSUFFICIENT_ROLE', '只有 owner/consultant 能移除成员');
    }
    await prisma.orgMember.delete({ where: { id: memberId } });
  },

  async createInvite(orgId: string, invitedBy: string, input: CreateInviteInput) {
    if (!VALID_INVITE_ROLES.includes(input.role)) {
      throw new AcademicError('INVALID_INPUT', `不支持的邀请角色：${input.role}`);
    }
    const token = crypto.randomBytes(18).toString('base64url');
    const invite = await prisma.orgInvite.create({
      data: {
        orgId,
        token,
        role: input.role,
        email: input.email?.trim() || null,
        invitedBy,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 天
      },
    });
    return invite;
  },

  async listInvites(orgId: string) {
    return prisma.orgInvite.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  },

  /**
   * 被邀请人接受邀请：把 user 加到 org，并消费 token。
   * 公开接口（用户登录后 POST /api/console/invite/accept），不需要 activeOrg 校验。
   */
  async acceptInvite(token: string, userId: string) {
    const invite = await prisma.orgInvite.findUnique({ where: { token } });
    if (!invite) throw new AcademicError('NOT_FOUND', '邀请链接无效');
    if (invite.usedAt) throw new AcademicError('ALREADY_EXISTS', '邀请链接已被使用');
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      throw new AcademicError('INVALID_INPUT', '邀请链接已过期');
    }

    // 如果邀请绑定了邮箱，校验当前用户邮箱匹配（V0 宽松：只要用户存在即可加入）
    const existing = await prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId: invite.orgId, userId } },
    });
    if (existing) {
      // 已是成员：直接把 activeOrg 切过去
      await prisma.user.update({ where: { id: userId }, data: { activeOrgId: invite.orgId } });
      await prisma.orgInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedBy: userId },
      });
      return { orgId: invite.orgId, role: existing.role };
    }

    await prisma.$transaction([
      prisma.orgMember.create({
        data: {
          orgId: invite.orgId,
          userId,
          role: invite.role,
          invitedBy: invite.invitedBy,
        },
      }),
      prisma.orgInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date(), usedBy: userId },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { activeOrgId: invite.orgId },
      }),
    ]);

    return { orgId: invite.orgId, role: invite.role as OrgRole };
  },
};

export type OrgMemberService = typeof orgMemberService;
