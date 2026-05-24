import type { MessageRole } from '@/types/conversation';

export type RealtimeTranscriptRole = Extract<MessageRole, 'user' | 'assistant'>;

function normalizeTranscriptText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function buildRealtimeConversationTitle(firstText: string): string {
  const normalized = normalizeTranscriptText(firstText);
  if (!normalized) return '语音同桌';
  return `语音同桌：${normalized.slice(0, 24)}`;
}

export function createRealtimeTranscriptDedupe() {
  let lastKey = '';

  return {
    shouldAccept(role: RealtimeTranscriptRole, text: string): boolean {
      const normalized = normalizeTranscriptText(text);
      if (!normalized) return false;
      const key = `${role}:${normalized}`;
      if (key === lastKey) return false;
      lastKey = key;
      return true;
    },
    reset(): void {
      lastKey = '';
    },
  };
}
