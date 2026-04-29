import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';
import { emailService } from '@/lib/services/email-service';
import workspaceService from '@/lib/services/workspace-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { createLogger } from '@/lib/logger';
const log = createLogger('wechat/bind');


export const runtime = 'nodejs';

/**
 * 微信绑定 API — 支持两种模式：
 * 1. mode='password': 用户名+密码登录，绑定 openId
 * 2. mode='code': 邮箱+验证码登录（新用户自动注册），绑定 openId
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode = 'password', openId, linkToken } = body;

    if (!openId?.trim()) {
      return NextResponse.json(
        { success: false, error: '缺少微信身份信息' },
        { status: 400 }
      );
    }

    let loginResult;

    if (mode === 'code') {
      // --- 邮箱验证码模式（支持自动注册） ---
      const { email, code } = body;

      if (!email?.trim() || !code?.trim()) {
        return NextResponse.json(
          { success: false, error: '请填写邮箱和验证码' },
          { status: 400 }
        );
      }

      const verifyResult = await emailService.verifyCode(email.trim(), code.trim(), 'login');
      if (!verifyResult.success) {
        return NextResponse.json(
          { success: false, error: verifyResult.error || '验证码错误', attemptsLeft: verifyResult.attemptsLeft },
          { status: 400 }
        );
      }

      loginResult = await authService.loginWithCode(email.trim(), 'email');

    } else {
      // --- 密码模式 ---
      const { username, password } = body;

      if (!username?.trim() || !password?.trim()) {
        return NextResponse.json(
          { success: false, error: '请填写账号和密码' },
          { status: 400 }
        );
      }

      loginResult = await authService.login({
        username: username.trim(),
        password: password.trim(),
      });
    }

    if (!loginResult.success || !loginResult.user) {
      return NextResponse.json(
        { success: false, error: loginResult.error || '登录失败' },
        { status: 401 }
      );
    }

    const userId = loginResult.user.id;

    // 检查 openId 是否已绑定到其他账户
    const existingBinding = await prisma.authProvider.findUnique({
      where: {
        provider_providerId: {
          provider: 'wechat',
          providerId: openId,
        },
      },
    });

    if (existingBinding && existingBinding.userId !== userId) {
      return NextResponse.json(
        { success: false, error: '这个微信号已经绑定了其他账户' },
        { status: 409 }
      );
    }

    // 绑定 openId → 用户
    if (!existingBinding) {
      await authService.linkAuthProvider(userId, 'wechat', {
        providerId: openId,
      });
    }

    // 同步工作区和收集流
    const binding = await workspaceService.resolveWechatWorkspace(openId);
    if (binding) {
      await workspaceContextService.syncWechatInboxArtifactsForOpenId(openId);
    }

    if (linkToken) {
      await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken);
    }

    const response = NextResponse.json({
      success: true,
      message: '绑定成功，以后发给服务号的内容会自动进入你的收集流。',
      user: {
        id: loginResult.user.id,
        nickname: loginResult.user.nickname,
      },
      accessToken: loginResult.accessToken,
      token: loginResult.accessToken,
      refreshToken: loginResult.refreshToken,
    });

    if (loginResult.refreshToken) {
      response.cookies.set('refreshToken', loginResult.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
    }

    return response;
  } catch (error) {
    log.error('wechat bind failed:', error);
    return NextResponse.json(
      { success: false, error: '绑定失败，请稍后重试' },
      { status: 500 }
    );
  }
}
