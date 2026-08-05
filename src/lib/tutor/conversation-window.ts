export interface TutorConversationMessageLike {
  role: string;
  content?: unknown;
  parts?: unknown;
}

export interface TutorConversationWindowOptions {
  maxMessages?: number;
  maxSerializedChars?: number;
}

export function selectPreferredConversation<T extends { conversationId: string }>(
  conversations: T[],
  preferredConversationId: string | undefined,
  isEligible: (conversation: T) => boolean,
): T | undefined {
  return conversations.find((conversation) => (
    conversation.conversationId === preferredConversationId
    && isEligible(conversation)
  )) || conversations.find(isEligible);
}

export function mergeRestoredAndLiveMessages<T extends { id: string }>(
  restored: T[],
  live: T[],
): T[] {
  if (live.length === 0) return restored;
  const restoredIds = new Set(restored.map((message) => message.id));
  return [...restored, ...live.filter((message) => !restoredIds.has(message.id))];
}

const DEFAULT_MAX_MESSAGES = 24;
const DEFAULT_MAX_SERIALIZED_CHARS = 32_000;

function estimateSerializedChars(message: TutorConversationMessageLike): number {
  try {
    return JSON.stringify({
      role: message.role,
      content: message.content,
      parts: message.parts,
    }).length;
  } catch {
    return DEFAULT_MAX_SERIALIZED_CHARS;
  }
}

/**
 * Long-term learning state lives in Tutor context, so the model only needs a
 * bounded recent conversation window on every turn. Keep the newest message
 * even when it is large, then retain as many complete recent turns as fit.
 */
export function selectTutorConversationWindow<T extends TutorConversationMessageLike>(
  messages: T[],
  options: TutorConversationWindowOptions = {},
): T[] {
  const maxMessages = Math.max(1, options.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const maxSerializedChars = Math.max(1_000, options.maxSerializedChars ?? DEFAULT_MAX_SERIALIZED_CHARS);
  const selected: T[] = [];
  let serializedChars = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageChars = estimateSerializedChars(message);
    const exceedsBudget = selected.length > 0 && serializedChars + messageChars > maxSerializedChars;
    if (selected.length >= maxMessages || exceedsBudget) break;
    selected.unshift(message);
    serializedChars += messageChars;
  }

  while (selected.length > 1 && selected[0].role === 'assistant') selected.shift();
  return selected;
}
