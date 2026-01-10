/**
 * 微信登录 API
 * GET /api/auth/wechat - 获取微信授权 URL
 * POST /api/auth/wechat - 处理微信登录
 */

import { NextRequest, NextResponse } from 'next/server';
import { wechatAuthService } from '@/lib/services/wechat-auth-service';
import { authService } from '@/lib/services/auth-service';

/**
 * 获取微信授权 URL
 */
export async function GET(request: NextRequest) {
  try {
    // 检查微信配置
    if (!wechatAuthService.isConfigured()) {
      return NextResponse.json(
        { success: false, error: '微信登录未配置' },
        { status: 503 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const redirectUri = searchParams.get('redirect_uri') || undefined;
    const type = searchParams.get('type') || 'qrconnect'; // qrconnect 或 oauth
    
    let authUrl: string;
    
    if (type === 'oauth') {
      // 微信内置浏览器授权
      authUrl = wechatAuthService.getAuthUrl(redirectUri);
    } else {
      // PC 扫码登录
      authUrl = wechatAuthService.getQRConnectUrl(redirectUri);
    }
    
    return NextResponse.json({
      success: true,
      authUrl,
    });
  } catch (error) {
    console.error('获取微信授权URL错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

/**
 * 处理微信登录（直接传入 code 和 state）
 */
export async function POST(request: NextRequest) {
  try {
    // 检查微信配置
    if (!wechatAuthService.isConfigured()) {
      return NextResponse.json(
        { success: false, error: '微信登录未配置' },
        { status: 503 }
      );
    }
    
    const body = await request.json();
    const { code, state } = body;
    
    if (!code || !state) {
      return NextResponse.json(
        { success: false, error: '缺少授权参数' },
        { status: 400 }
      );
    }
    
    const result = await wechatAuthService.login(code, state);
    
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
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
    }
    
    return response;
  } catch (error) {
    console.error('微信登录错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
