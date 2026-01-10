/**
 * 用户登出 API
 * POST /api/auth/logout
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';

export async function POST(request: NextRequest) {
  try {
    // 从 cookie 获取刷新令牌
    const refreshToken = request.cookies.get('refreshToken')?.value;
    
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    
    // 清除 cookie
    const response = NextResponse.json({ success: true });
    response.cookies.delete('refreshToken');
    
    return response;
  } catch (error) {
    console.error('登出错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
