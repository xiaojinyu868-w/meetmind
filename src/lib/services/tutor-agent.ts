/**
 * Tutor Agent — Agentic 辅导引擎
 *
 * 核心机制：
 * 1. 接收用户问题
 * 2. 给 LLM 学习上下文检索工具（list_subjects / list_captures / get_personal_context / read_transcript）
 * 3. LLM 自主决定调哪些工具、调几次、读多深（渐进式探索）
 * 4. 每一步通过 SSE 事件流推送给前端（Manus 风格 UI）
 * 5. 最终生成回答
 *
 * 设计参考：A-RAG（层级检索接口）+ Pi Agent（极简 tool-call 循环）
 */

import { createLogger } from '@/lib/logger';
import { TUTOR_AGENT_TOOLS, executeTool } from './tutor-agent-tools';

const log = createLogger('tutor-agent');

const MAX_TOOL_ROUNDS = 6; // 最多 6 轮 tool call，防止死循环
const DASHSCOPE_BASE_URL = process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || '';
const AGENT_MODEL = 'qwen3.6-plus'; // 需要 function calling 支持

// ── SSE 事件类型 ──

export interface AgentEvent {
  type: 'thinking' | 'tool_start' | 'tool_result' | 'content_delta' | 'content_done' | 'error';
  data: Record<string, unknown>;
}

export interface AgentRunOptions {
  workspaceId: string;
  userMessage: string;
  systemPrompt: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  learnerContextPrompt?: string;
  onEvent: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

// ── OpenAI 兼容类型 ──

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
}

// ── Agent 循环 ──

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

  // 构建初始消息
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        systemPrompt,
        learnerContextPrompt,
        '',
        '你有以下工具可以检索学生的学习上下文。使用策略：',
        '1. 先调用 list_subjects 了解学生学过什么',
        '2. 根据问题定位到相关科目，调用 list_captures 看具体有哪些课',
        '3. 调用 get_personal_context 了解学生在相关课上的个人学习痕迹（锚点、对话、检验）',
        '4. 只在需要引用课堂原话时才调用 read_transcript',
        '',
        '不要一次调用所有工具。像人一样渐进式探索——先看目录，再看摘要，按需深入。',
        '如果学生的问题很明确且你已有足够信息，可以不调用任何工具直接回答。',
      ].filter(Boolean).join('\n'),
    },
  ];

  // 加入对话历史
  for (const msg of conversationHistory.slice(-10)) {
    messages.push({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    });
  }

  // 加入当前用户消息
  messages.push({ role: 'user', content: userMessage });

  let finalContent = '';
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    if (signal?.aborted) {
      onEvent({ type: 'error', data: { message: '已取消' } });
      return finalContent || '已取消。';
    }

    round++;

    // 调用 LLM（带 tools）
    const response = await callLLMWithTools(messages, round === 1, signal);

    if (!response) {
      onEvent({ type: 'error', data: { message: '模型调用失败' } });
      return '抱歉，我暂时无法回答。请稍后再试。';
    }

    const choice = response.choices[0];
    const assistantMessage = choice.message;

    // 把 assistant 回复加入消息历史
    messages.push({
      role: 'assistant',
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls?.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: tc.function,
      })),
    });

    // 如果没有 tool_calls，说明 Agent 决定直接回答
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      finalContent = assistantMessage.content || '';

      // 流式推送最终回答
      onEvent({
        type: 'content_done',
        data: { content: finalContent },
      });
      break;
    }

    // 执行 tool calls
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs: Record<string, unknown> = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch { /* */ }

      // 通知前端：正在调用工具
      onEvent({
        type: 'tool_start',
        data: {
          toolName,
          toolArgs,
          description: getToolDescription(toolName, toolArgs),
        },
      });

      // 执行工具
      const result = await executeTool(toolName, toolArgs, workspaceId);

      // 通知前端：工具返回结果
      onEvent({
        type: 'tool_result',
        data: {
          toolName,
          resultPreview: result.slice(0, 200) + (result.length > 200 ? '...' : ''),
        },
      });

      // 把 tool 结果加入消息历史
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: toolCall.id,
        name: toolName,
      });
    }
  }

  if (!finalContent && round >= MAX_TOOL_ROUNDS) {
    finalContent = '我查看了你的学习记录，但需要更多信息才能回答这个问题。你能说得更具体一些吗？';
    onEvent({ type: 'content_done', data: { content: finalContent } });
  }

  return finalContent;
}

// ── LLM 调用（OpenAI 兼容，带 function calling）──

async function callLLMWithTools(
  messages: ChatMessage[],
  isFirstRound: boolean,
  signal?: AbortSignal,
): Promise<ChatCompletionResponse | null> {
  if (!DASHSCOPE_API_KEY) {
    log.error('DASHSCOPE_API_KEY not configured');
    return null;
  }

  try {
    const body: Record<string, unknown> = {
      model: AGENT_MODEL,
      messages,
      tools: TUTOR_AGENT_TOOLS,
      tool_choice: 'auto',
      temperature: 0.4, // Agent 模式偏低温度，更确定性
      max_tokens: 4000,
      enable_thinking: false,
    };

    const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const error = await response.text();
      log.error(`LLM error: ${response.status} - ${error}`);
      return null;
    }

    return await response.json() as ChatCompletionResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null;
    }
    log.error('LLM call failed:', error);
    return null;
  }
}

// ── 辅助函数 ──

function getToolDescription(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'list_subjects':
      return '查看学过哪些科目';
    case 'list_captures':
      return `查看「${args.subject || ''}」的课堂记录`;
    case 'get_personal_context':
      return '查看这节课的学习痕迹';
    case 'read_transcript':
      return '阅读课堂转录';
    default:
      return toolName;
  }
}
