/**
 * 获取当前用户信息 API
 * GET /api/auth/me
 * PATCH /api/auth/me - 更新用户资料
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
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
 * 获取当前用户信息
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
    
    const user = await authService.getUserById(payload.sub);
    
    if (!user) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      user,
      permissions: payload.permissions,
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
