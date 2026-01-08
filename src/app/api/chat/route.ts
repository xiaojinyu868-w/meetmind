/**
 * AI 对话 API 路由
 * 
 * POST /api/chat
 * - 支持多模型选择
 * - 支持流式响应
 */

import { NextRequest, NextResponse } from 'next/server';
import { chat, chatStream, AVAILABLE_MODELS, type ChatMessage } from '@/lib/services/llm-service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      messages, 
      model = 'qwen3-max', 
      stream = false,
      context,
      temperature = 0.7,
      maxTokens = 2000,
    } = body as {
      messages: ChatMessage[];
      model?: string;
      stream?: boolean;
      context?: string;
      temperature?: number;
      maxTokens?: number;
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

    // 如果有上下文，添加到系统消息中
    let finalMessages = [...messages];
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

    // 流式响应
    if (stream) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of chatStream(finalMessages, model, { temperature, maxTokens })) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
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
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
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
    console.error('Chat API error:', error);
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
    defaultModel: 'qwen3-max',
  });
}
