'use client';

/**
 * ClassroomCompanionPanel — 右侧 AI 同桌面板（常驻）
 *
 * 设计意图（核心）：
 *   "同桌"不是一个聊天机器人。它是一个"一直在旁边的存在"。
 *   它知道你今天有什么课、上周发了什么资料、这节课讲到了哪里。
 *
 *   所以这个面板不是"空白聊天框等你发话"，
 *   而是"进来就看到它已经做了点什么"——
 *     上午：提醒你下午 14:00 有课、上周的讲义已看过、提议一个思考问题
 *     录课中：状态变为"正在听课"，鼓励你有问题就问
 *     课后：轻声说"这节课有几处我没完全听懂，等下看要不要一起过一下"
 *
 *   它的消息是"放下"的，不是"弹出"的。
 *   不会自动滚到新消息——用户转身时自己看到。
 *
 * 三种状态（由 mode 驱动）：
 *   idle：日常待命
 *   listening：正在听课（录课中）
 *   reflecting：课后反思（预留）
 *
 * 底部输入框：ChatGPT 风格，上文本区 + 下按钮行
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, ArrowUp, Radio } from 'lucide-react';
import type { CompanionMessage, CompanionCard } from './types';

export type CompanionMode = 'idle' | 'listening' | 'reflecting';

export interface ClassroomCompanionPanelProps {
  mode: CompanionMode;
  messages: CompanionMessage[];
  /** 发送消息（暂时可以是 mock） */
  onSend: (text: string) => void;
  /** 流式追加中的 AI 消息（content 会随 token 增长）。为 null 表示没在流。 */
  streamingMessage?: CompanionMessage | null;
  /** 是否正在等待 AI 回复（thinking 阶段显示"…"） */
  isThinking?: boolean;
  /** 传给 placeholder 的提示态 */
  placeholder?: string;
}

/** 顶部标题栏：不同 mode 不同呈现 */
function Header({ mode }: { mode: CompanionMode }) {
  if (mode === 'listening') {
    return (
      <div className="flex flex-shrink-0 items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#D96B6B] opacity-75 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D96B6B]" />
          </span>
          <span className="text-[13px] font-medium text-ink">AI 同桌</span>
          <span className="text-[11px] text-ink-muted">· 正在听课</span>
        </div>
        <Radio size={13} className="text-ink-muted/60" strokeWidth={1.6} />
      </div>
    );
  }
  return (
    <div className="flex flex-shrink-0 items-center gap-2 px-5 py-4">
      <Sparkles size={13} className="text-[#8B6914]" strokeWidth={1.6} />
      <span className="text-[13px] font-medium text-ink">AI 同桌</span>
    </div>
  );
}

/** 消息气泡——AI 消息无气泡背景，直接展示，像便签 */
function CompanionBubble({ message }: { message: CompanionMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end px-5 pt-1 pb-4">
        <div className="max-w-[82%] rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-[13px] leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-1 pb-4">
      <p className="text-[13.5px] leading-relaxed text-ink">
        {message.content}
      </p>
      {message.source ? (
        <p className="mt-1 text-[11.5px] text-ink-muted/80 italic">
          {message.source}
        </p>
      ) : null}
      {message.card ? <AttachedCard card={message.card} /> : null}
    </div>
  );
}

/** 附带卡片——课前要点 / 关键概念等 */
function AttachedCard({ card }: { card: CompanionCard }) {
  return (
    <div className="mt-2 rounded-xl bg-white px-3.5 py-3 ring-[0.5px] ring-[#232322]/[0.06]">
      <p className="text-[12px] font-medium text-ink-muted mb-1.5">
        {card.title}
      </p>
      <ul className="space-y-1">
        {card.lines.map((line, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-ink">
            <span className="mt-1.5 inline-flex h-1 w-1 flex-shrink-0 rounded-full bg-ink-muted/60" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 空态 */
function EmptyCompanion({ mode }: { mode: CompanionMode }) {
  if (mode === 'listening') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <p className="text-[13px] text-ink-muted">
          我在听，有问题随时问我。
        </p>
        <p className="mt-1 text-[12px] text-ink-muted/60">
          比如：老师刚说的那个啥意思？
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <p className="text-[13px] text-ink-muted">
        把第一节课录下来，我们就认识了。
      </p>
    </div>
  );
}

/** 底部输入框（ChatGPT 风格：上文本区 + 下按钮行） */
function CompanionComposer({
  placeholder,
  onSend,
}: {
  placeholder: string;
  onSend: (t: string) => void;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 自适应高度
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, [text]);

  const canSend = text.trim().length > 0;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  }, [text, canSend, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-shrink-0 px-4 pb-4 pt-2">
      <div className="rounded-2xl bg-white ring-[0.5px] ring-[#232322]/[0.08] transition-all focus-within:ring-[#232322]/[0.16]">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[13.5px] leading-relaxed text-ink placeholder:text-ink-muted/70 focus:outline-none"
          style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            {/* 占位：未来可放 @资料 按钮 */}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
              canSend
                ? 'bg-ink text-white hover:opacity-80 active:scale-95'
                : 'bg-[#F0F0EE] text-ink-muted/50 cursor-not-allowed'
            }`}
            aria-label="发送"
          >
            <ArrowUp size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** 流式气泡：正在被 token 填充的 AI 消息。 */
function StreamingBubble({ message, isThinking }: { message: CompanionMessage; isThinking: boolean }) {
  const hasContent = message.content.trim().length > 0;
  return (
    <div className="px-5 pb-4">
      {hasContent ? (
        <p className="text-[13.5px] leading-relaxed text-ink">
          {message.content}
          <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-ink/60 animate-pulse" />
        </p>
      ) : isThinking ? (
        <p className="flex items-center gap-1 text-[13.5px] leading-relaxed text-ink-muted">
          <span className="inline-flex h-1 w-1 animate-[fadeIn_600ms_ease-in-out_infinite] rounded-full bg-ink-muted/80" />
          <span className="inline-flex h-1 w-1 animate-[fadeIn_600ms_ease-in-out_infinite_200ms] rounded-full bg-ink-muted/80" />
          <span className="inline-flex h-1 w-1 animate-[fadeIn_600ms_ease-in-out_infinite_400ms] rounded-full bg-ink-muted/80" />
        </p>
      ) : null}
    </div>
  );
}

export function ClassroomCompanionPanel({
  mode,
  messages,
  onSend,
  streamingMessage = null,
  isThinking = false,
  placeholder,
}: ClassroomCompanionPanelProps) {
  const effectivePlaceholder = placeholder ?? (
    mode === 'listening' ? '老师刚说的那个啥意思？' : '问问 AI 同桌…'
  );

  const hasAnything = messages.length > 0 || streamingMessage !== null;

  return (
    <div className="flex h-full flex-col">
      <Header mode={mode} />

      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto pt-2 pb-4">
        {!hasAnything ? (
          <EmptyCompanion mode={mode} />
        ) : (
          <div className="flex flex-col">
            {messages.map((m) => (
              <CompanionBubble key={m.id} message={m} />
            ))}
            {streamingMessage ? (
              <StreamingBubble message={streamingMessage} isThinking={isThinking} />
            ) : null}
          </div>
        )}
      </div>

      <CompanionComposer placeholder={effectivePlaceholder} onSend={onSend} />
    </div>
  );
}

export default ClassroomCompanionPanel;
