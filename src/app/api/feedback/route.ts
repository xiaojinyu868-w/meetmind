import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, title, content, contact } = body;

    // 验证必填字段
    if (!type || !title || !content) {
      return NextResponse.json(
        { success: false, error: '请填写完整的反馈信息' },
        { status: 400 }
      );
    }

    // 验证反馈类型
    const validTypes = ['bug', 'feature', 'question', 'other'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: '无效的反馈类型' },
        { status: 400 }
      );
    }

    // 验证长度
    if (title.length > 100) {
      return NextResponse.json(
        { success: false, error: '标题不能超过100个字符' },
        { status: 400 }
      );
    }

    if (content.length > 2000) {
      return NextResponse.json(
        { success: false, error: '详细描述不能超过2000个字符' },
        { status: 400 }
      );
    }

    // 获取当前用户（可选）
    let userId: string | null = null;
    try {
      const token = request.cookies.get('accessToken')?.value 
        || request.headers.get('Authorization')?.replace('Bearer ', '');
      
      if (token) {
        const payload = await authService.verifyAccessToken(token);
        if (payload) {
          userId = payload.userId;
        }
      }
    } catch {
      // 未登录用户也可以提交反馈
    }

    // 获取客户端信息
    const userAgent = request.headers.get('user-agent') || '';
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip') 
      || 'unknown';

    // 保存反馈到数据库
    const feedback = await prisma.feedback.create({
      data: {
        type,
        title,
        content,
        contact: contact || null,
        userId,
        userAgent,
        ip,
        status: 'pending',
      },
    });

    console.log(`[Feedback] New feedback received: ${feedback.id}, type: ${type}, title: ${title}`);

    return NextResponse.json({
      success: true,
      message: '反馈提交成功',
      feedbackId: feedback.id,
    });

  } catch (error) {
    console.error('[Feedback] Error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}
