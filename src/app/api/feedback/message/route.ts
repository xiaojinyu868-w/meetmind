/**
 * /api/feedback/message - M14.5 消息级 👍/👎 反馈
 *
 * 设计：
 *   - 复用现有 Feedback 表（type='message-rating' 区分），避免 db migration
 *   - 不强制登录（访客也能反馈，用 guest userId）
 *   - 字段映射：
 *     - title = `[messageId] 👍 / 👎`
 *     - content = JSON.stringify({ rating, mode, modelId, messageText, comment })
 *
 * 价值：
 *   - 数据闭环：分析哪个 mode / model 上 👎 多 → 反推 prompt 哪里不对
 *   - 用户感知：标志性大厂能力（ChatGPT / Claude / 几乎所有 AI 产品都有）
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { authService } from '@/lib/services/auth-service';

const BodySchema = z.object({
  messageId: z.string().min(1).max(200),
  rating: z.enum(['up', 'down']),
  mode: z.string().optional(), // in-class / review / shared / goal / word
  modelId: z.string().optional(),
  /** 被反馈的 AI 消息文本（截断 1000 字以便分析） */
  messageText: z.string().max(1000).optional(),
  /** 用户文字补充（仅 👎 时显示） */
  comment: z.string().max(500).optional(),
  userId: z.string().optional(),
});

function getAuthenticatedUserId(request: NextRequest): string | null {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    || request.cookies.get('accessToken')?.value;
  return token ? authService.verifyToken(token)?.sub ?? null : null;
}

export async function POST(request: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    const json = await request.json();
    body = BodySchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'invalid_body' },
      { status: 400 },
    );
  }

  try {
    const userAgent = request.headers.get('user-agent')?.slice(0, 200) || undefined;
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      undefined;

    const ratingLabel = body.rating === 'up' ? '👍' : '👎';
    await prisma.feedback.create({
      data: {
        type: 'message-rating',
        title: `[${body.messageId.slice(0, 60)}] ${ratingLabel}`,
        content: JSON.stringify({
          rating: body.rating,
          mode: body.mode,
          modelId: body.modelId,
          messageText: body.messageText?.slice(0, 1000),
          comment: body.comment,
        }),
        // 绝不信任客户端传入的 userId，避免将反馈写入他人账号。
        userId: getAuthenticatedUserId(request),
        userAgent,
        ip,
        status: 'pending',
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[feedback/message] failed:', err);
    return NextResponse.json(
      { ok: false, error: 'persist_failed' },
      { status: 500 },
    );
  }
}
