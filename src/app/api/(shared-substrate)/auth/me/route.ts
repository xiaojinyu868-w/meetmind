/**
 * 获取当前用户信息
 * GET /api/auth/me
 * PATCH /api/auth/me
 *
 * 兼容跨服务环境：
 * 如果用户拿着同一份 Token 访问新的部署环境，
 * 但当前数据库里还没有这个用户，会自动补注册。
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import prisma from '@/lib/prisma';
import workspaceAccountService from '@/lib/services/workspace-account-service';
import type { UpdateProfileRequest, User, UserRole, UserStatus } from '@/types/user';
import { createLogger } from '@/lib/logger';
const log = createLogger('auth/me');


function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

async function autoRegisterUser(payload: {
  sub: string;
  username?: string;
  nickname?: string;
  email?: string;
  phone?: string;
  role?: string;
}): Promise<User | null> {
  try {
    const userId = payload.sub;
    const username = payload.username || `user_${userId.slice(0, 8)}`;
    const nickname = payload.nickname || username;
    const email = payload.email || undefined;
    const phone = payload.phone || undefined;
    const role: UserRole =
      payload.role === 'student' ||
      payload.role === 'admin'
        ? payload.role
        : 'student';

    const newUser = await prisma.user.create({
      data: {
        id: userId,
        username,
        nickname,
        email,
        phone,
        role,
        status: 'active',
        passwordHash: null,
        salt: null,
      },
    });

    return {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email || undefined,
      phone: newUser.phone || undefined,
      nickname: newUser.nickname,
      avatar: newUser.avatar || undefined,
      role: newUser.role as UserRole,
      status: newUser.status as UserStatus,
      createdAt: newUser.createdAt.toISOString(),
      updatedAt: newUser.updatedAt.toISOString(),
      lastLoginAt: newUser.lastLoginAt?.toISOString(),
    };
  } catch (error) {
    log.error('[AutoRegister] 自动补注册失败:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);

    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    let user = await authService.getUserById(payload.sub);

    if (!user) {
      user = await autoRegisterUser(payload);

      if (!user) {
        return NextResponse.json(
          { success: false, error: '用户不存在，且自动补注册失败' },
          { status: 404 }
        );
      }
    }

    const autoRegistered =
      typeof user.createdAt === 'string'
        ? new Date(user.createdAt).getTime() > Date.now() - 60000
        : false;

    const ownership = await workspaceAccountService.ensureAccountDataOwnership(user.id);

    return NextResponse.json({
      success: true,
      user,
      workspace: ownership.workspace,
      permissions: payload.permissions,
      autoRegistered,
    });
  } catch (error) {
    log.error('获取用户信息错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);

    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const body: UpdateProfileRequest = await request.json();

    const user = await authService.updateProfile(payload.sub, body);

    if (!user) {
      return NextResponse.json(
        { success: false, error: '更新失败' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    log.error('更新用户资料错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
