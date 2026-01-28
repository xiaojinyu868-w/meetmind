/**
 * 发送验证码 API
 * 
 * POST /api/auth/send-code
 * 
 * Body:
 * - target: string (邮箱或手机号)
 * - type: 'email' | 'sms'
 * - purpose: 'login' | 'register' | 'reset_password'
 */

import { NextRequest, NextResponse } from 'next/server';
import { emailService } from '@/lib/services/email-service';
import { smsService } from '@/lib/services/sms-service';
import type { CodePurpose } from '@/lib/services/verification-code-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target, type, purpose } = body as {
      target: string;
      type: 'email' | 'sms';
      purpose: CodePurpose;
    };

    // 参数验证
    if (!target || !type || !purpose) {
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

    if (!['login', 'register', 'reset_password'].includes(purpose)) {
      return NextResponse.json(
        { success: false, error: '无效的用途类型' },
        { status: 400 }
      );
    }

    // 发送验证码
    let result;
    if (type === 'email') {
      result = await emailService.sendVerificationCode(target, purpose);
    } else {
      result = await smsService.sendVerificationCode(target, purpose);
    }

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, retryAfter: result.retryAfter },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] 发送验证码失败:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
