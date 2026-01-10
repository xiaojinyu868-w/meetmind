/**
 * 用户登录 API
 * POST /api/auth/login
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import type { LoginRequest } from '@/types/user';

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json();
    
    // 验证必填字段
    if (!body.username || !body.password) {
      return NextResponse.json(
        { success: false, error: '用户名和密码为必填项' },
        { status: 400 }
      );
    }
    
    const result = await authService.login(body);
    
    if (!result.success) {
      return NextResponse.json(result, { status: 401 });
    }
    
    // 设置 HTTP-only cookie
    const response = NextResponse.json(result);
    
    if (result.refreshToken) {
      response.cookies.set('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: body.rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7, // 30天或7天
        path: '/',
      });
    }
    
    return response;
  } catch (error) {
    console.error('登录错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
