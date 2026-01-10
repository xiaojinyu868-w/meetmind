/**
 * 用户注册 API
 * POST /api/auth/register
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import type { RegisterRequest } from '@/types/user';

export async function POST(request: NextRequest) {
  try {
    const body: RegisterRequest = await request.json();
    
    // 验证必填字段
    if (!body.username || !body.password) {
      return NextResponse.json(
        { success: false, error: '用户名和密码为必填项' },
        { status: 400 }
      );
    }
    
    const result = await authService.register(body);
    
    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }
    
    // 设置 HTTP-only cookie
    const response = NextResponse.json(result);
    
    if (result.refreshToken) {
      response.cookies.set('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // 7天
        path: '/',
      });
    }
    
    return response;
  } catch (error) {
    console.error('注册错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
