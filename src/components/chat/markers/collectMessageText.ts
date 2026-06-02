/**
 * collectMessageText —— AI SDK v6 UIMessage 取文本。
 *
 * UIMessage.parts 是异构数组（text / tool / reasoning / ...），
 * 我们只关心 text part 拼接。tool / reasoning 等由 ChatBubble 的 renderer 单独消费。
 */

export interface MessageLike {
  /** AI SDK v6 是 Array<...>；老格式 / 兜底接受 unknown 让 caller 不需要 cast */
  parts?: unknown;
  content?: string;
}

export function collectMessageText(message: MessageLike): string {
  const parts = Array.isArray(message.parts)
    ? (message.parts as Array<{ type?: string; text?: string }>)
    : [];
  const fromParts = parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('');
  if (fromParts.trim()) return fromParts;
  return typeof message.content === 'string' ? message.content : '';
}
