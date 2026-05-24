import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import {
  buildRealtimeConversationTitle,
  createRealtimeTranscriptDedupe,
  type RealtimeTranscriptRole,
} from '@/lib/tutor/realtime-conversation-bridge';

interface UseRealtimeTutorConversationBridgeOptions {
  sessionId: string;
  modelId: string;
  onRealtimeConversationSaved?: (conversationId: string) => void;
  onConversationActiveChange?: (hasMessages: boolean) => void;
}

export function useRealtimeTutorConversationBridge({
  sessionId,
  modelId,
  onRealtimeConversationSaved,
  onConversationActiveChange,
}: UseRealtimeTutorConversationBridgeOptions) {
  const { user } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  const [assistantDraft, setAssistantDraft] = useState('');
  const assistantDraftRef = useRef('');
  const assistantFinalizedRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const conversationPromiseRef = useRef<Promise<string> | null>(null);
  const transcriptDedupeRef = useRef(createRealtimeTranscriptDedupe());

  useEffect(() => {
    conversationIdRef.current = null;
    conversationPromiseRef.current = null;
    transcriptDedupeRef.current.reset();
  }, [sessionId]);

  useEffect(() => {
    assistantDraftRef.current = assistantDraft;
  }, [assistantDraft]);

  const ensureConversation = useCallback((seedText: string): Promise<string> => {
    if (conversationIdRef.current) {
      return Promise.resolve(conversationIdRef.current);
    }

    if (!conversationPromiseRef.current) {
      conversationPromiseRef.current = conversationService.createConversation({
        userId,
        type: 'global-chat',
        title: buildRealtimeConversationTitle(seedText),
        sessionId,
        model: modelId,
        metadata: { source: 'realtime-call' },
      }).then((conversation) => {
        conversationIdRef.current = conversation.conversationId;
        onRealtimeConversationSaved?.(conversation.conversationId);
        return conversation.conversationId;
      }).finally(() => {
        conversationPromiseRef.current = null;
      });
    }

    return conversationPromiseRef.current;
  }, [modelId, onRealtimeConversationSaved, sessionId, userId]);

  const appendTranscript = useCallback(async (role: RealtimeTranscriptRole, text: string) => {
    const trimmed = text.trim();
    if (!transcriptDedupeRef.current.shouldAccept(role, trimmed)) return;

    onConversationActiveChange?.(true);

    try {
      const conversationId = await ensureConversation(trimmed);
      await conversationService.addMessage(conversationId, { role, content: trimmed });
    } catch (err) {
      console.error('[useRealtimeTutorConversationBridge] failed to persist realtime transcript:', err);
    }
  }, [ensureConversation, onConversationActiveChange]);

  const handleUserTranscript = useCallback((text: string) => {
    void appendTranscript('user', text);
  }, [appendTranscript]);

  const handleAssistantStart = useCallback(() => {
    assistantFinalizedRef.current = false;
    setAssistantDraft('');
  }, []);

  const handleAssistantChange = useCallback((text: string) => {
    setAssistantDraft(text);
  }, []);

  const handleAssistantDone = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (assistantFinalizedRef.current) return;

    assistantFinalizedRef.current = true;
    void appendTranscript('assistant', trimmed);
    setAssistantDraft('');
  }, [appendTranscript]);

  const handleAssistantEnd = useCallback(() => {
    if (!assistantFinalizedRef.current) {
      const fallbackText = assistantDraftRef.current.trim();
      if (fallbackText) {
        assistantFinalizedRef.current = true;
        void appendTranscript('assistant', fallbackText);
      }
    }

    assistantFinalizedRef.current = false;
    setAssistantDraft('');
  }, [appendTranscript]);

  return {
    handleUserTranscript,
    handleAssistantChange,
    handleAssistantDone,
    handleAssistantStart,
    handleAssistantEnd,
  };
}
