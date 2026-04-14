/**
 * Tutor Agent — 两层流式路由
 *
 * 层 1（快速路径）：有当前课堂 segments → 直接流式 LLM
 *   首 token: ~0.7s
 *
 * 层 2（预检索路径）：有 workspace 但无 segments → 代码先查 DB → 流式 LLM
 *   首 token: ~0.8s
 *
 * 两层都走 DashScope 原生 streaming API（不带 tools），确保真流式。
 */

import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';

const log = createLogger('tutor-agent');

const DASHSCOPE_BASE_URL = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const STREAM_MODEL = 'qwen-plus'; // 流式模型（快、便宜、质量够）

// ── SSE 事件类型（推送给前端）──

export interface TutorAgentSSEEvent {
  type: 'tool_start' | 'tool_result' | 'content_delta' | 'content_done' | 'error';
  [key: string]: unknown;
}

// ── 运行选项 ──

export interface AgentRunOptions {
  workspaceId: string;
  userMessage: string;
  systemPrompt: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  learnerContextPrompt?: string;
  /** 有 segments 时为 true——跳过 DB 检索 */
  skipDbTools?: boolean;
  onEvent: (event: TutorAgentSSEEvent) => void;
  signal?: AbortSignal;
}

// ── 入口 ──

export async function runTutorAgent(options: AgentRunOptions): Promise<string> {
  const { workspaceId, skipDbTools = false } = options;

  if (skipDbTools || !workspaceId) {
    // 层 1：有 segments 或无 workspace → 直接流式
    return runDirectStream(options);
  }

  // 层 2：有 workspace → 预检索后流式
  return runPreFetchStream(options);
}

// ── 层 1：直接流式 LLM ──

async function runDirectStream(options: AgentRunOptions): Promise<string> {
  const {
    userMessage,
    systemPrompt,
    conversationHistory = [],
    learnerContextPrompt = '',
    onEvent,
    signal,
  } = options;

  const t0 = Date.now();

  const fullSystemPrompt = [
    systemPrompt,
    learnerContextPrompt,
    conversationHistory.length > 0
      ? '\n\n【对话历史】\n' + conversationHistory.slice(-10).map(
          m => `${m.role === 'user' ? '学生' : 'AI'}：${m.content}`
        ).join('\n')
      : '',
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: STREAM_MODEL,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4000,
        enable_thinking: false,
      }),
      signal,
    });

    if (!response.ok) {
      const error = await response.text();
      log.error(`Stream error: ${response.status} - ${error}`);
      onEvent({ type: 'error', message: '模型调用失败' });
      onEvent({ type: 'content_done', content: '抱歉，我暂时无法回答。请稍后再试。' });
      return '';
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onEvent({ type: 'content_done', content: '抱歉，无法获取响应流。' });
      return '';
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let firstDelta = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const chunk = JSON.parse(raw);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            if (firstDelta) {
              log.info(`[perf] first_delta: +${Date.now() - t0}ms`);
              firstDelta = false;
            }
            fullContent += delta;
            onEvent({ type: 'content_delta', delta });
          }
        } catch { /* ignore */ }
      }
    }

    onEvent({ type: 'content_done', content: fullContent });
    log.info(`[perf] done: +${Date.now() - t0}ms, length=${fullContent.length}`);
    return fullContent;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return '';
    }
    log.error('Stream error:', error);
    const errMsg = error instanceof Error ? error.message : '未知错误';
    onEvent({ type: 'error', message: errMsg });
    onEvent({ type: 'content_done', content: `抱歉，出错了：${errMsg}` });
    return '';
  }
}

// ── 层 2：预检索 + 流式 LLM ──

async function runPreFetchStream(options: AgentRunOptions): Promise<string> {
  const { workspaceId, onEvent } = options;
  const t0 = Date.now();

  let contextSummary = '';
  try {
    const captures = await prisma.workspaceCapture.findMany({
      where: { workspaceId, status: 'active' },
      select: { id: true, title: true, previewText: true, createdAt: true, tutorContext: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (captures.length > 0) {
      const lines: string[] = [`\n\n【学生的学习记录（共 ${captures.length} 条最近的）】`];
      for (const cap of captures.slice(0, 10)) {
        const preview = cap.previewText ? cap.previewText.slice(0, 100) : '';
        lines.push(`- ${cap.title} (${cap.createdAt.toLocaleDateString('zh-CN')}) ${preview}`);
        if (cap.tutorContext) {
          lines.push(`  [学习痕迹] ${cap.tutorContext.slice(0, 200)}`);
        }
      }
      contextSummary = lines.join('\n');
    }

    log.info(`[perf] pre_fetch: +${Date.now() - t0}ms, records=${captures.length}`);
  } catch (err) {
    log.error('Pre-fetch error:', err);
  }

  // 通知前端
  if (contextSummary) {
    onEvent({ type: 'tool_start', toolName: 'pre_fetch', toolArgs: {}, description: '查看学习记录' });
    onEvent({ type: 'tool_result', toolName: 'pre_fetch', isError: false, resultPreview: '找到学习记录' });
  }

  return runDirectStream({
    ...options,
    systemPrompt: options.systemPrompt + contextSummary,
  });
}
