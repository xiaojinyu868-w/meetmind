/**
 * Responses API → Chat Completions API 协议翻译（纯函数层，零 IO 可单测）。
 *
 * 背景：codex ≥0.98 移除了 chat wire API（只讲 Responses），而我们的上游
 * （commonstack / 百炼兼容模式）都是 chat completions。本模块把 codex 发来的
 * Responses 请求翻译成 chat 请求，把上游 chat SSE chunk 翻译回 Responses 事件。
 * 只做协议翻译，无任何编排逻辑。
 *
 * 已验证的三个真实坑（见 out/codex-spike/REPORT.md §2）：
 * - codex 会发 `developer` role，chat API 只认 system/user/assistant/tool → 映射 system
 * - parallel tool calls 必须聚合成一条 assistant 消息的 tool_calls 数组，
 *   否则上游报 "tool_calls must be followed by tool messages"
 * - codex 0.149 把 MCP 工具包装成 `type:"namespace"` 工具 → 展平为
 *   `mcp__xxx__tool` 普通 function，响应侧按 {name, namespace} 还原
 */

// ---------- 宽松输入类型（协议面，逐字段 narrow，不信任上游） ----------

export interface ResponsesRequest {
  model?: string;
  instructions?: string;
  input?: unknown;
  tools?: unknown[];
  tool_choice?: unknown;
  max_output_tokens?: number | null;
  temperature?: number | null;
  top_p?: number | null;
  stream?: boolean;
}

export interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatRequest {
  model?: string;
  messages: ChatMessage[];
  stream: true;
  stream_options: { include_usage: true };
  tools?: unknown[];
  tool_choice?: unknown;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
}

/** flatName → 还原信息（codex namespace 工具展平后用于响应侧还原） */
export type NsMap = Record<string, { namespace: string; name: string }>;

// ---------- 请求翻译：Responses → Chat ----------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const part of content) {
    const p = asRecord(part);
    if (!p) continue;
    if (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') {
      text += typeof p.text === 'string' ? p.text : '';
    }
  }
  return text;
}

export function translateMessages(req: ResponsesRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (typeof req.instructions === 'string' && req.instructions.length > 0) {
    messages.push({ role: 'system', content: req.instructions });
  }
  const input = Array.isArray(req.input)
    ? req.input
    : typeof req.input === 'string'
      ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: req.input }] }]
      : [];

  // parallel tool calls 聚合成一条 assistant 消息（上游硬性要求）
  const pendingCalls: ChatToolCall[] = [];
  const flushCalls = () => {
    if (pendingCalls.length === 0) return;
    messages.push({ role: 'assistant', content: '', tool_calls: pendingCalls.splice(0) });
  };

  for (const raw of input) {
    const item = asRecord(raw);
    if (!item) continue;
    const type = (item.type as string | undefined) || (item.role ? 'message' : undefined);

    if (type === 'message') {
      flushCalls();
      let role = (item.role as string | undefined) || 'user';
      if (role === 'developer') role = 'system'; // chat API 无 developer role
      const msg: ChatMessage = { role, content: messageText(item.content) };
      if (Array.isArray(item.tool_calls)) {
        msg.tool_calls = item.tool_calls as ChatToolCall[];
      }
      messages.push(msg);
    } else if (type === 'function_call') {
      // 历史 item 带 namespace 字段时拼回 flat 名
      const name = String(item.name ?? '');
      const flatName = item.namespace ? `${item.namespace}__${name}` : name;
      pendingCalls.push({
        id: String(item.call_id || item.id || `call_${pendingCalls.length}`),
        type: 'function',
        function: {
          name: flatName,
          arguments:
            typeof item.arguments === 'string'
              ? item.arguments
              : JSON.stringify(item.arguments ?? {}),
        },
      });
    } else if (type === 'function_call_output') {
      flushCalls();
      messages.push({
        role: 'tool',
        tool_call_id: String(item.call_id || item.id || ''),
        content:
          typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
      });
    }
    // reasoning / 未知 item：忽略（不崩、不转发）
  }
  flushCalls();
  return messages;
}

export function translateTools(tools: unknown[] | undefined): { tools?: unknown[]; nsMap: NsMap } {
  if (!Array.isArray(tools)) return { tools: undefined, nsMap: {} };
  const out: unknown[] = [];
  const nsMap: NsMap = {};
  for (const raw of tools) {
    const t = asRecord(raw);
    if (!t) continue;
    if (t.type === 'function') {
      // responses 格式是扁平 {type:'function', name, ...}；chat 嵌套 {function:{...}}
      if (asRecord(t.function)) {
        out.push(t);
      } else {
        out.push({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        });
      }
    } else if (t.type === 'namespace' && Array.isArray(t.tools)) {
      // chat API 无 namespace 概念：展平为 `mcp__xxx__tool`，响应侧还原
      for (const innerRaw of t.tools) {
        const inner = asRecord(innerRaw);
        if (!inner || inner.type !== 'function') continue;
        const flat = `${t.name}__${inner.name}`;
        nsMap[flat] = { namespace: String(t.name), name: String(inner.name) };
        out.push({
          type: 'function',
          function: { name: flat, description: inner.description, parameters: inner.parameters },
        });
      }
    }
  }
  return { tools: out.length > 0 ? out : undefined, nsMap };
}

export function translateRequest(req: ResponsesRequest): { chat: ChatRequest; nsMap: NsMap } {
  const chat: ChatRequest = {
    model: req.model,
    messages: translateMessages(req),
    stream: true, // 上游恒流式，翻译侧统一走 SSE
    stream_options: { include_usage: true },
  };
  const { tools, nsMap } = translateTools(req.tools);
  if (tools) chat.tools = tools;
  if (req.tool_choice !== undefined) chat.tool_choice = req.tool_choice;
  if (req.max_output_tokens !== undefined && req.max_output_tokens !== null) {
    chat.max_tokens = req.max_output_tokens;
  }
  if (req.temperature !== undefined && req.temperature !== null) chat.temperature = req.temperature;
  if (req.top_p !== undefined && req.top_p !== null) chat.top_p = req.top_p;
  // store / previous_response_id 有意忽略（codex 每轮回放完整历史）
  return { chat, nsMap };
}

// ---------- 响应翻译：Chat SSE chunk → Responses 事件 ----------

export type ResponsesEvent = Record<string, unknown> & { type: string };

interface ToolCallState {
  index: number;
  itemId: string;
  callId: string;
  name: string;
  args: string;
  outputIndex: number;
  closed: boolean;
}

/**
 * 单个 response 的流式状态机。handleChunk 逐片喂入上游 chat chunk，
 * 返回要发给 codex 的 Responses SSE 事件；close() 幂等收尾并给出
 * 最终 response.completed 事件。
 */
export class ResponsesStreamBuilder {
  private responseId = `resp_${crypto.randomUUID()}`;
  private msgId: string | null = null;
  private msgOpen = false;
  private msgText = '';
  private msgOutputIndex = 0;
  private toolCalls = new Map<number, ToolCallState>();
  private outputOrder: string[] = [];
  private outputItems: unknown[] = [];
  private usage: Record<string, unknown> | null = null;

  constructor(
    private model: string,
    private nsMap: NsMap = {},
  ) {}

  createdEvent(): ResponsesEvent {
    return {
      type: 'response.created',
      response: {
        id: this.responseId,
        object: 'response',
        status: 'in_progress',
        model: this.model,
        output: [],
      },
    };
  }

  handleChunk(raw: unknown): ResponsesEvent[] {
    const chunk = asRecord(raw);
    if (!chunk) return [];
    if (asRecord(chunk.usage)) this.usage = asRecord(chunk.usage);
    const choice = Array.isArray(chunk.choices) ? asRecord(chunk.choices[0]) : null;
    if (!choice) return [];
    const delta = asRecord(choice.delta) || {};
    const events: ResponsesEvent[] = [];

    // reasoning_content 整体忽略，只翻译 content
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      events.push(...this.openMessage());
      this.msgText += delta.content;
      events.push({
        type: 'response.output_text.delta',
        item_id: this.msgId,
        output_index: this.msgOutputIndex,
        content_index: 0,
        delta: delta.content,
      });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const partRaw of delta.tool_calls) {
        const part = asRecord(partRaw);
        if (!part) continue;
        const idx = typeof part.index === 'number' ? part.index : 0;
        const fn = asRecord(part.function);
        const isNew = !this.toolCalls.has(idx);
        const tc = this.openToolCall(idx, {
          id: typeof part.id === 'string' ? part.id : undefined,
          name: typeof fn?.name === 'string' ? (fn.name as string) : undefined,
        });
        if (isNew) events.push(this.toolCallAddedEvent(tc));
        if (typeof part.id === 'string') tc.callId = part.id;
        if (typeof fn?.name === 'string') tc.name = fn.name as string;
        if (typeof fn?.arguments === 'string' && (fn.arguments as string).length > 0) {
          tc.args += fn.arguments as string;
          events.push({
            type: 'response.function_call_arguments.delta',
            item_id: tc.itemId,
            output_index: tc.outputIndex,
            delta: fn.arguments,
          });
        }
      }
    }

    if (choice.finish_reason) {
      events.push(...this.closeAll());
    }
    return events;
  }

  /** 幂等收尾：关闭所有未关 item + 产出 response.completed */
  close(): ResponsesEvent[] {
    const events = this.closeAll();
    events.push({ type: 'response.completed', response: this.finalResponse() });
    return events;
  }

  /** 非流式聚合用：最终 response 对象 */
  finalResponse(): Record<string, unknown> {
    return {
      id: this.responseId,
      object: 'response',
      status: 'completed',
      model: this.model,
      output: this.outputItems,
      usage: mapUsage(this.usage),
    };
  }

  private openMessage(): ResponsesEvent[] {
    if (this.msgOpen) return [];
    this.msgId = 'msg_1';
    this.msgOpen = true;
    this.msgOutputIndex = this.outputOrder.length;
    this.outputOrder.push(this.msgId);
    return [
      {
        type: 'response.output_item.added',
        output_index: this.msgOutputIndex,
        item: { id: this.msgId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
      },
      {
        type: 'response.content_part.added',
        item_id: this.msgId,
        output_index: this.msgOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: '' },
      },
    ];
  }

  private closeMessage(): ResponsesEvent[] {
    if (!this.msgOpen) return [];
    this.msgOpen = false;
    const item = {
      id: this.msgId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: this.msgText }],
    };
    this.outputItems.push(item);
    return [
      {
        type: 'response.output_text.done',
        item_id: this.msgId,
        output_index: this.msgOutputIndex,
        content_index: 0,
        text: this.msgText,
      },
      {
        type: 'response.content_part.done',
        item_id: this.msgId,
        output_index: this.msgOutputIndex,
        content_index: 0,
        part: { type: 'output_text', text: this.msgText },
      },
      { type: 'response.output_item.done', output_index: this.msgOutputIndex, item },
    ];
  }

  private openToolCall(
    index: number,
    initial: { id?: string; name?: string },
  ): ToolCallState {
    const existing = this.toolCalls.get(index);
    if (existing) return existing;
    const tc: ToolCallState = {
      index,
      itemId: `fc_${this.toolCalls.size + 1}`,
      callId: initial.id || `call_${crypto.randomUUID()}`,
      name: initial.name || '',
      args: '',
      outputIndex: this.outputOrder.length,
      closed: false,
    };
    this.toolCalls.set(index, tc);
    this.outputOrder.push(tc.itemId);
    return tc;
  }

  private toolCallAddedEvent(tc: ToolCallState): ResponsesEvent {
    const ns = this.nsMap[tc.name];
    return {
      type: 'response.output_item.added',
      output_index: tc.outputIndex,
      item: {
        id: tc.itemId,
        type: 'function_call',
        call_id: tc.callId,
        name: ns ? ns.name : tc.name,
        ...(ns ? { namespace: ns.namespace } : {}),
        arguments: '',
        status: 'in_progress',
      },
    };
  }

  private closeToolCall(tc: ToolCallState): ResponsesEvent[] {
    if (tc.closed) return [];
    tc.closed = true;
    const ns = this.nsMap[tc.name];
    const item = {
      id: tc.itemId,
      type: 'function_call',
      call_id: tc.callId,
      name: ns ? ns.name : tc.name,
      ...(ns ? { namespace: ns.namespace } : {}),
      arguments: tc.args,
      status: 'completed',
    };
    this.outputItems.push(item);
    return [
      {
        type: 'response.function_call_arguments.done',
        item_id: tc.itemId,
        output_index: tc.outputIndex,
        arguments: tc.args,
      },
      { type: 'response.output_item.done', output_index: tc.outputIndex, item },
    ];
  }

  private closeAll(): ResponsesEvent[] {
    const events: ResponsesEvent[] = [];
    events.push(...this.closeMessage());
    for (const tc of [...this.toolCalls.values()].sort((a, b) => a.index - b.index)) {
      events.push(...this.closeToolCall(tc));
    }
    return events;
  }
}

function mapUsage(usage: Record<string, unknown> | null): Record<string, number> {
  if (!usage) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const input = Number(usage.prompt_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? 0);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: Number(usage.total_tokens ?? input + output),
  };
}
