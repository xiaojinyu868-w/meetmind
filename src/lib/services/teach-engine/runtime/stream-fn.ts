/**
 * LLM 缝：pi StreamFn → AI SDK v6 streamText。
 *
 * 模式来自 OpenMAIC lib/agent/runtime/stream-fn.ts（OpenMAIC 已验证），
 * 这里做薄版：去掉 provider-metadata / thinkingConfig / streamLLM 间接层，
 * 直接 streamText + stepCountIs(1)（pi loop 拥有多步，每次调用只跑一次 LLM）。
 *
 * 关键点：
 * - tools 不带 execute 传给 AI SDK（模型只"发出"工具调用，pi loop 负责执行）
 * - kimi-k3 的 reasoning 需要回传（includeReasoning），否则后续轮丢思考链
 * - usage 从 AI SDK finish part 映射回 pi AssistantMessage.usage
 */
import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context as PiContext,
  Message as PiMessage,
  TextContent,
  ThinkingContent,
  Tool as PiTool,
  SimpleStreamOptions,
  Usage as PiUsage,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  jsonSchema,
  stepCountIs,
  tool as aiTool,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type ToolSet,
} from 'ai';

const EMPTY_USAGE: PiUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** pi 导出的是 event stream 类型而非工厂；本地复刻最小队列实现（同 OpenMAIC 的做法）。 */
class LocalAssistantEventStream {
  private queue: AssistantMessageEvent[] = [];
  private waiting: Array<(r: IteratorResult<AssistantMessageEvent>) => void> = [];
  private finished = false;
  private resolveFinal!: (m: AssistantMessage) => void;
  private finalPromise: Promise<AssistantMessage>;

  constructor() {
    this.finalPromise = new Promise((resolve) => {
      this.resolveFinal = resolve;
    });
  }

  push(event: AssistantMessageEvent): void {
    if (this.finished) return;
    if (event.type === 'done') {
      this.finished = true;
      this.resolveFinal(event.message);
    } else if (event.type === 'error') {
      this.finished = true;
      this.resolveFinal(event.error);
    }
    const waiter = this.waiting.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.queue.push(event);
  }

  /** pi loop 依赖的终态消息 promise。 */
  result(): Promise<AssistantMessage> {
    return this.finalPromise;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    for (;;) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.finished) {
        return;
      } else {
        const r = await new Promise<IteratorResult<AssistantMessageEvent>>((resolve) =>
          this.waiting.push(resolve),
        );
        if (r.done) return;
        yield r.value;
      }
    }
  }
}

export interface AiSdkStreamFnOptions {
  languageModel: LanguageModel;
  /** kimi-k3 需要把 reasoning 回传到后续轮 */
  includeReasoning?: boolean;
  maxOutputTokens?: number;
  /** 透传给 streamText 的 providerOptions（如 openai.reasoningEffort；
   *  对齐 teach.config provider.upstreamParams 的 reasoning_effort=low 语义） */
  providerOptions?: Record<string, Record<string, unknown>>;
}

export function createAiSdkStreamFn(opts: AiSdkStreamFnOptions): StreamFn {
  return ((_piModel, context: PiContext, streamOptions?: SimpleStreamOptions) => {
    const stream = new LocalAssistantEventStream();
    void pump(stream, context, opts, streamOptions).catch((err) => fail(stream, err));
    return stream as unknown as AssistantMessageEventStream;
  }) as StreamFn;
}

function fail(stream: LocalAssistantEventStream, error: unknown): void {
  const message: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: 'unknown' as AssistantMessage['api'],
    provider: 'unknown' as AssistantMessage['provider'],
    model: 'ai-sdk-bridge',
    usage: { ...EMPTY_USAGE },
    stopReason: 'error',
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now(),
  };
  stream.push({ type: 'start', partial: message });
  stream.push({ type: 'error', reason: 'error', error: message });
}

async function pump(
  stream: LocalAssistantEventStream,
  context: PiContext,
  opts: AiSdkStreamFnOptions,
  streamOptions?: SimpleStreamOptions,
): Promise<void> {
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: 'unknown' as AssistantMessage['api'],
    provider: 'unknown' as AssistantMessage['provider'],
    model: 'ai-sdk-bridge',
    usage: { ...EMPTY_USAGE },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  stream.push({ type: 'start', partial });

  let active: { kind: 'text' | 'thinking'; index: number; buf: string } | null = null;
  const closeActive = () => {
    if (!active) return;
    if (active.kind === 'text') {
      stream.push({ type: 'text_end', contentIndex: active.index, content: active.buf, partial });
    } else {
      stream.push({
        type: 'thinking_end',
        contentIndex: active.index,
        content: active.buf,
        partial,
      });
    }
    active = null;
  };

  const finish = (reason: AssistantMessage['stopReason'], totalUsage?: LanguageModelUsage) => {
    closeActive();
    if (totalUsage) {
      const cacheRead = totalUsage.cachedInputTokens ?? 0;
      const input = totalUsage.inputTokens ?? 0;
      const output = totalUsage.outputTokens ?? 0;
      const uncached = Math.max(0, input - cacheRead);
      partial.usage = {
        input: uncached,
        output,
        cacheRead,
        cacheWrite: 0,
        totalTokens: uncached + output + cacheRead,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      };
    }
    partial.stopReason = reason;
    const hasToolCall = partial.content.some((c) => c.type === 'toolCall');
    stream.push({
      type: 'done',
      reason: hasToolCall || reason === 'toolUse' ? 'toolUse' : 'stop',
      message: partial,
    });
  };

  try {
    const result = await streamTextInternal({
      languageModel: opts.languageModel,
      system: context.systemPrompt,
      messages: toModelMessages(context.messages ?? [], opts.includeReasoning),
      tools: toAiTools(context.tools ?? []),
      maxOutputTokens: streamOptions?.maxTokens ?? opts.maxOutputTokens,
      abortSignal: streamOptions?.signal,
      providerOptions: opts.providerOptions,
    });

    for await (const part of result.fullStream as AsyncIterable<Record<string, unknown>>) {
      const type = part.type as string;
      if (type === 'finish') {
        finish(
          (part.finishReason as FinishReason) === 'tool-calls' ? 'toolUse' : 'stop',
          part.totalUsage as LanguageModelUsage | undefined,
        );
        return;
      }
      if (type === 'error') {
        throw (part.error as Error) ?? new Error('LLM stream error');
      }
      if (type === 'text-delta') {
        const delta = (part.text ?? '') as string;
        if (!delta) continue;
        if (active?.kind !== 'text') {
          closeActive();
          const index = partial.content.length;
          partial.content.push({ type: 'text', text: '' } satisfies TextContent);
          active = { kind: 'text', index, buf: '' };
          stream.push({ type: 'text_start', contentIndex: index, partial });
        }
        active.buf += delta;
        (partial.content[active.index] as TextContent).text = active.buf;
        stream.push({ type: 'text_delta', contentIndex: active.index, delta, partial });
      } else if (type === 'reasoning-delta') {
        const delta = (part.text ?? '') as string;
        if (!delta) continue;
        if (active?.kind !== 'thinking') {
          closeActive();
          const index = partial.content.length;
          partial.content.push({ type: 'thinking', thinking: '' } as ThinkingContent);
          active = { kind: 'thinking', index, buf: '' };
          stream.push({ type: 'thinking_start', contentIndex: index, partial });
        }
        active.buf += delta;
        (partial.content[active.index] as ThinkingContent).thinking = active.buf;
        stream.push({ type: 'thinking_delta', contentIndex: active.index, delta, partial });
      } else if (type === 'reasoning-end') {
        if (active?.kind === 'thinking') closeActive();
      } else if (type === 'tool-call') {
        closeActive();
        const toolCall = {
          type: 'toolCall' as const,
          id: (part.toolCallId ?? '') as string,
          name: (part.toolName ?? '') as string,
          arguments: (part.input ?? {}) as Record<string, unknown>,
        };
        partial.content.push(toolCall);
        const contentIndex = partial.content.length - 1;
        stream.push({ type: 'toolcall_start', contentIndex, partial });
        stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial });
      }
    }
    throw new Error('LLM stream ended without a terminal event');
  } catch (err) {
    fail(stream, err);
  }
}

// 独立小包装，避免顶部 import 与类型纠缠
import { streamText } from 'ai';
interface StreamTextArgs {
  languageModel: LanguageModel;
  system?: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
}
async function streamTextInternal(args: StreamTextArgs) {
  return streamText({
    model: args.languageModel,
    system: args.system,
    messages: args.messages,
    tools: args.tools,
    toolChoice: 'auto',
    stopWhen: stepCountIs(1),
    maxOutputTokens: args.maxOutputTokens,
    abortSignal: args.abortSignal,
    providerOptions: args.providerOptions as Parameters<typeof streamText>[0]['providerOptions'],
  });
}

/** pi Message[] -> AI SDK ModelMessage[]。 */
export function toModelMessages(messages: PiMessage[], includeReasoning = false): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const content =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .map((c) => (c.type === 'text' ? c.text : ''))
              .filter(Boolean)
              .join('\n');
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      for (const c of m.content) {
        if (c.type === 'text') parts.push({ type: 'text', text: c.text });
        else if (c.type === 'thinking' && includeReasoning) {
          parts.push({ type: 'reasoning', text: c.thinking });
        } else if (c.type === 'toolCall') {
          parts.push({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: c.arguments });
        }
      }
      out.push({ role: 'assistant', content: parts } as unknown as ModelMessage);
    } else if (m.role === 'toolResult') {
      const text = m.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      out.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: m.toolCallId,
            toolName: m.toolName,
            output: { type: m.isError ? 'error-text' : 'text', value: text },
          },
        ],
      } as unknown as ModelMessage);
    }
  }
  return out;
}

/** pi tools -> AI SDK ToolSet（无 execute，模型只发调用）。 */
function toAiTools(tools: PiTool[]): ToolSet {
  const set: ToolSet = {};
  for (const t of tools) {
    set[t.name] = aiTool({
      description: t.description,
      inputSchema: jsonSchema((t as unknown as { parameters: object }).parameters),
    });
  }
  return set;
}
