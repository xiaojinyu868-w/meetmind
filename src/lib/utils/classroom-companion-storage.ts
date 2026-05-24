const COMPANION_MESSAGES_KEY_PREFIX = 'classroom_companion_messages';

export function getCompanionMessagesPreferenceKey(sessionId?: string | null): string {
  const normalized = sessionId?.trim() || 'anon';
  return `${COMPANION_MESSAGES_KEY_PREFIX}:${normalized}`;
}
