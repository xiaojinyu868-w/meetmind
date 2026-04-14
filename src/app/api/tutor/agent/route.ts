/**
 * Agentic Tutor API
 *
 * POST /api/tutor/agent
 *
 * 和普通 Tutor 的区别：
 * - 返回 SSE 流，前端可以实时显示 Agent 的思考过程
 * - Agent 自主决定检索哪些学习上下文（渐进式探索）
 * - 前端可以渲染 tool 调用过程（Manus 风格 UI）
 *
 * 请求体：
 * {
 *   message: string;           // 用户消息
 *   history?: Array<{ role: string; content: string }>; // 对话历史
 * }
 *
 * 响应：text/event-stream SSE
 * 事件类型：
 * - thinking: { message: string }
 * - tool_start: { toolName, toolArgs, description }
 * - tool_result: { toolName, resultPreview }
 * - content_done: { content: string }
 * - error: { message: string }
 */

import { NextRequest } from 'next/server';
import { runTutorAgent, type AgentEvent } from '@/lib/services/tutor-agent';
import { authService } from '@/lib/services/auth-service';
import { formatLearnerContext } from '@/app/api/tutor/tutor-prompts';
import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const log = createLogger('tutor/agent');

const AGENT_SYSTEM_PROMPT = `你是学生的 AI 同桌。你有能力检索学生的全部学习记录，包括课堂转录、个人困惑标记、历史对话。

你的任务：
- 先理解学生在问什么
- 从他的学习记录中找到最相关的内容
- 用自然、口语化的方式回答，像同桌一样

说话方式：
- 1-5 句话，不要长篇大论
- 可以引用课堂原话，但要自然
- 如果发现学生之前在某个知识点上卡过，直接提出来
- 可以反问——"你是想问XX，还是想问YY？"`;

function getAuthPayload(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authService.verifyToken(authHeader.slice(7));
}

export async function POST(request: NextRequest) {
  try {
    const payload = getAuthPayload(request);
    if (!payload) {
      return new Response(JSON.stringify({ error: '未授权' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const { message, history = [] } = body as {
      message: string;
      history?: Array<{ role: string; content: string }>;
    };

    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: '消息不能为空' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 获取用户的 workspace
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { defaultWorkspaceId: true, learnerProfileJson: true },
    });

    if (!user?.defaultWorkspaceId) {
      return new Response(JSON.stringify({ error: '未找到学习空间' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const learnerContextPrompt = formatLearnerContext(user.learnerProfileJson);

    // SSE 流
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const sendEvent = (event: AgentEvent) => {
          const data = JSON.stringify({ type: event.type, ...event.data });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        void runTutorAgent({
          workspaceId: user.defaultWorkspaceId!,
          userMessage: message.trim(),
          systemPrompt: AGENT_SYSTEM_PROMPT,
          conversationHistory: history,
          learnerContextPrompt,
          onEvent: sendEvent,
          signal: request.signal,
        }).then(() => {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }).catch((error) => {
          log.error('Agent run error:', error);
          sendEvent({ type: 'error', data: { message: '服务出错了' } });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error('Tutor agent error:', error);
    return new Response(JSON.stringify({ error: '服务器错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
