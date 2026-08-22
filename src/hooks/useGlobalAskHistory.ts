'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import { conversationService } from '@/lib/services/conversation-service';
import type { ConversationHistory, ConversationMessage } from '@/types/conversation';

type AskDepth = 'quick' | 'deep';

interface UseGlobalAskHistoryOptions {
  open: boolean;
  /** auth 初始化完成（isCheckingAuth=false）前为 false：避免以 anonymous 身份读写后再被真实 userId 覆盖 */
  authReady: boolean;
  userId: string;
  depth: AskDepth;
  busy: boolean;
  messages: UIMessage[];
  setMessages: (messages: UIMessage[]) => void;
  getMessageText: (message: UIMessage) => string;
  fallbackTitle: string;
  onDepthRestored: (depth: AskDepth) => void;
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
  authReady,
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
  const persistingIdsRef = useRef<Set<string>>(new Set());
  // 恢复是异步的；期间用户可能已经开始新对话，落盘前必须基于最新消息列表判断，不能覆盖
  const messagesRef = useRef<UIMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!open || !authReady) return;
    let alive = true;
    // 组件保持挂载、对话仍在继续（重新打开或 auth 就绪后重跑）：
    // 不重置、不覆盖，沿用现有 refs 继续增量持久化
    if (messagesRef.current.length > 0) {
      setHydrated(true);
      return () => { alive = false; };
    }
    setHydrated(false);
    setRestoredTitle(null);
    setConversationId(null);
    conversationIdRef.current = null;
    persistedIdsRef.current = new Set();
    persistingIdsRef.current = new Set();
    setMessages([]);

    const hydrate = async () => {
      try {
        // 跳过空壳对话（创建后消息未落库的残留），回退到最近一条有内容的，
        // 否则会出现"已接回上次对话"标题 + 空态欢迎页的死局
        const findScopedWithMessages = async (
          ownerId: string,
        ): Promise<{ target: ConversationHistory; history: ConversationMessage[] } | null> => {
          const conversations = await conversationService.listConversations(ownerId, {
            type: 'global-chat',
            // 窗口内混着课堂复习对话（无 scope），留足余量避免问同学对话被挤出去
            limit: 50,
          });
          const scoped = conversations.filter((item) => item.metadata?.scope === 'global-ask');
          for (const candidate of scoped) {
            const candidateMessages = await conversationService.getMessages(candidate.conversationId);
            if (candidateMessages.length > 0) {
              return { target: candidate, history: candidateMessages };
            }
          }
          return null;
        };

        let found = await findScopedWithMessages(userId);
        // 旧版 auth 竞态可能把对话落到了 anonymous 名下：登录态找不到时回退捞取，
        // 并把归属迁移到当前用户，之后照常恢复/增量持久化
        if (!found && userId !== 'anonymous') {
          const orphan = await findScopedWithMessages('anonymous');
          if (orphan) {
            await conversationService.claimConversation(orphan.target.conversationId, userId);
            found = orphan;
          }
        }
        if (!found || !alive) return;
        const { target, history } = found;
        // 读取期间用户已经开始新对话：不覆盖，等 persist 把它存成新对话
        if (messagesRef.current.length > 0) return;
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
  }, [authReady, onDepthRestored, open, setMessages, userId]);

  useEffect(() => {
    if (!open || !authReady || !hydrated || busy) return;
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
          conversationIdRef.current = created.conversationId;
          setConversationId(created.conversationId);
          // 注意：这里不 setRestoredTitle——restoredTitle 只用于"真实恢复的历史对话"，
          // 新建对话也设置会让标题栏误显示"已接回上次对话"
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
        console.error('[useGlobalAskHistory] failed to persist history', error);
      } finally {
        unsaved.forEach((message) => persistingIdsRef.current.delete(message.id));
      }
    };
    void persist();
  }, [authReady, busy, depth, fallbackTitle, getMessageText, hydrated, messages, onAssistantPersisted, open, userId]);

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
