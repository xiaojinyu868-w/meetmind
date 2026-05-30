'use client';

/**
 * SharedAgentChat — 分享态对话面板（v3.0）
 *
 * 走 /api/tutor/agent，mode='shared' + shareToken。
 * 不读取访问者的本地 conversation 历史（隔离），只在内存里维护当前会话。
 * 不渲染 inline app marker（分享态不允许产物），但保留时间戳 chip 渲染。
 */

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { COPY } from '@/lib/ui/copy';
import { OctoBuddySprite } from '@/components/classroom/OctoBuddy';

interface SharedAgentChatProps {
  shareToken: string;
  courseTitle: string;
  sharerNickname: string;
  /** 用户登录时的 access token —— 用来在 chat 埋点里带上 visitorUserId（可选） */
  authToken?: string;
}

/**
 * 从 UIMessage 提取纯文本（兼容 v6 parts 结构 + 老 content 字段）。
 */
function getMessageText(message: UIMessage): string {
  const maybeContent = (message as unknown as { content?: unknown }).content;
  if (typeof maybeContent === 'string') {
    return maybeContent;
  }
  const parts = (message as { parts?: Array<{ type: string; text?: string }> }).parts ?? [];
  return parts
    .filter((p) => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
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
            returnTimestamps: true,
          },
        }),
      }),
    [authToken, sessionId, shareToken],
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const [input, setInput] = React.useState('');
  const busy = status === 'submitted' || status === 'streaming';

  const handleSubmit = React.useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || busy) return;
      void sendMessage({ text: trimmed });
      setInput('');
    },
    [busy, input, sendMessage],
  );

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-divider bg-white px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-center gap-3">
        <OctoBuddySprite mood={busy ? 'thinking' : 'listening'} size="sm" />
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-semibold text-ink">{COPY.identity.name}</span>
          <span className="truncate text-[12px] text-ink-muted">{courseTitle}</span>
        </div>
      </div>

      <div className="flex max-h-[55vh] min-h-[160px] flex-col gap-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="rounded-2xl bg-[#FBFBFA] px-4 py-3 text-[13px] leading-7 text-ink-secondary">
            {COPY.share.landing.sharedBy(sharerNickname)}。可以问我任何关于这节课的事。
          </p>
        ) : null}
        {messages.map((message) => {
          const text = getMessageText(message);
          if (!text.trim()) return null;
          const isUser = message.role === 'user';
          return (
            <div key={message.id} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={
                  isUser
                    ? 'max-w-[85%] rounded-2xl bg-[#232322] px-4 py-2.5 text-[13px] leading-6 text-white'
                    : 'max-w-[90%] rounded-2xl bg-[#F7F7F5] px-4 py-3 text-[13.5px] leading-[1.85] text-ink whitespace-pre-wrap'
                }
              >
                {text}
              </div>
            </div>
          );
        })}
        {busy ? (
          <div className="flex items-center gap-2 text-[12px] text-ink-muted">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink-muted" />
            <span>{COPY.octoBuddy.thinking}</span>
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-divider pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={COPY.share.landing.chatPlaceholder}
          disabled={busy}
          className="min-w-0 flex-1 rounded-full border border-divider bg-[#FBFBFA] px-4 py-2 text-[13px] text-ink placeholder:text-ink-muted focus:border-ink/40 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-[#232322] px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-[#111] disabled:opacity-40"
        >
          发送
        </button>
      </form>
    </div>
  );
}
