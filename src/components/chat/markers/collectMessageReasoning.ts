/**
 * collectMessageReasoning — 从 UIMessage.parts 提取思维链文本。
 *
 * DeepSeek V4 思考模式的 reasoning_content 经 @ai-sdk/deepseek 解析为
 * reasoning parts 流到前端；与正文（text parts）分开存放，
 * 由 ChatReasoningBlock 单独渲染。
 */
export function collectMessageReasoning(message: unknown): string {
  const parts = (message as { parts?: unknown })?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part)
        && typeof part === 'object'
        && (part as { type?: string }).type === 'reasoning'
        && typeof (part as { text?: string }).text === 'string',
    )
    .map((part) => part.text)
    .join('');
}
