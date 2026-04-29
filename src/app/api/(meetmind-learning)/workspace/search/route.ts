/**
 * AI 全局检索 API
 *
 * POST /api/workspace/search
 * Body: { query: string }
 *
 * SSE 流式返回：
 * - data: {"type":"sources","sources":[...]}   // 来源元数据（首条）
 * - data: {"type":"content","content":"..."}    // AI 回答片段
 * - data: [DONE]                                // 完成
 * - data: {"error":"..."}                       // 错误
 */

import { NextRequest } from 'next/server';
import { authService } from '@/lib/services/auth-service';
import { searchCaptures } from '@/lib/services/workspace-search-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authService.verifyToken(authHeader.slice(7));
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  'X-Content-Type-Options': 'nosniff',
  'Transfer-Encoding': 'chunked',
};

export async function POST(request: NextRequest) {
  // 鉴权
  const payload = getAuthPayload(request);
  if (!payload) {
    return new Response(JSON.stringify({ success: false, error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 速率限制
  const rateLimitResponse = await applyRateLimit(request, 'search');
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  // 解析请求体
  let query: string;
  try {
    const body = await request.json();
    query = (body.query || '').trim();
  } catch {
    return new Response(JSON.stringify({ success: false, error: '请求格式错误' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!query) {
    return new Response(JSON.stringify({ success: false, error: '请输入搜索内容' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (query.length > 500) {
    return new Response(JSON.stringify({ success: false, error: '搜索内容过长' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = payload.sub;
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const { sources, answerStream } = await searchCaptures(userId, query);

        // 发送来源元数据（首条事件）
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`)
        );

        // 流式转发 AI 回答
        for await (const chunk of answerStream) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: chunk.type, content: chunk.content })}\n\n`
            )
          );
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '检索失败，请稍后重试';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readable, { headers: SSE_HEADERS });
}
