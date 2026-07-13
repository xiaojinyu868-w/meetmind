'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { conversationService } from '@/lib/services/conversation-service';

type AskDepth = 'quick' | 'deep';

interface UseGlobalAskHistoryOptions {
  open: boolean;
  userId: string;
  depth: AskDepth;
  busy: boolean;
  messages: UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  getMessageText: (message: UIMessage) => string;
  fallbackTitle: string;
  onDepthRestored: (depth: AskDepth) => void;
  onAssistantPersisted: (input: { text: string; sourceId: string; depth: AskDepth }) => Promise<void> | void;
}

function toUIMessage(message: { messageId: string; role: string; content: string }): UIMessage {
  return {
    id: message.messageId,
    role: message.role === 'user' ? 'user' : 'assistant',
    parts: [{ type: 'text', text: message.content }],
  } as UIMessage;
}

export function useGlobalAskHistory({
  open,
  userId,
  depth,
  busy,
  messages,
  setMessages,
  getMessageText,
  fallbackTitle,
  onDepthRestored,
  onAssistantPersisted,
}: UseGlobalAskHistoryOptions) {
  const [hydrated, setHydrated] = useState(false);
  const [restoredTitle, setRestoredTitle] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const persistedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setHydrated(false);
    setRestoredTitle(null);
    setConversationId(null);
    conversationIdRef.current = null;
    persistedIdsRef.current = new Set();
    setMessages([]);

    const hydrate = async () => {
      try {
        const conversations = await conversationService.listConversations(userId, {
          type: 'global-chat',
          limit: 20,
        });
        const target = conversations.find((item) => item.metadata?.scope === 'global-ask');
        if (!target || !alive) return;
        const history = await conversationService.getMessages(target.conversationId);
        if (!alive) return;
        const restoredDepth = target.metadata?.depth === 'deep' ? 'deep' : 'quick';
        conversationIdRef.current = target.conversationId;
        persistedIdsRef.current = new Set(history.map((message) => message.messageId));
        setConversationId(target.conversationId);
        setRestoredTitle(target.title);
        onDepthRestored(restoredDepth);
        setMessages(history.map(toUIMessage));
      } catch (error) {
        console.error('[useGlobalAskHistory] failed to restore history', error);
      } finally {
        if (alive) setHydrated(true);
      }
    };
    void hydrate();
    return () => { alive = false; };
  }, [onDepthRestored, open, setMessages, userId]);

  useEffect(() => {
    if (!open || !hydrated || busy) return;
    const persist = async () => {
      const unsaved = messages.filter((message) => (
        (message.role === 'user' || message.role === 'assistant')
        && !persistedIdsRef.current.has(message.id)
        && getMessageText(message).trim()
      ));
      if (unsaved.length === 0) return;
      try {
        if (!conversationIdRef.current) {
          const firstUser = unsaved.find((message) => message.role === 'user');
          const title = conversationService.generateTitleFromMessage(
            firstUser ? getMessageText(firstUser) : fallbackTitle,
          );
          const created = await conversationService.createConversation({
            userId,
            type: 'global-chat',
            title,
            sessionId: 'global-ask',
            model: 'tutor-agent',
            metadata: { scope: 'global-ask', depth },
          });
          conversationIdRef.current = created.conversationId;
          setConversationId(created.conversationId);
          setRestoredTitle(created.title);
        }
        const currentConversationId = conversationIdRef.current;
        await conversationService.addMessages(currentConversationId, unsaved.map((message) => ({
          role: message.role === 'user' ? 'user' : 'assistant',
          content: getMessageText(message),
        })));
        unsaved.forEach((message) => persistedIdsRef.current.add(message.id));
        const latestAssistant = [...unsaved].reverse().find((message) => message.role === 'assistant');
        if (latestAssistant) {
          await onAssistantPersisted({
            text: getMessageText(latestAssistant),
            sourceId: `global-ask:${currentConversationId}:${latestAssistant.id}`,
            depth,
          });
        }
      } catch (error) {
        console.error('[useGlobalAskHistory] failed to persist history', error);
      }
    };
    void persist();
  }, [busy, depth, fallbackTitle, getMessageText, hydrated, messages, onAssistantPersisted, open, userId]);

  const reset = useCallback(() => {
    conversationIdRef.current = null;
    persistedIdsRef.current = new Set();
    setConversationId(null);
    setRestoredTitle(null);
    setMessages([]);
  }, [setMessages]);

  return { hydrated, restoredTitle, conversationId, reset };
}
