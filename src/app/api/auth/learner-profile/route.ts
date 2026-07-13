/**
 * 学习者画像 API
 * GET  /api/auth/learner-profile  — 获取当前用户画像
 * PATCH /api/auth/learner-profile — 保存/更新画像（Onboarding 或 Settings 调用）
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('auth/learner-profile');

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

export async function GET(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const user = await authService.getUserById(payload.sub);
    if (!user) {
      return NextResponse.json({ success: false, error: '用户不存在' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      learnerProfile: user.learnerProfile ?? null,
      onboardingCompleted: !!user.onboardingCompletedAt,
    });
  } catch (error) {
    log.error('获取学习者画像错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return NextResponse.json({ success: false, error: '未授权' }, { status: 401 });
    }

    const body = await request.json();

    // 基本校验：必须有 stage 字段
    if (!body || !body.stage) {
      return NextResponse.json(
        { success: false, error: '缺少 stage 字段' },
        { status: 400 }
      );
    }

    // 对话式目标共建允许用户先确认自然语言画像，再决定是否填写结构化身份。
    // `unknown` 是正式状态，不是校验漏洞。
    const validStages = ['unknown', 'k12', 'university', 'graduate', 'working'];
    if (!validStages.includes(body.stage)) {
      return NextResponse.json(
        { success: false, error: `无效的 stage: ${body.stage}` },
        { status: 400 }
      );
    }

    const user = await authService.saveLearnerProfile(payload.sub, body);
    if (!user) {
      return NextResponse.json(
        { success: false, error: '保存失败' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      user,
      learnerProfile: user.learnerProfile,
    });
  } catch (error) {
    log.error('保存学习者画像错误:', error);
    return NextResponse.json({ success: false, error: '服务器错误' }, { status: 500 });
  }
}
