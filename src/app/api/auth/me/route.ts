/**
 * 获取当前用户信息 API
 * GET /api/auth/me
 * PATCH /api/auth/me - 更新用户资料
 * 
 * 支持跨服务器自动注册：当用户在新服务器（如香港服务器）不存在时，
 * 自动根据 Token 信息创建用户，实现无缝切换
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import prisma from '@/lib/prisma';
import type { UpdateProfileRequest } from '@/types/user';

/**
 * 从请求头获取并验证令牌
 */
function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.slice(7);
  return authService.verifyToken(token);
}

/**
 * 自动注册跨服务器用户
 * 当用户从其他服务器（如深圳）切换到新服务器（如香港）时，
 * 根据 Token 信息自动创建用户账号
 */
async function autoRegisterUser(payload: {
  sub: string;
  username?: string;
  nickname?: string;
  email?: string;
  phone?: string;
  role?: string;
}): Promise<any> {
  try {
    // 从 payload 提取用户信息
    const userId = payload.sub;
    const username = payload.username || `user_${userId.slice(0, 8)}`;
    const nickname = payload.nickname || username;
    const email = payload.email || undefined;
    const phone = payload.phone || undefined;
    const role = (payload.role as any) || 'student';
    
    console.log('[AutoRegister] 自动创建用户:', { userId, username, nickname });
    
    // 创建用户（无密码，通过 Token 登录）
    const newUser = await prisma.user.create({
      data: {
        id: userId,        // 保持相同 ID，确保跨服务器一致性
        username,
        nickname,
        email,
        phone,
        role,
        status: 'active',
        // 不设置密码，用户只能通过 Token 登录
        passwordHash: null,
        salt: null,
      },
    });
    
    console.log('[AutoRegister] 用户创建成功:', newUser.id);
    
    // 转换为 API 返回格式
    return {
      id: newUser.id,
      username: newUser.username,
      email: newUser.email || undefined,
      phone: newUser.phone || undefined,
      nickname: newUser.nickname,
      avatar: newUser.avatar || undefined,
      role: newUser.role,
      status: newUser.status,
      createdAt: newUser.createdAt.toISOString(),
      updatedAt: newUser.updatedAt.toISOString(),
      lastLoginAt: newUser.lastLoginAt?.toISOString(),
    };
  } catch (error) {
    console.error('[AutoRegister] 自动注册失败:', error);
    return null;
  }
}

/**
 * 获取当前用户信息
 * 支持跨服务器自动注册
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    
    if (!payload) {
      return NextResponse.json(
        { success: false, error: '未授权' },
        { status: 401 }
      );
    }
    
    let user = await authService.getUserById(payload.sub);
    
    // 用户不存在？尝试自动注册（跨服务器场景）
    if (!user) {
      console.log('[Auth/Me] 用户不存在，尝试自动注册:', payload.sub);
      user = await autoRegisterUser(payload);
      
      if (!user) {
        return NextResponse.json(
          { success: false, error: '用户不存在且自动注册失败' },
          { status: 404 }
        );
      }
    }
    
    // 判断是否为自动注册的用户（1分钟内创建的）
    const autoRegistered = typeof user.createdAt === 'string' 
      ? new Date(user.createdAt).getTime() > Date.now() - 60000
      : false;
    
    return NextResponse.json({
      success: true,
      user,
      permissions: payload.permissions,
      autoRegistered,
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

/**
 * 更新用户资料
 */
export async function PATCH(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    
    if (!payload) {
      return NextResponse.json(
        { success: false, error: '未授权' },
        { status: 401 }
      );
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
    console.error('更新用户资料错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
