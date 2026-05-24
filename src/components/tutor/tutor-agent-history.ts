import type { UIMessage } from 'ai';

export function conversationMessageToUIMessage(message: { messageId: string; role: string; content: string }): UIMessage {
  return {
    id: message.messageId,
    role: message.role === 'user' ? 'user' : 'assistant',
    parts: [{ type: 'text', text: message.content }],
  } as UIMessage;
}

export function resolveTutorAgentHistoryLabel(input: {
  hydrated: boolean;
  title?: string | null;
  selected?: boolean;
}): string {
  if (!input.hydrated) return '正在接回上一轮对话…';
  if (input.title?.trim()) {
    return input.selected ? `正在查看：${input.title}` : `已接回：${input.title}`;
  }
  return '新对话';
}
