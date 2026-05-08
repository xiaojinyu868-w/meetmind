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
 *     录课中：状态变为"正在听课"，鼓励你有问题就问，偶尔冒出"预知气泡"
 *     课后：轻声说"这节课有几处我没完全听懂，等下看要不要一起过一下"
 *
 *   它的消息是"放下"的，不是"弹出"的。
 *   不会自动滚到新消息——用户转身时自己看到。
 *
 * 三种状态（由 mode 驱动）：
 *   idle：日常待命
 *   listening：正在听课（录课中，会冒预知气泡）
 *   reflecting：课后反思（预留）
 *
 * 渲染：
 *   - AI 消息走 CompanionMarkdown（公式 + Markdown + 去时间戳）
 *   - 用户消息保持纯文本（不解析 Markdown，避免误伤）
 *   - 预知气泡（foresight）单独成列，样式比正文更轻
 *
 * 底部输入框：ChatGPT 风格，上文本区 + 下按钮行
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Radio, Eye } from 'lucide-react';
import type { CompanionMessage, CompanionCard } from './types';
import { CompanionMarkdown } from './CompanionMarkdown';
import { CompanionAvatar } from './CompanionAvatar';
import { InlineAppCard, type InlineAppInteraction } from './InlineAppCard';
import { SkillChipRow } from '@/components/tutor/SkillChipRow';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';

export type CompanionMode = 'idle' | 'listening' | 'reflecting';

/** 预知气泡——AI 基于最近转录预判的"接下来可能要讲/要问"的一个小点 */
export interface ForesightBubble {
  id: string;
  /** 短标签，2-6 字，例如"接下来"、"容易混"、"可能问" */
  label: string;
  /** 一句话内容（<= 40 字） */
  text: string;
  createdAt: number;
}

export interface ClassroomCompanionPanelProps {
  mode: CompanionMode;
  messages: CompanionMessage[];
  /** 发送消息（暂时可以是 mock） */
  onSend: (text: string) => void;
  /**
   * 打开一个 App 应用（闪卡 / 测验 / 思维导图 / 学习报告 / 考试速查表）。
   * 由 page.tsx 的 safeOpenWorkshopWindow 承担；没传则 skill chip 自动降级成
   * 普通的 prompt 对话，保证任何层级都能渲染。
   */
  onOpenApp?: (appKey: WorkshopAppKey) => void;
  /** 流式追加中的 AI 消息（content 会随 token 增长）。为 null 表示没在流。 */
  streamingMessage?: CompanionMessage | null;
  /** 是否正在等待 AI 回复（thinking 阶段显示"…"） */
  isThinking?: boolean;
  /** 传给 placeholder 的提示态 */
  placeholder?: string;
  /** 预知气泡队列——最多展示最近 N 条 */
  foresights?: ForesightBubble[];
  /** 用户点了某个预知气泡——把它的 text 作为问句发出去 */
  onForesightAccept?: (f: ForesightBubble) => void;
  /** 用户划掉某个预知气泡 */
  onForesightDismiss?: (id: string) => void;
  /**
   * 用户点了 AI 消息下面的"证据 chip"——把对应时间戳传上去，
   * 由父组件（ClassroomView）推 scrollTarget 到转录面板并触发高亮脉冲。
   */
  onCitationJump?: (startMs: number) => void;
  /**
   * 用户点了 AI 消息里的内联 action（比如停止录音时那条气泡带的
   * [整速查表] / [看转录]）。不同 kind 对应不同响应：
   *   open_app         → openWorkshopWindow(payload)
   *   focus_transcript → 切到 recording 态，让转录抽屉可见
   *   say              → 把 payload 当作一条用户消息发出去
   */
  onInlineAction?: (
    action: NonNullable<CompanionMessage['actions']>[number],
  ) => void;
  /** 用户在内联 app 卡片里做的操作（答题、翻卡、评分）——交给 hook 处理。 */
  onInlineAppInteraction?: (messageId: string, event: InlineAppInteraction) => void;
  /** 内联 app 生成失败时点"再试一次"——让 hook 重新触发一次生成。 */
  onInlineAppRetry?: (messageId: string) => void;
}

/** 顶部标题栏：不同 mode 不同呈现 */
function Header({ mode, foresightCount }: { mode: CompanionMode; foresightCount: number }) {
  if (mode === 'listening') {
    return (
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[#F0F0ED] px-5 py-3.5">
        <div className="flex items-center gap-2.5 text-ink">
          {/* 同学 avatar：听见态外环脉冲 */}
          <CompanionAvatar size="md" state="listening" />
          <span className="text-[13px] font-medium text-ink">{COPY.identity.name}</span>
          <span className="text-[11px] text-ink-muted">· {COPY.listening.hearing}</span>
        </div>
        <div className="flex items-center gap-2 text-ink-muted/60">
          {foresightCount > 0 ? (
            <span className="flex items-center gap-1 text-[11px] text-ink-muted/80">
              <Eye size={11} strokeWidth={1.6} />
              <span>{foresightCount} 个预感</span>
            </span>
          ) : null}
          <Radio size={13} className="" strokeWidth={1.6} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-[#F0F0ED] px-5 py-3.5">
      <CompanionAvatar size="md" state="idle" />
      <span className="text-[13px] font-medium text-ink">{COPY.identity.name}</span>
    </div>
  );
}

/** 消息气泡——AI 消息无气泡背景，直接展示，像便签 */
function CompanionBubble({
  message,
  isStreaming = false,
  onActionInvoke,
  onInlineAppInteraction,
  onInlineAppRetry,
}: {
  message: CompanionMessage;
  isStreaming?: boolean;
  /** citation 已废弃，保留参数位但 CompanionBubble 内部不再渲染 */
  onCitationJump?: (startMs: number) => void;
  onActionInvoke?: (action: NonNullable<CompanionMessage['actions']>[number]) => void;
  onInlineAppInteraction?: (messageId: string, event: InlineAppInteraction) => void;
  onInlineAppRetry?: (messageId: string) => void;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end px-5 pt-1 pb-4">
        <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-[13px] leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pt-1 pb-4">
      {message.content ? (
        <CompanionMarkdown content={message.content} isStreaming={isStreaming} />
      ) : null}
      {/* 内联应用产物（闪卡 / 测验 / 速查表 / 思维导图 / 学习报告）——
         在 listening 态它是主展示区，替代原来的 WorkshopWindow 弹窗。 */}
      {message.inlineApp ? (
        <InlineAppCard
          inlineApp={message.inlineApp}
          onInteraction={(e) => onInlineAppInteraction?.(message.id, e)}
          onRetry={() => onInlineAppRetry?.(message.id)}
        />
      ) : null}
      {/* M8 修正：课堂场景（课中学习）不显示时间戳证据 chip。*/}
      {message.actions && message.actions.length > 0 && !isStreaming ? (
        <InlineActionStrip actions={message.actions} onInvoke={onActionInvoke} />
      ) : null}
      {message.source ? (
        <p className="mt-1 text-[11.5px] text-ink-muted/80 italic">
          {message.source}
        </p>
      ) : null}
      {message.card ? <AttachedCard card={message.card} /> : null}
    </div>
  );
}

/**
 * InlineActionStrip — 气泡下方的内联动作 chip。
 * 视觉是实心按钮，但仍然非常克制——黑白两级。
 * 用户点主 action（第一个）= 黑底白字；次 action = 白底黑字。
 */
function InlineActionStrip({
  actions,
  onInvoke,
}: {
  actions: NonNullable<CompanionMessage['actions']>;
  onInvoke?: (action: NonNullable<CompanionMessage['actions']>[number]) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {actions.map((a, i) => (
        <button
          key={`${a.kind}-${a.payload ?? ''}-${i}`}
          type="button"
          onClick={() => onInvoke?.(a)}
          className={
            i === 0
              ? 'inline-flex items-center rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-white transition hover:opacity-85 active:scale-[0.98]'
              : 'inline-flex items-center rounded-full bg-white px-3 py-1 text-[12px] text-ink ring-[0.5px] ring-[#232322]/[0.12] transition hover:ring-[#232322]/[0.25] active:scale-[0.98]'
          }
        >
          {a.label}
        </button>
      ))}
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

/**
 * 预知气泡——AI 的"主动性"触点。
 *
 * 设计原则（对齐 Taste）：
 *   - 不弹窗不通知，只在消息流里像便签一样轻轻出现。
 *   - 不喊"AI 提示"、"注意"这类噪音词，直接一句话。
 *   - 可点（把这句话作为问题发出去）、可划掉（不感兴趣）。
 *   - 颜色比正文轻一档，不抢用户注意力。
 */
function ForesightRow({
  foresight,
  onAccept,
  onDismiss,
}: {
  foresight: ForesightBubble;
  onAccept?: (f: ForesightBubble) => void;
  onDismiss?: (id: string) => void;
}) {
  return (
    <div className="group relative px-5 pt-1 pb-3">
      <div className="rounded-xl border border-dashed border-[#E4E4E0] bg-[#FBFAF5]/60 px-3.5 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[#8B6914]">
            <Eye size={11} strokeWidth={1.8} />
            <span>{foresight.label}</span>
          </span>
          {onDismiss ? (
            <button
              type="button"
              onClick={() => onDismiss(foresight.id)}
              className="text-[11px] text-ink-muted/50 opacity-0 transition-opacity hover:text-ink-muted group-hover:opacity-100"
              aria-label="划掉这条预感"
            >
              划掉
            </button>
          ) : null}
        </div>
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          {foresight.text}
        </p>
        {onAccept ? (
          <button
            type="button"
            onClick={() => onAccept(foresight)}
            className="mt-1.5 text-[11.5px] text-ink-muted underline decoration-[#E0E0DB] decoration-1 underline-offset-[3px] transition-colors hover:text-ink hover:decoration-ink-muted"
          >
            就这个 · 问下去
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 空态 */
function EmptyCompanion({
  mode,
  onPickSkill,
  onOpenApp,
}: {
  mode: CompanionMode;
  onPickSkill: (prompt: string) => void;
  onOpenApp?: (appKey: WorkshopAppKey) => void;
}) {
  if (mode === 'listening') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <p className="text-[13px] text-ink-muted">
          我在听，有问题随时问我。
        </p>
        <p className="mt-1 text-[12px] text-ink-muted/60">
          有时候我会先你一步冒个小预感，点一下就能顺着问。
        </p>
        <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted/70">
          或者让我做点事
        </p>
        <SkillChipRow variant="grid" onPick={onPickSkill} onSay={onPickSkill} onOpenApp={onOpenApp} />
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <p className="text-[13px] text-ink-muted">
        把第一节课录下来，我们就认识了。
      </p>
      <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted/70">
        已经有内容？试试
      </p>
      <SkillChipRow variant="grid" onPick={onPickSkill} onSay={onPickSkill} onOpenApp={onOpenApp} />
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

  // ⌘K / Ctrl+K 全局快捷键：把焦点切到这个 composer。
  // 用户在阅读转录时能单键唤起同学对话——跨面板焦点管理，是 agent-native 对
  // 键盘手感的基本尊重。
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      // 不在其他输入框里打断用户
      const tag = (e.target as HTMLElement | null)?.tagName;
      const activeIsInput = tag === 'INPUT' || tag === 'TEXTAREA';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // 允许从另一个 input 跳过来，但避免和浏览器默认（地址栏）冲突
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      // 当前没焦点在任何输入框时，单字符"/"也聚焦——VSCode / Linear 的约定
      if (!activeIsInput && e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  }, []);

  const canSend = text.trim().length > 0;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  }, [text, canSend, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送；Ctrl/Cmd+Enter 换行；IME 输入中不触发
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+Enter = 换行（浏览器默认不会在 textarea 里插入，手动处理）
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = text.slice(0, start) + '\n' + text.slice(end);
      setText(next);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 1;
      });
      return;
    }
    e.preventDefault();
    handleSend();
  };

  return (
    <div className="flex-shrink-0 border-t border-[#F0F0ED] px-4 pb-4 pt-3">
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
        <CompanionMarkdown content={message.content} isStreaming />
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
  onOpenApp,
  streamingMessage = null,
  isThinking = false,
  placeholder,
  foresights = [],
  onForesightAccept,
  onForesightDismiss,
  onCitationJump,
  onInlineAction,
  onInlineAppInteraction,
  onInlineAppRetry,
}: ClassroomCompanionPanelProps) {
  const effectivePlaceholder = placeholder ?? (
    mode === 'listening' ? COPY.companion.placeholderListening : COPY.companion.placeholderIdle
  );

  // 只在 listening 态显示预知气泡——其他态说"预知"没意义
  const visibleForesights = mode === 'listening' ? foresights : [];
  const hasAnything = messages.length > 0 || streamingMessage !== null || visibleForesights.length > 0;

  return (
    <div className="flex h-full flex-col">
      <Header mode={mode} foresightCount={visibleForesights.length} />

      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto pt-2 pb-4">
        {!hasAnything ? (
          <EmptyCompanion mode={mode} onPickSkill={onSend} onOpenApp={onOpenApp} />
        ) : (
          <div className="flex flex-col">
            {messages.map((m) => (
              <CompanionBubble
                key={m.id}
                message={m}
                onCitationJump={onCitationJump}
                onActionInvoke={onInlineAction}
                onInlineAppInteraction={onInlineAppInteraction}
                onInlineAppRetry={onInlineAppRetry}
              />
            ))}
            {streamingMessage ? (
              <StreamingBubble message={streamingMessage} isThinking={isThinking} />
            ) : null}
            {visibleForesights.length > 0 ? (
              <div className="mt-1">
                {visibleForesights.map((f) => (
                  <ForesightRow
                    key={f.id}
                    foresight={f}
                    onAccept={onForesightAccept}
                    onDismiss={onForesightDismiss}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* 有内容时：在 composer 上方挂一条横向滚动的 skill row——
         始终一眼看得见"我能让它做什么"，但信息密度低不打扰阅读。
         空态里 skill 已经用 grid 展示过了，这里就不重复。
         onSay={onSend}——agent-native 主路径：chip = 发 utterance 给 AI 同桌，
         由 AI 侧决定调用哪个工具；onOpenApp 保留作为加速路径。 */}
      {hasAnything ? (
        <div className="flex-shrink-0 border-t border-[#F0F0ED]/60">
          <SkillChipRow variant="row" onPick={onSend} onSay={onSend} onOpenApp={onOpenApp} />
        </div>
      ) : null}

      <CompanionComposer placeholder={effectivePlaceholder} onSend={onSend} />
    </div>
  );
}

export default ClassroomCompanionPanel;
