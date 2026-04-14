/**
 * Tutor Agent — 基于 Pi Agent 框架的 Agentic 辅导引擎
 *
 * 核心架构：
 * - Pi Agent 的 Agent 类管理 tool-call 循环、重试、并行执行
 * - DashScope (Qwen3.6-Plus) 通过 Pi 的 openai-completions API 对接
 * - 5 个 AgentTool 提供渐进式学习上下文检索 + 联网搜索
 * - AgentEvent 事件流通过 SSE 推送给前端
 */

import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent as PiAgentEvent, AgentTool } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { createTutorTools } from './tutor-agent-tools';
import { createLogger } from '@/lib/logger';

const log = createLogger('tutor-agent');

const DASHSCOPE_BASE_URL = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';

// ── DashScope Model（Pi 的 openai-completions 兼容模式）──

const dashscopeModel: Model<'openai-completions'> = {
  id: 'qwen3.6-plus',
  name: 'Qwen 3.6 Plus',
  api: 'openai-completions',
  provider: 'dashscope',
  baseUrl: DASHSCOPE_BASE_URL,
  reasoning: false,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131072,
  maxTokens: 8192,
  compat: {
    thinkingFormat: 'qwen',
    maxTokensField: 'max_tokens',
    supportsUsageInStreaming: true,
    requiresToolResultName: true,
  },
};

// ── SSE 事件类型（推送给前端）──

export interface TutorAgentSSEEvent {
  type: 'tool_start' | 'tool_result' | 'content_delta' | 'content_done' | 'error';
  [key: string]: unknown;
}

// ── Agent 运行选项 ──

export interface AgentRunOptions {
  workspaceId: string;
  userMessage: string;
  systemPrompt: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  learnerContextPrompt?: string;
  /** 跳过 DB 检索工具（当课堂内容已在 system prompt 中时）——只保留 web_search */
  skipDbTools?: boolean;
  onEvent: (event: TutorAgentSSEEvent) => void;
  signal?: AbortSignal;
}

// ── 工具描述映射（用于前端显示）──

function getToolLabel(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'list_subjects': return '查看学过哪些科目';
    case 'list_captures': return `查看「${args.subject || ''}」的课堂记录`;
    case 'get_personal_context': return '查看这节课的学习痕迹';
    case 'read_transcript': return '阅读课堂转录';
    case 'web_search': return `联网搜索「${args.query || ''}」`;
    default: return toolName;
  }
}

// ── 核心：运行 Tutor Agent ──

export async function runTutorAgent(options: AgentRunOptions): Promise<string> {
  const {
    workspaceId,
    userMessage,
    systemPrompt,
    conversationHistory = [],
    learnerContextPrompt = '',
    skipDbTools = false,
    onEvent,
    signal,
  } = options;

  // ── 三层路由策略 ──
  //
  // 层 1（快速路径）：有当前课堂 segments → 直接流式 LLM，不用 tool
  //   首 token: ~1-2s
  //
  // 层 2（预检索路径）：有 workspace 但无 segments → 代码先查 DB 塞 prompt → 流式 LLM
  //   首 token: ~2-3s（DB 查询 <100ms + LLM 流式）
  //
  // 层 3（Agent 路径）：需要复杂检索/联网搜索 → Pi Agent tool-call 循环
  //   首 token: ~10-20s（多轮 LLM 调用）
  //
  // 当前：层 1 和层 2 走 runDirectStream，层 3 走 Pi Agent

  if (skipDbTools) {
    // 层 1：有 segments，直接流式
    return runDirectStream(options);
  }

  if (workspaceId) {
    // 层 2：有 workspace，预检索后直接流式
    return runPreFetchStream(options);
  }

  // 层 3：Pi Agent（暂时不会到达——因为无 workspace 无 segments 时 skipDbTools=true）
  // 保留作为未来复杂场景的兜底

  // 创建工具集（完整 Agent 路径）
  const allTools = createTutorTools(workspaceId);
  const tools = allTools;

  // 创建 Pi Agent
  let historyContext = '';
  if (conversationHistory.length > 0) {
    const recentHistory = conversationHistory.slice(-10);
    historyContext = '\n\n【对话历史】\n' + recentHistory.map(
      m => `${m.role === 'user' ? '学生' : 'AI'}：${m.content}`
    ).join('\n');
  }

  // 构建 system prompt
  const fullSystemPrompt = [
    systemPrompt,
    learnerContextPrompt,
    historyContext,
    '',
    '你有以下工具可以检索学生的学习上下文。使用策略：',
    '1. 先调用 list_subjects 了解学生学过什么',
    '2. 根据问题定位到相关科目，调用 list_captures 看具体有哪些课',
    '3. 调用 get_personal_context 了解学生在相关课上的个人学习痕迹（锚点、对话、检验）',
    '4. 只在需要引用课堂原话时才调用 read_transcript',
    '5. 当问题超出课堂内容范围、需要额外知识/公式/最新资料时，调用 web_search 联网搜索',
    '',
    '不要一次调用所有工具。像人一样渐进式探索——先看目录，再看摘要，按需深入。',
    '如果学生的问题很明确且你已有足够信息，可以不调用任何工具直接回答。',
    '联网搜索到的内容记得在回答中标注来源。',
  ].filter(Boolean).join('\n');

  // 创建 Pi Agent
  const t0 = Date.now();
  log.info(`[perf] Agent setup: ${Date.now() - t0}ms`);
  const agent = new Agent({
    initialState: {
      systemPrompt: fullSystemPrompt,
      model: dashscopeModel,
      thinkingLevel: 'minimal',
    },
    getApiKey: () => DASHSCOPE_API_KEY,
    toolExecution: 'sequential',
  });

  // 设置工具
  agent.state.tools = tools as AgentTool[];

  // 收集最终回答
  let finalContent = '';
  let lastPushedLength = 0;
  let toolCallsInProgress = false; // 标记当前轮次是否有 tool call

  // 订阅 Pi Agent 事件 → 转换为前端 SSE 事件
  agent.subscribe((event: PiAgentEvent) => {
    const elapsed = Date.now() - t0;
    switch (event.type) {
      case 'tool_execution_start':
        log.info(`[perf] +${elapsed}ms tool_start: ${event.toolName}`);
        toolCallsInProgress = true;
        onEvent({
          type: 'tool_start',
          toolName: event.toolName,
          toolArgs: event.args,
          description: getToolLabel(event.toolName, event.args || {}),
        });
        break;

      case 'tool_execution_end':
        onEvent({
          type: 'tool_result',
          toolName: event.toolName,
          isError: event.isError,
          resultPreview: typeof event.result === 'string'
            ? event.result.slice(0, 200)
            : JSON.stringify(event.result).slice(0, 200),
        });
        break;

      case 'message_start':
        log.info(`[perf] +${elapsed}ms message_start (role=${event.message.role})`);
        // 新的 message 开始——如果不是 tool call 轮次，重置追踪
        lastPushedLength = 0;
        toolCallsInProgress = false;
        break;

      case 'message_update': {
        // 流式推送——只在非 tool-call 轮次推送
        if (toolCallsInProgress) break;
        if (event.message.role === 'assistant') {
          const textBlocks = event.message.content.filter(
            (b: { type: string }) => b.type === 'text'
          ) as Array<{ type: 'text'; text: string }>;
          const fullText = textBlocks.map(b => b.text).join('');

          if (fullText.length > lastPushedLength) {
            if (lastPushedLength === 0) {
              log.info(`[perf] +${elapsed}ms first_content_delta`);
            }
            const delta = fullText.slice(lastPushedLength);
            lastPushedLength = fullText.length;
            onEvent({ type: 'content_delta', delta });
          }
        }
        break;
      }

      case 'message_end':
        if (event.message.role === 'assistant') {
          const textBlocks = event.message.content.filter(
            (b: { type: string }) => b.type === 'text'
          ) as Array<{ type: 'text'; text: string }>;
          const text = textBlocks.map(b => b.text).join('');
          if (text && !toolCallsInProgress) {
            finalContent = text;
            // 推送遗漏的最后一段
            if (text.length > lastPushedLength) {
              onEvent({ type: 'content_delta', delta: text.slice(lastPushedLength) });
            }
          }
          lastPushedLength = 0;
        }
        break;

      case 'agent_end':
        log.info(`[perf] +${elapsed}ms agent_end, content_length=${finalContent.length}`);
        onEvent({
          type: 'content_done',
          content: finalContent || '我查看了你的学习记录，但需要更多信息才能回答这个问题。你能说得更具体一些吗？',
        });
        break;
    }
  });

  // 运行 Agent
  try {
    if (signal) {
      signal.addEventListener('abort', () => agent.abort(), { once: true });
    }

    await agent.prompt(userMessage);
    await agent.waitForIdle();
  } catch (error) {
    log.error('Agent run error:', error);
    const errMsg = error instanceof Error ? error.message : '未知错误';
    onEvent({ type: 'error', message: errMsg });
    if (!finalContent) {
      finalContent = `抱歉，我暂时无法回答。请稍后再试。(${errMsg})`;
      onEvent({ type: 'content_done', content: finalContent });
    }
  }

  return finalContent;
}

// ── 快速路径：直接流式 LLM 调用（不走 Pi Agent）──
// 当课堂内容已在 system prompt 中时，不需要 tool call，直接流式生成回答

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
        model: 'qwen-plus',  // 快速模型（无 tool call 时不需要最大的）
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
      log.error(`Direct stream error: ${response.status} - ${error}`);
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
              log.info(`[perf] direct_stream first_delta: +${Date.now() - t0}ms`);
              firstDelta = false;
            }
            fullContent += delta;
            onEvent({ type: 'content_delta', delta });
          }
        } catch { /* ignore */ }
      }
    }

    onEvent({ type: 'content_done', content: fullContent });
    log.info(`[perf] direct_stream done: +${Date.now() - t0}ms, length=${fullContent.length}`);
    return fullContent;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return '';
    }
    log.error('Direct stream error:', error);
    const errMsg = error instanceof Error ? error.message : '未知错误';
    onEvent({ type: 'error', message: errMsg });
    onEvent({ type: 'content_done', content: `抱歉，出错了：${errMsg}` });
    return '';
  }
}

// ── 层 2：预检索路径 ──
// 代码先查 DB 获取学习上下文摘要，塞进 system prompt，然后走流式 LLM
// 比 Agent 快：1 次 DB 查询（<100ms）+ 1 次流式 LLM（~2s 首 token）

import prisma from '@/lib/prisma';

async function runPreFetchStream(options: AgentRunOptions): Promise<string> {
  const { workspaceId, onEvent } = options;
  const t0 = Date.now();

  // 预检索：查最近 20 条学习记录的摘要
  let contextSummary = '';
  try {
    const captures = await prisma.workspaceCapture.findMany({
      where: { workspaceId, status: 'active' },
      select: { id: true, title: true, previewText: true, contentType: true, createdAt: true, tutorContext: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (captures.length > 0) {
      const lines: string[] = [`\n\n【学生的学习记录（共 ${captures.length} 条最近的）】`];
      for (const cap of captures.slice(0, 10)) {
        const preview = cap.previewText ? cap.previewText.slice(0, 100) : '';
        lines.push(`- ${cap.title} (${cap.createdAt.toLocaleDateString('zh-CN')}) ${preview}`);
        // 如果有个人学习痕迹（困惑标记、对话历史），也附上
        if (cap.tutorContext) {
          lines.push(`  [学习痕迹] ${cap.tutorContext.slice(0, 200)}`);
        }
      }
      contextSummary = lines.join('\n');
    }

    log.info(`[perf] pre_fetch DB: +${Date.now() - t0}ms, records=${captures.length}`);
  } catch (err) {
    log.error('Pre-fetch DB error:', err);
  }

  // 通知前端：正在检索学习记录
  if (contextSummary) {
    onEvent({
      type: 'tool_start',
      toolName: 'pre_fetch',
      toolArgs: {},
      description: '查看学习记录',
    });
    onEvent({
      type: 'tool_result',
      toolName: 'pre_fetch',
      isError: false,
      resultPreview: `找到学习记录`,
    });
  }

  // 把预检索结果拼入 system prompt，走快速流式路径
  return runDirectStream({
    ...options,
    systemPrompt: options.systemPrompt + contextSummary,
  });
}
