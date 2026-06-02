'use client';

/**
 * SharedAgentChat — 分享态对话面板（v3.0 · v7 视觉 · M11 迁底座）
 *
 * 走 /api/tutor/agent，mode='shared' + shareToken。
 * 不读取访问者的本地 conversation 历史（隔离），只在内存里维护当前会话。
 * 不渲染 inline app marker（分享态不允许产物），不注入 [MM:SS] 时间戳（访客没原录音）。
 *
 * M11.5：迁到 ChatBase 底座（薄底座 + 厚适配）：
 *   - ChatBubble paper variant（嵌进 share 落地页 hero card 里要克制）
 *   - ChatComposer paper variant（不开 file/mic/call —— 分享态访客是只读体验）
 *   - 不挂 marker pipeline（分享态没有 intent/goal 块）
 *
 * 隐私铁律：
 *   - 不读访问者 learnerProfile（分享态服务端 prompt 强制 mode==='shared' 不注入）
 *   - 服务端从 SharedAgentSnapshot.snapshotJson 加载分享者上下文
 */

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { COPY } from '@/lib/ui/copy';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import {
  ChatBubble,
  ChatComposer,
  ChatMessageList,
  ChatRenderer,
  ChatThinkingStripBubble,
  collectMessageText,
  useChatComposer,
} from '@/components/chat';

interface SharedAgentChatProps {
  shareToken: string;
  courseTitle: string;
  sharerNickname: string;
  /** 用户登录时的 access token —— 用来在 chat 埋点里带上 visitorUserId（可选） */
  authToken?: string;
}

export function SharedAgentChat({
  shareToken,
  courseTitle,
  sharerNickname,
  authToken,
}: SharedAgentChatProps) {
  const sessionId = React.useMemo(() => `share-${shareToken}`, [shareToken]);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/tutor/agent',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: () => ({
          sessionId,
          transcript: [],
          mode: 'shared' as const,
          shareToken,
          context: {},
          options: {
            allowInlineApp: false,
            // 分享态访客没有原录音 → 不返回 [MM:SS]，避免"看起来能点但点了死"
            returnTimestamps: false,
          },
        }),
      }),
    [authToken, sessionId, shareToken],
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';

  const composer = useChatComposer({
    draftKey: sessionId,
    onSubmit: (text) => sendMessage({ text }),
    disabled: busy,
  });

  const lastMsg = messages[messages.length - 1];
  const lastIsUser = lastMsg?.role === 'user';
  const lastAssistantText =
    lastMsg && lastMsg.role === 'assistant' ? collectMessageText(lastMsg) : '';
  const showThinking =
    busy && (lastIsUser || (lastMsg?.role === 'assistant' && !lastAssistantText.trim()));

  return (
    <div
      className="flex flex-col rounded-3xl border border-divider bg-card shadow-card"
      style={{ boxShadow: '0 0 0 1px rgba(45,79,62,0.06), 0 8px 28px rgba(28,27,25,0.06)' }}
    >
      {/* 顶栏：Octo + 分享者 + 课程 */}
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <OctoAvatar
          mood={busy ? 'thinking' : 'listening'}
          size="sm"
          aura
          statusDot="pine"
          animated
        />
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-semibold tracking-display text-ink">
            {COPY.identity.name}
          </span>
          <span className="truncate text-[12px] text-ink-muted">{courseTitle}</span>
        </div>
        {busy ? (
          <span className="ml-auto font-mono text-[10.5px] uppercase tracking-caps text-pine">
            在听
          </span>
        ) : (
          <span className="ml-auto font-mono text-[10.5px] uppercase tracking-caps text-ink-muted">
            就绪
          </span>
        )}
      </div>

      {/* 消息流（限高 55vh，max-w 不限制——share 卡片本身就是受限宽度） */}
      <ChatMessageList
        watchKey={messages.length + (busy ? 1 : 0) + lastAssistantText.length}
        showEmpty={messages.length === 0}
        emptyState={
          <div className="relative rounded-2xl border border-divider/60 bg-paper-warm px-4 py-3.5">
            {/* 朱批左竖条：分享是"此刻有人想给你看" */}
            <span
              aria-hidden
              className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-sm bg-vermilion/70"
            />
            <p className="pl-2 text-[13px] leading-7 text-ink-secondary">
              {COPY.share.landing.sharedBy(sharerNickname)}。可以问我任何关于这节课的事。
            </p>
          </div>
        }
        variant="paper"
        contentMaxWidth="max-w-full"
        className="!max-h-[55vh] !min-h-[160px] !flex-grow-0"
        innerClassName="!gap-3 !py-3"
      >
        {messages.map((m, idx) => {
          const text = collectMessageText(m);
          if (!text.trim()) return null;
          const isLast = idx === messages.length - 1;
          const isStreaming = busy && isLast && m.role === 'assistant';
          if (m.role === 'user') {
            return (
              <ChatBubble key={m.id} role="user" variant="paper" messageId={m.id}>
                {text}
              </ChatBubble>
            );
          }
          if (m.role === 'assistant') {
            return (
              <ChatBubble
                key={m.id}
                role="assistant"
                variant="paper"
                messageId={m.id}
                avatar={
                  <OctoAvatar
                    mood={isStreaming ? 'happy' : 'idle'}
                    size="sm"
                    aura={isStreaming}
                  />
                }
              >
                <ChatRenderer
                  content={text}
                  isStreaming={isStreaming}
                  messageId={m.id}
                />
              </ChatBubble>
            );
          }
          return null;
        })}

        {showThinking ? (
          <ChatThinkingStripBubble
            variant="paper"
            avatar={<OctoAvatar mood="thinking" size="sm" aura />}
            label={<span>{COPY.octoBuddy.thinking}</span>}
          />
        ) : null}
      </ChatMessageList>

      {/* 输入条 paper variant，capabilities 全关（分享态访客是只读体验） */}
      <ChatComposer
        textareaProps={composer.textareaProps}
        onSubmit={composer.submit}
        busy={busy}
        onStop={stop}
        capabilities={{}}
        placeholder={COPY.share.landing.chatPlaceholder}
        busyPlaceholder="同学在想…"
        variant="paper"
      />
    </div>
  );
}
