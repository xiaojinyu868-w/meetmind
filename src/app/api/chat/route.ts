/**
 * AI 对话 API 路由
 * 
 * POST /api/chat
 * - 支持多模型选择
 * - 支持流式响应
 * - 包含速率限制（防刷）
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  chat,
  chatStream,
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  type ChatMessage,
  type MultimodalContent,
} from '@/lib/services/llm-service';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';
const log = createLogger('chat');


export async function POST(request: NextRequest) {
  // 应用速率限制
  const rateLimitResponse = await applyRateLimit(request, 'chat');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { 
      messages, 
      model = DEFAULT_MODEL_ID, 
      stream = false,
      context,
      temperature = 0.7,
      maxTokens = 2000,
      enable_thinking_guide = false,
      messageContent,
    } = body as {
      messages: ChatMessage[];
      model?: string;
      stream?: boolean;
      context?: string;
      temperature?: number;
      maxTokens?: number;
      enable_thinking_guide?: boolean;
      messageContent?: string | MultimodalContent[];
    };

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: '缺少 messages 参数' },
        { status: 400 }
      );
    }

    // 验证模型是否可用
    const modelConfig = AVAILABLE_MODELS.find(m => m.id === model);
    if (!modelConfig) {
      return NextResponse.json(
        { error: `不支持的模型: ${model}`, availableModels: AVAILABLE_MODELS.map(m => m.id) },
        { status: 400 }
      );
    }

    if (modelConfig.requiresStreaming && !stream) {
      return NextResponse.json(
        { error: `${model} 仅支持流式调用，请设置 stream=true` },
        { status: 400 }
      );
    }

    // 学霸思维引导 Prompt
    const THINKING_GUIDE_PROMPT = `

【学霸思维引导模式】
你是一位清北学霸学长/学姐，你非常擅长应试思维，各种中高考考试大纲都能融会贯通，你的目的是让学弟学妹能模仿你的思维方式。

请按以下结构回答（结构固定，但每一步的标题和内容你自由发挥）：

---思维演示---

【你自己起的步骤名】
用"我"的口吻自然地写这一步你是怎么想的...
引用课堂内容时标注 [MM:SS]

💡 心得（可迁移的思维技巧）

【下一步的名字，你自己定】
继续展示思路...

💡 心得

（步骤数量根据问题复杂度灵活调整）

🌟 本次思维方法：方法1 → 方法2 → 方法3

---正式回答---

这里给出正式的回答内容

【格式要求】
- 用 ---思维演示--- 和 ---正式回答--- 作为分隔
- 每个步骤用【步骤名】开头
- 每步后用 💡 给一句可迁移的心得
- 最后用 🌟 总结用到的思维方法
- 语气像一位同桌`;

    // 如果有上下文，添加到系统消息中
    const finalMessages = [...messages];

    // 注入思维引导 prompt 到系统消息
    if (enable_thinking_guide) {
      const systemIndex = finalMessages.findIndex(m => m.role === 'system');
      if (systemIndex >= 0) {
        finalMessages[systemIndex] = {
          ...finalMessages[systemIndex],
          content: `${finalMessages[systemIndex].content}${THINKING_GUIDE_PROMPT}`,
        };
      } else {
        finalMessages.unshift({
          role: 'system',
          content: THINKING_GUIDE_PROMPT,
        });
      }
    }

    if (context) {
      const systemIndex = finalMessages.findIndex(m => m.role === 'system');
      if (systemIndex >= 0) {
        finalMessages[systemIndex] = {
          ...finalMessages[systemIndex],
          content: `${finalMessages[systemIndex].content}\n\n【参考资料】\n${context}`,
        };
      } else {
        finalMessages.unshift({
          role: 'system',
          content: `【参考资料】\n${context}`,
        });
      }
    }

    if (messageContent !== undefined) {
      const lastUserIndex = [...finalMessages]
        .map((message, index) => ({ message, index }))
        .reverse()
        .find(({ message }) => message.role === 'user')?.index;

      if (lastUserIndex === undefined) {
        return NextResponse.json(
          { error: 'messageContent 需要配合至少一条 user message 使用' },
          { status: 400 }
        );
      }

      finalMessages[lastUserIndex] = {
        ...finalMessages[lastUserIndex],
        content: messageContent,
      };
    }

    // 流式响应
    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of chatStream(finalMessages, model, { temperature, maxTokens })) {
              // chunk 是 { type: 'thinking' | 'content', content: string }
              // 为了兼容旧的格式，这里只传递 content 内容
              // 如果是思考模式，也可以传递 thinking 类型
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: chunk.type, content: chunk.content })}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Connection': 'keep-alive',
          // 关键：禁用各种代理/CDN的缓冲
          'X-Accel-Buffering': 'no',           // Nginx
          'X-Content-Type-Options': 'nosniff',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // 普通响应
    const response = await chat(finalMessages, model, { temperature, maxTokens });
    
    return NextResponse.json({
      content: response.content,
      model: response.model,
      usage: response.usage,
    });
  } catch (error) {
    log.error('Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

// 获取可用模型列表
export async function GET() {
  return NextResponse.json({
    models: AVAILABLE_MODELS,
    defaultModel: DEFAULT_MODEL_ID,
  });
}
