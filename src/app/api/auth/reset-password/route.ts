/**
 * 重置密码 API（忘记密码场景）
 * POST /api/auth/reset-password
 * 
 * 流程：用户先通过 /api/auth/send-code 发送验证码，验证后重置密码
 */

import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { emailService } from '@/lib/services/email-service';
import { smsService } from '@/lib/services/sms-service';

interface ResetPasswordRequest {
  target: string;      // 邮箱或手机号
  code: string;        // 验证码
  newPassword: string; // 新密码
}

export async function POST(request: NextRequest) {
  try {
    const body: ResetPasswordRequest = await request.json();
    
    // 验证必填字段
    if (!body.target || !body.code || !body.newPassword) {
      return NextResponse.json(
        { success: false, error: '请提供完整信息' },
        { status: 400 }
      );
    }
    
    // 判断是邮箱还是手机号
    const isEmail = body.target.includes('@');
    
    // 验证验证码
    let verifyResult;
    if (isEmail) {
      verifyResult = await emailService.verifyCode(body.target, body.code, 'reset_password');
    } else {
      verifyResult = await smsService.verifyCode(body.target, body.code, 'reset_password');
    }
    
    if (!verifyResult.success) {
      return NextResponse.json(
        { success: false, error: verifyResult.error || '验证码错误' },
        { status: 400 }
      );
    }
    
    // 重置密码
    const resetResult = await authService.resetPassword(body.target, body.newPassword);
    
    if (!resetResult.success) {
      return NextResponse.json(resetResult, { status: 400 });
    }
    
    return NextResponse.json({ success: true, message: '密码重置成功' });
  } catch (error) {
    console.error('重置密码错误:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
