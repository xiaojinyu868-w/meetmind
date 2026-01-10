/**
 * 微信登录回调 API
 * GET /api/auth/wechat/callback
 * 
 * 微信授权后会重定向到此地址，携带 code 和 state 参数
 * 使用临时会话 token 安全传递认证信息
 */

import { NextRequest, NextResponse } from 'next/server';
import { wechatAuthService } from '@/lib/services/wechat-auth-service';
import { randomBytes } from 'crypto';

// 临时会话存储（生产环境应使用 Redis）
const tempSessions = new Map<string, { accessToken: string; expiresAt: number }>();
const SESSION_EXPIRES = 60 * 1000; // 1分钟过期

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    
    // 检查参数
    if (!code || !state) {
      return NextResponse.redirect(new URL('/login?error=missing_params', request.url));
    }
    
    // 处理微信登录
    const result = await wechatAuthService.login(code, state);
    
    if (!result.success) {
      const errorMsg = encodeURIComponent(result.error || '登录失败');
      return NextResponse.redirect(new URL(`/login?error=${errorMsg}`, request.url));
    }
    
    // 登录成功，创建临时会话 token
    const sessionToken = randomBytes(32).toString('hex');
    
    if (result.accessToken) {
      tempSessions.set(sessionToken, {
        accessToken: result.accessToken,
        expiresAt: Date.now() + SESSION_EXPIRES,
      });
    }
    
    // 重定向到首页，携带临时会话 token
    const redirectUrl = new URL('/', request.url);
    redirectUrl.searchParams.set('session', sessionToken);
    
    const response = NextResponse.redirect(redirectUrl);
    
    // 设置 refreshToken 到 HTTP-only cookie
    if (result.refreshToken) {
      response.cookies.set('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
    }
    
    return response;
  } catch (error) {
    console.error('微信回调错误:', error);
    return NextResponse.redirect(new URL('/login?error=server_error', request.url));
  }
}

/**
 * 交换临时会话 token 获取 accessToken
 * POST /api/auth/wechat/callback
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionToken } = await request.json();
    
    if (!sessionToken) {
      return NextResponse.json(
        { success: false, error: '缺少会话令牌' },
        { status: 400 }
      );
    }
    
    const session = tempSessions.get(sessionToken);
    
    if (!session) {
      return NextResponse.json(
        { success: false, error: '会话不存在或已过期' },
        { status: 401 }
      );
    }
    
    // 检查过期
    if (Date.now() > session.expiresAt) {
      tempSessions.delete(sessionToken);
      return NextResponse.json(
        { success: false, error: '会话已过期' },
        { status: 401 }
      );
    }
    
    // 一次性使用，立即删除
    tempSessions.delete(sessionToken);
    
    return NextResponse.json({
      success: true,
      accessToken: session.accessToken,
    });
  } catch (error) {
    console.error('会话交换错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
