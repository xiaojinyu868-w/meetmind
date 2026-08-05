'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { useAccountConversationSync } from '@/hooks/useAccountConversationSync';
import { useAuth } from '@/lib/hooks/useAuth';
import { createLogger } from '@/lib/logger';
import { syncAccountConversationsNow } from '@/lib/services/account-conversation-sync-client';
import { conversationService } from '@/lib/services/conversation-service';
import {
  mergeRestoredAndLiveMessages,
  selectPreferredConversation,
} from '@/lib/tutor/conversation-window';

const logger = createLogger('global-ask-history');

type AskDepth = 'quick' | 'deep';

interface UseGlobalAskHistoryOptions {
  open: boolean;
  userId: string;
  /** 首次打开时优先恢复仍在继续的学习线索，而不是盲选最新问答。 */
  preferredConversationId?: string;
  depth: AskDepth;
  busy: boolean;
  messages: UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  getMessageText: (message: UIMessage) => string;
  fallbackTitle: string;
  onDepthRestored: (depth: AskDepth) => void;
  onConversationReady?: (conversationId: string) => Promise<void> | void;
  onAssistantPersisted: (input: {
    text: string;
    userText: string;
    sourceId: string;
    depth: AskDepth;
  }) => Promise<void> | void;
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
  preferredConversationId,
  depth,
  busy,
  messages,
  setMessages,
  getMessageText,
  fallbackTitle,
  onDepthRestored,
  onConversationReady,
  onAssistantPersisted,
}: UseGlobalAskHistoryOptions) {
  const { accessToken } = useAuth();
  useAccountConversationSync(accessToken, userId);
  const [hydrated, setHydrated] = useState(false);
  const [restoredTitle, setRestoredTitle] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const persistedIdsRef = useRef<Set<string>>(new Set());
  const persistingIdsRef = useRef<Set<string>>(new Set());
  const liveMessagesRef = useRef(messages);
  const preferredConversationIdRef = useRef(preferredConversationId);
  const wasOpenRef = useRef(false);
  useEffect(() => { liveMessagesRef.current = messages; }, [messages]);
  useEffect(() => {
    // While the panel is open, keep selection stable. A newly created
    // conversation is linked to the thread without restarting live chat.
    if (open && !wasOpenRef.current) {
      preferredConversationIdRef.current = preferredConversationId;
    }
    wasOpenRef.current = open;
  }, [open, preferredConversationId]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setHydrated(false);
    setRestoredTitle(null);
    setConversationId(null);
    conversationIdRef.current = null;
    persistedIdsRef.current = new Set();
    persistingIdsRef.current = new Set();
    liveMessagesRef.current = [];
    setMessages([]);

    const hydrate = async () => {
      try {
        await syncAccountConversationsNow(
          accessToken,
          userId,
          preferredConversationIdRef.current,
        );
        const preferredId = preferredConversationIdRef.current;
        const preferredConversation = preferredId
          ? await conversationService.getConversation(preferredId)
          : null;
        const recentConversations = await conversationService.listConversations(userId, {
          type: 'global-chat',
          sessionId: 'global-ask',
          limit: 20,
        });
        const conversations = preferredConversation
          ? [
              preferredConversation,
              ...recentConversations.filter((conversation) => (
                conversation.conversationId !== preferredConversation.conversationId
              )),
            ]
          : recentConversations;
        const target = selectPreferredConversation(
          conversations,
          preferredId,
          (conversation) => (
            conversation.userId === userId
            && conversation.type === 'global-chat'
            && conversation.sessionId === 'global-ask'
          ),
        );
        if (!target || !alive) return;
        void onConversationReady?.(target.conversationId);
        const history = await conversationService.getMessages(target.conversationId);
        if (!alive) return;
        const restoredDepth = target.metadata?.depth === 'deep' ? 'deep' : 'quick';
        conversationIdRef.current = target.conversationId;
        persistedIdsRef.current = new Set(history.map((message) => message.messageId));
        setConversationId(target.conversationId);
        setRestoredTitle(target.title);
        onDepthRestored(restoredDepth);
        const restoredMessages = history.map(toUIMessage);
        const liveMessages = liveMessagesRef.current;
        // IndexedDB 恢复不能覆盖用户刚刚提交的乐观消息。聊天面板打开后立即可用，
        // 历史稍后无缝接到前面，而不是用“正在恢复”锁住输入框。
        setMessages(mergeRestoredAndLiveMessages(restoredMessages, liveMessages));
      } catch (error) {
        logger.error('restore.failed', { error: String(error) });
      } finally {
        if (alive) setHydrated(true);
      }
    };
    void hydrate();
    return () => { alive = false; };
  }, [accessToken, onConversationReady, onDepthRestored, open, setMessages, userId]);

  useEffect(() => {
    if (!open || !hydrated || busy) return;
    const persist = async () => {
      const unsaved = messages.filter((message) => (
        (message.role === 'user' || message.role === 'assistant')
        && !persistedIdsRef.current.has(message.id)
        && !persistingIdsRef.current.has(message.id)
        && getMessageText(message).trim()
      ));
      if (unsaved.length === 0) return;
      unsaved.forEach((message) => persistingIdsRef.current.add(message.id));
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
          void onConversationReady?.(created.conversationId);
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
          const latestUser = [...messages].reverse().find((message) => (
            message.role === 'user' && getMessageText(message).trim()
          ));
          await onAssistantPersisted({
            text: getMessageText(latestAssistant),
            userText: latestUser ? getMessageText(latestUser) : '',
            sourceId: `global-ask:${currentConversationId}:${latestAssistant.id}`,
            depth,
          });
        }
      } catch (error) {
        unsaved.forEach((message) => persistingIdsRef.current.delete(message.id));
        logger.error('persist.failed', { error: String(error) });
      } finally {
        unsaved.forEach((message) => persistingIdsRef.current.delete(message.id));
      }
    };
    void persist();
  }, [busy, depth, fallbackTitle, getMessageText, hydrated, messages, onAssistantPersisted, onConversationReady, open, userId]);

  const reset = useCallback(() => {
    conversationIdRef.current = null;
    persistedIdsRef.current = new Set();
    persistingIdsRef.current = new Set();
    setConversationId(null);
    setRestoredTitle(null);
    setMessages([]);
  }, [setMessages]);

  return { hydrated, restoredTitle, conversationId, reset };
}
