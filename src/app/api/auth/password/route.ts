/**
 * 修改密码 API
 * POST /api/auth/password
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import type { ChangePasswordRequest } from '@/types/user';

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

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    
    if (!payload) {
      return NextResponse.json(
        { success: false, error: '未授权' },
        { status: 401 }
      );
    }
    
    const body: ChangePasswordRequest = await request.json();
    
    if (!body.oldPassword || !body.newPassword) {
      return NextResponse.json(
        { success: false, error: '请提供原密码和新密码' },
        { status: 400 }
      );
    }
    
    const result = await authService.changePassword(
      payload.sub,
      body.oldPassword,
      body.newPassword
    );
    
    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('修改密码错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
