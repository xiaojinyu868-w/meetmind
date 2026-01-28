/**
 * 验证码登录 API
 * 
 * POST /api/auth/login-with-code
 * 
 * Body:
 * - target: string (邮箱或手机号)
 * - code: string (6位验证码)
 * - type: 'email' | 'sms'
 * - rememberMe?: boolean
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { emailService } from '@/lib/services/email-service';
import { smsService } from '@/lib/services/sms-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target, code, type, rememberMe = false } = body as {
      target: string;
      code: string;
      type: 'email' | 'sms';
      rememberMe?: boolean;
    };

    // 参数验证
    if (!target || !code || !type) {
      return NextResponse.json(
        { success: false, error: '参数不完整' },
        { status: 400 }
      );
    }

    if (!['email', 'sms'].includes(type)) {
      return NextResponse.json(
        { success: false, error: '无效的验证码类型' },
        { status: 400 }
      );
    }

    // 验证验证码
    let verifyResult;
    if (type === 'email') {
      verifyResult = await emailService.verifyCode(target, code, 'login');
    } else {
      verifyResult = await smsService.verifyCode(target, code, 'login');
    }

    if (!verifyResult.success) {
      return NextResponse.json(
        { 
          success: false, 
          error: verifyResult.error,
          attemptsLeft: verifyResult.attemptsLeft 
        },
        { status: 400 }
      );
    }

    // 验证码正确，执行登录
    const loginResult = await authService.loginWithCode(
      target, 
      type === 'email' ? 'email' : 'phone'
    );

    if (!loginResult.success) {
      return NextResponse.json(loginResult, { status: 401 });
    }

    // 设置 HTTP-only cookie
    const response = NextResponse.json(loginResult);

    if (loginResult.refreshToken) {
      response.cookies.set('refreshToken', loginResult.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7, // 30天或7天
        path: '/',
      });
    }

    return response;
  } catch (error) {
    console.error('[API] 验证码登录失败:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
