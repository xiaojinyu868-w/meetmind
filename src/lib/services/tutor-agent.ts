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
    onEvent,
    signal,
  } = options;

  // 创建绑定了 workspaceId 的工具实例
  const tools = createTutorTools(workspaceId);

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

  // 订阅 Pi Agent 事件 → 转换为前端 SSE 事件
  agent.subscribe((event: PiAgentEvent) => {
    switch (event.type) {
      case 'tool_execution_start':
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

      case 'message_end':
        // 检查是否是最终的 assistant 消息（无 tool calls）
        if (event.message.role === 'assistant') {
          const textBlocks = event.message.content.filter(
            (b: { type: string }) => b.type === 'text'
          ) as Array<{ type: 'text'; text: string }>;
          const text = textBlocks.map(b => b.text).join('');
          if (text) {
            finalContent = text;
          }
        }
        break;

      case 'agent_end':
        // Agent 运行结束，推送最终内容
        if (finalContent) {
          onEvent({ type: 'content_done', content: finalContent });
        } else {
          onEvent({
            type: 'content_done',
            content: '我查看了你的学习记录，但需要更多信息才能回答这个问题。你能说得更具体一些吗？',
          });
        }
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
