'use client';

/**
 * SharedAgentChat — 分享态对话面板（v3.0 · v7 视觉）
 *
 * 走 /api/tutor/agent，mode='shared' + shareToken。
 * 不读取访问者的本地 conversation 历史（隔离），只在内存里维护当前会话。
 * 不渲染 inline app marker（分享态不允许产物），但保留时间戳 chip 渲染。
 *
 * v7 视觉：
 *   - paper 米白底 + 极淡 pine ring（surface-ai 概念，但因这里要嵌进 hero
 *     里的明亮 card，所以用 shadow-card + 1px pine ring 而不是流光气息）
 *   - Octo 永驻顶栏 + 状态点（busy 时墨绿 pulse）
 *   - 用户气泡：墨黑 ink；助教气泡：纯米白 + ink 文字（克制）
 *   - 输入框 focus 走 pine ring，发送按钮主色 ink
 */

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { COPY } from '@/lib/ui/copy';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { TypingDots } from '@/components/ui/thinking-strip';
import { StreamingMarkdown } from '@/components/StreamingMarkdown';

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
            // 分享态访客没有原录音——时间戳点了无处跳，会变成"看起来能点但点了死"
            // 的死链体验。直接让模型不要在回答里返回 [MM:SS]，干净利落。
            returnTimestamps: false,
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
    <div
      className="flex flex-col gap-3 rounded-3xl border border-divider bg-card px-4 py-4 shadow-card sm:px-5 sm:py-5"
      style={{ boxShadow: '0 0 0 1px rgba(45,79,62,0.06), 0 8px 28px rgba(28,27,25,0.06)' }}
    >
      {/* 顶栏：Octo 永驻 + 状态 */}
      <div className="flex items-center gap-3">
        <OctoAvatar
          mood={busy ? 'thinking' : 'listening'}
          size="sm"
          aura
          statusDot={busy ? 'pine' : 'pine'}
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

      <div className="flex max-h-[55vh] min-h-[160px] flex-col gap-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
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
        ) : null}
        {messages.map((message, index) => {
          const text = getMessageText(message);
          if (!text.trim()) return null;
          const isUser = message.role === 'user';
          // 最后一条 assistant 消息且仍在流，开启光标 + 数学公式跳过保护
          const isLastAssistant = !isUser && index === messages.length - 1;
          const isStreamingThis = isLastAssistant && busy;
          return (
            <div key={message.id} className={isUser ? 'flex justify-end' : 'flex justify-start'}>
              {isUser ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-ink px-4 py-2.5 text-[13px] leading-6 text-white shadow-soft">
                  {text}
                </div>
              ) : (
                <div className="max-w-[90%] rounded-2xl border border-divider/60 bg-paper-warm px-4 py-3 text-ink">
                  {/* 与登录态 Tutor 同一套渲染（GFM 表格 + KaTeX 公式），
                      但分享态显式不传 onTimestampClick + prompt 层让模型不返回 [MM:SS]，
                      不会再出现"看起来可点但点了死"的死链。 */}
                  <StreamingMarkdown
                    content={text}
                    isStreaming={isStreamingThis}
                    className="text-[13.5px] leading-[1.85]"
                  />
                </div>
              )}
            </div>
          );
        })}
        {busy ? (
          <div className="flex items-center gap-2 pl-1">
            <TypingDots />
            <span className="text-[12px] text-ink-muted">{COPY.octoBuddy.thinking}</span>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-divider pt-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={COPY.share.landing.chatPlaceholder}
          disabled={busy}
          className="min-w-0 flex-1 rounded-full border border-divider bg-paper-warm px-4 py-2 text-[13px] text-ink placeholder:text-ink-muted transition focus:border-pine focus:outline-none focus:ring-2 focus:ring-pine/15 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-ink px-5 py-2 text-[12.5px] font-medium text-white shadow-soft transition hover:opacity-90 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          发送
        </button>
      </form>
    </div>
  );
}
