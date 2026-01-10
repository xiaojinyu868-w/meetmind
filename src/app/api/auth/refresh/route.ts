/**
 * 刷新令牌 API
 * POST /api/auth/refresh
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';

export async function POST(request: NextRequest) {
  try {
    // 从 cookie 或请求体获取刷新令牌
    let refreshToken = request.cookies.get('refreshToken')?.value;
    
    if (!refreshToken) {
      const body = await request.json().catch(() => ({}));
      refreshToken = body.refreshToken;
    }
    
    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: '缺少刷新令牌' },
        { status: 401 }
      );
    }
    
    const result = await authService.refreshAccessToken(refreshToken);
    
    if (!result.success) {
      const response = NextResponse.json(result, { status: 401 });
      response.cookies.delete('refreshToken');
      return response;
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('刷新令牌错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
