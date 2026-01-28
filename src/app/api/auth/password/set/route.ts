/**
 * 设置密码 API（用于未设置密码的用户）
 * POST /api/auth/password/set
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';

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
    
    const body = await request.json();
    
    if (!body.password) {
      return NextResponse.json(
        { success: false, error: '请提供密码' },
        { status: 400 }
      );
    }
    
    const result = await authService.setPassword(payload.sub, body.password);
    
    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('设置密码错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

/**
 * 检查用户是否已设置密码
 * GET /api/auth/password/set
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
    
    const hasPassword = await authService.hasPassword(payload.sub);
    
    return NextResponse.json({ success: true, hasPassword });
  } catch (error) {
    console.error('检查密码状态错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
