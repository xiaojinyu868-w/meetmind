/**
 * fetchUIMessageStream — 薄的 AI SDK v6 UIMessageStream 解析器
 *
 * 为什么存在：
 *   useClassroomCompanion 有一整套自管的 messages 列表（持久化到 preferences、
 *   自动注入 AUTO_LISTENING_MSG、inline app 气泡、停止录音的 ceremony……）
 *   用 Vercel AI SDK v6 的 `useChat` 会扯进来一堆它自己的 state 管理，和
 *   classroom 的 messages 模型不匹配。
 *
 *   我们需要的仅仅是：POST /api/tutor/agent → 读 UIMessage stream 帧 →
 *   把 text-delta 累加成最终 content 文本，让 hook 用它自己的 messages 去 commit。
 *
 *   这个工具只做这一件事——薄到一目了然。tool-call 帧目前对 classroom 同桌
 *   不是必要能力（inline app 靠 `<open_app:KEY/>` marker），但为未来扩展留了
 *   onToolCall / onToolResult 钩子。
 *
 * UIMessage chunk 类型见 `node_modules/ai/dist/index.d.ts:1766-1882`。
 * 我们关心的：
 *   - `text-start / text-delta / text-end` → 累加 content
 *   - `error` → 抛出
 *   - `tool-*` → 透给回调（classroom 目前不用）
 *   - `finish` / `start` / `start-step` → 当前不消费
 */

export interface UIMessageStreamReaderOptions {
  /** 每次累加 text-delta 时触发（chunk = 单次增量，fullText = 累积） */
  onTextDelta?: (chunk: string, fullText: string) => void;
  /** 流开始的 text-start 帧。用于"模型开始说话了" UI 切换。 */
  onTextStart?: () => void;
  /** tool-call 元数据流完成时（当前 classroom 不消费） */
  onToolCall?: (info: { toolName: string; toolCallId: string; input: unknown }) => void;
  /** tool 执行完毕产出 payload（当前 classroom 不消费） */
  onToolResult?: (info: { toolCallId: string; output: unknown }) => void;
  /** 流完成 */
  onFinish?: (info: { finishReason?: string }) => void;
}

export interface UIMessageStreamResult {
  /** 所有 text-delta 累加得到的完整文本 */
  text: string;
  /** 是否因用户 abort 而结束（而不是自然结束） */
  aborted: boolean;
}

/**
 * POST 到一个返回 UIMessage stream 的 endpoint，流式读取并把 text-delta 累加成
 * 完整文本。调用方自己决定怎么把这段文本变成一条 CompanionMessage。
 *
 * 出错时 throw；用户 abort 时 result.aborted=true 返回（text 是部分文本）。
 *
 * @param url — 目标 endpoint（例：`/api/tutor/agent`）
 * @param body — POST body JSON
 * @param options — reader callbacks + abort signal
 */
export async function fetchUIMessageStream(
  url: string,
  body: Record<string, unknown>,
  options: UIMessageStreamReaderOptions & {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<UIMessageStreamResult> {
  const { headers = {}, signal, onTextDelta, onTextStart, onToolCall, onToolResult, onFinish } = options;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const retryAfterRaw = response.headers.get('Retry-After');
    const retryAfterSec = retryAfterRaw ? parseInt(retryAfterRaw, 10) : NaN;
    const retryHint =
      response.status === 429 && Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? `，约 ${retryAfterSec} 秒后再试`
        : '';
    const msg =
      (errorBody as { error?: string }).error ||
      `请求失败: ${response.status}`;
    throw new Error(`${msg}${retryHint}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let textStarted = false;
  // 收集 tool input 片段
  const toolInputAccumulators = new Map<string, { toolName: string; input: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 帧以 \n\n 分隔；AI SDK v6 每帧是 `data: <json>\n\n`
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const line = frame.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          // 不完整 JSON（可能跨 read 边界）——塞回 buffer 等下次
          buffer = frame + '\n\n' + buffer;
          continue;
        }

        const type = chunk.type as string | undefined;
        if (!type) continue;

        switch (type) {
          case 'text-start': {
            if (!textStarted) {
              textStarted = true;
              onTextStart?.();
            }
            break;
          }
          case 'text-delta': {
            const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
            if (delta) {
              fullText += delta;
              onTextDelta?.(delta, fullText);
            }
            break;
          }
          case 'text-end':
            // 一段 text 结束，不需要额外动作
            break;
          case 'tool-input-start': {
            const toolCallId = String(chunk.toolCallId ?? '');
            const toolName = String(chunk.toolName ?? '');
            if (toolCallId) {
              toolInputAccumulators.set(toolCallId, { toolName, input: '' });
            }
            break;
          }
          case 'tool-input-delta': {
            const toolCallId = String(chunk.toolCallId ?? '');
            const delta = String(chunk.inputTextDelta ?? '');
            const acc = toolInputAccumulators.get(toolCallId);
            if (acc) acc.input += delta;
            break;
          }
          case 'tool-input-available': {
            const toolCallId = String(chunk.toolCallId ?? '');
            const toolName = String(chunk.toolName ?? '');
            const input = chunk.input;
            onToolCall?.({ toolCallId, toolName, input });
            toolInputAccumulators.delete(toolCallId);
            break;
          }
          case 'tool-output-available': {
            const toolCallId = String(chunk.toolCallId ?? '');
            onToolResult?.({ toolCallId, output: chunk.output });
            break;
          }
          case 'error': {
            const errText = String(chunk.errorText ?? '服务端错误');
            throw new Error(errText);
          }
          case 'finish': {
            const finishReason = typeof chunk.finishReason === 'string' ? chunk.finishReason : undefined;
            onFinish?.({ finishReason });
            break;
          }
          // start / start-step / finish-step / message-metadata / source-* / file：
          // 当前 classroom 同桌不消费，静默跳过。
          default:
            break;
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || signal?.aborted)) {
      return { text: fullText, aborted: true };
    }
    throw err;
  }

  return { text: fullText, aborted: false };
}
