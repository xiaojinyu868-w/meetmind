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
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowUp, Radio, Eye } from 'lucide-react';
import type { CompanionMessage, CompanionCard } from './types';
import { CompanionMarkdown } from './CompanionMarkdown';
import { OctoBuddySprite } from './OctoBuddy';
import { ThinkingStrip } from '@/components/ui/thinking-strip';
import { InlineAppCard, type InlineAppInteraction } from './InlineAppCard';
import { SkillChipRow } from '@/components/tutor/SkillChipRow';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import { IN_CLASS_PENDING_REPLY_LABEL } from '@/lib/utils/classroom-companion-copy';
import { buildClassroomCompanionPanelModel } from './ClassroomCompanionPanel.model';

const IN_CLASS_EXCLUDED_SKILL_APP_KEYS: readonly WorkshopAppKey[] = ['flashcards', 'quiz', 'study-report'];

const DEFAULT_LIGHT_PROMPTS = [
  '刚才那句我没跟上',
  '这段在讲什么？',
  '帮我抓一下题眼',
];

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
   * 课堂 listening 态只展示适合课中的结构和速查类入口；课后型入口会被过滤。
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
  /** 轻引导问题：不解释能力，只给几句可直接点的自然问题。 */
  suggestedPrompts?: string[];
  /** 试听课结束后的课后状态：章鱼要从“在听”切到“带你复习”。 */
  afterClass?: boolean;
  /** 试听课结束后，章鱼轻引导用户点击“结束这节课”进入课后复习。 */
  onAfterClassAction?: () => void;
}

/** 顶部标题栏：不同 mode 不同呈现 */
function Header({
  mode,
  foresightCount,
  latestForesight,
  onForesightAccept,
  afterClass = false,
}: {
  mode: CompanionMode;
  foresightCount: number;
  latestForesight?: ForesightBubble | null;
  onForesightAccept?: (f: ForesightBubble) => void;
  afterClass?: boolean;
}) {
  // v7 companion-head：octo-stage 圆形 + 呼吸光环 + 名称 + mono pine 状态点
  if (mode === 'listening') {
    const statusLabel = afterClass ? '听完了' : COPY.listening.hearing;
    return (
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-divider/80 bg-paper-warm/40 px-5 py-4 pr-11">
        <div className="flex min-w-0 items-center gap-3 text-ink">
          {/* octo-stage：44px 圆形 + 5px pine 呼吸光环 + 内部 sm sprite */}
          <div className="octo-aura relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-divider bg-card">
            <OctoBuddySprite mood={afterClass ? 'happy' : 'listening'} size="sm" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{COPY.identity.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-pine">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-pine"
                style={{
                  boxShadow: '0 0 0 0 rgba(45,79,62,0.5)',
                  animation: 'rec-pulse-v7 1.6s ease-in-out infinite',
                }}
                aria-hidden
              />
              {statusLabel}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 text-ink-muted/70">
          {foresightCount > 0 && latestForesight ? (
            <button
              type="button"
              onClick={() => onForesightAccept?.(latestForesight)}
              className="flex max-w-[8.5rem] items-center gap-1.5 rounded-full border border-divider bg-card px-2.5 py-1 text-[12px] text-ink-muted shadow-soft transition hover:border-pine hover:text-pine"
              title={latestForesight.text}
            >
              <Eye size={12} strokeWidth={1.6} />
              <span className="truncate">{COPY.companion.foresightCount(foresightCount)}</span>
            </button>
          ) : null}
          <Radio size={14} strokeWidth={1.6} className="text-pine/65" />
        </div>
      </div>
    );
  }
  // idle 态：octo-stage + 名称 + 待命 mono 字
  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-divider/80 bg-paper-warm/40 px-5 py-4 pr-11">
      <div className="octo-aura relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-divider bg-card">
        <OctoBuddySprite mood="idle" size="sm" />
      </div>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold tracking-[-0.01em] text-ink">{COPY.identity.name}</p>
        <p className="mt-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          待命中
        </p>
      </div>
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
      <div className="flex justify-end px-6 pt-2 pb-5">
        <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-ink px-4 py-2.5 text-[14px] leading-[1.75] text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 pt-2 pb-5">
      {message.content ? (
        <CompanionMarkdown content={message.content} isStreaming={isStreaming} />
      ) : null}
      {/* 内联应用产物——在 listening 态只保留课中适合的结构/速查类内容。 */}
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
        <p className="mt-2 text-[12px] leading-relaxed text-ink-muted/80 italic">
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
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((a, i) => (
        <button
          key={`${a.kind}-${a.payload ?? ''}-${i}`}
          type="button"
          onClick={() => onInvoke?.(a)}
          className={
            i === 0
              ? 'inline-flex items-center rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:opacity-85 active:scale-[0.98]'
              : 'inline-flex items-center rounded-full border border-divider bg-white px-3.5 py-1.5 text-[13px] text-ink transition hover:border-ink-muted active:scale-[0.98]'
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
    <div className="mt-3 rounded-2xl border border-divider bg-white px-4 py-4">
      <p className="mb-2 text-[13px] font-medium text-ink-secondary">
        {card.title}
      </p>
      <ul className="space-y-2">
        {card.lines.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-[1.75] text-ink">
            <span className="mt-2 inline-flex h-1 w-1 flex-shrink-0 rounded-full bg-ink-muted/60" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
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
        <p className="text-[15px] font-medium text-ink-secondary">
          {COPY.companion.emptyListeningPrimary}
        </p>
        <p className="mt-2 max-w-[18rem] text-[13px] leading-[1.75] text-ink-muted">
          {COPY.companion.emptyListeningSecondary}
        </p>
        <p className="mt-6 text-[12px] font-medium uppercase tracking-[0.18em] text-ink-muted/80">
          {COPY.companion.actionPrompt}
        </p>
        <SkillChipRow
          variant="grid"
          onPick={onPickSkill}
          onSay={onPickSkill}
          onOpenApp={onOpenApp}
          excludeAppKeys={IN_CLASS_EXCLUDED_SKILL_APP_KEYS}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <p className="max-w-[18rem] text-[15px] leading-[1.75] text-ink-secondary">
        {COPY.companion.emptyIdlePrimary}
      </p>
      <p className="mt-5 text-[12px] font-medium uppercase tracking-[0.18em] text-ink-muted/80">
        {COPY.companion.contentPrompt}
      </p>
      <SkillChipRow
        variant="grid"
        onPick={onPickSkill}
        onSay={onPickSkill}
        onOpenApp={onOpenApp}
        excludeAppKeys={IN_CLASS_EXCLUDED_SKILL_APP_KEYS}
      />
    </div>
  );
}

function ListeningStarterCard({
  onPickSkill,
  suggestedPrompts = DEFAULT_LIGHT_PROMPTS,
  afterClass = false,
  onAfterClassAction,
}: {
  onPickSkill: (prompt: string) => void;
  onOpenApp?: (appKey: WorkshopAppKey) => void;
  suggestedPrompts?: string[];
  afterClass?: boolean;
  onAfterClassAction?: () => void;
}) {
  return (
    <div className="px-6 pb-5">
      <div className="rounded-[22px] border border-divider bg-[#F2EDE3] px-4 py-4">
        <div className="flex items-start gap-3">
          <OctoBuddySprite mood={afterClass ? 'happy' : 'listening'} size="md" className="-ml-1 -mt-1 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium leading-6 text-ink-secondary">
              {afterClass ? '听完了，换我带你练一下。' : '卡住就点一句，我接着这段讲。'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestedPrompts.slice(0, 3).map((prompt, index) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    if (afterClass && index === 0 && onAfterClassAction) {
                      onAfterClassAction();
                      return;
                    }
                    onPickSkill(prompt);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[12px] transition active:scale-[0.98] ${
                    afterClass && index === 0
                      ? 'border-ink bg-ink text-white hover:bg-[#1a1a19]'
                      : 'border-divider bg-white text-ink-secondary hover:border-ink-muted hover:text-ink'
                  }`}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 底部输入框（ChatGPT 风格：上文本区 + 下按钮行） */
function CompanionComposer({
  placeholder,
  onSend,
  statusLabel,
}: {
  placeholder: string;
  onSend: (t: string) => void;
  statusLabel?: string;
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
    <div className="flex-shrink-0 border-t border-divider px-5 pb-5 pt-4">
      {statusLabel ? (
        <div className="mb-2 flex items-center gap-2 px-1 text-[12px] text-ink-muted" role="status" aria-live="polite">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-muted animate-[fadeIn_900ms_ease-in-out_infinite]" />
          <span>{statusLabel}</span>
        </div>
      ) : null}
      <div className="rounded-3xl border border-divider bg-white transition-colors focus-within:border-ink-muted">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="block w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[14px] leading-[1.7] text-ink placeholder:text-ink-muted/70 focus:outline-none"
          style={{ outline: 'none', border: 'none', boxShadow: 'none' }}
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-1">
            {/* 占位：未来可放 @资料 按钮 */}
          </div>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className={`flex h-8 w-8 items-center justify-center rounded-xl transition-all ${
              canSend
                ? 'bg-ink text-white hover:opacity-80 active:scale-95'
                : 'cursor-not-allowed bg-divider-light text-ink-muted/50'
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

/**
 * 流式气泡：正在被 token 填充的 AI 消息。
 *
 * R9 重写：之前 hasContent=false 时直接 return null，导致首 token 等待 1-3s
 * 时段 UI 完全空白——用户体感"完全没流式"。现在分两态：
 *   - 内容为空：显示 thinking ceremony（Octo listening + ThinkingStrip）
 *   - 内容有了：显示 markdown + typing-caret
 * 这样从用户发送消息那一刻起，UI 永远有"AI 在场"的反馈。
 */
function StreamingBubble({
  message,
  pendingLabel,
}: {
  message: CompanionMessage;
  pendingLabel?: string;
}) {
  const hasContent = message.content.trim().length > 0;
  if (!hasContent) {
    return (
      <div className="flex items-start gap-3 px-6 pb-5">
        {/* 小型 octo-stage：让等待时段也有"同学"的存在感 */}
        <div className="octo-aura relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-divider bg-card">
          <OctoBuddySprite mood="thinking" size="sm" />
        </div>
        <ThinkingStrip>
          <span className="text-pine">{pendingLabel || '正在想…'}</span>
        </ThinkingStrip>
      </div>
    );
  }
  return (
    <div className="px-6 pb-5">
      <CompanionMarkdown content={message.content} isStreaming />
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
  onCitationJump,
  onInlineAction,
  onInlineAppInteraction,
  onInlineAppRetry,
  suggestedPrompts = DEFAULT_LIGHT_PROMPTS,
  afterClass = false,
  onAfterClassAction,
}: ClassroomCompanionPanelProps) {
  const effectivePlaceholder = placeholder ?? (
    mode === 'listening' ? COPY.companion.placeholderListening : COPY.companion.placeholderIdle
  );

  const panelModel = buildClassroomCompanionPanelModel({
    mode,
    messages,
    streamingMessage,
    foresights,
  });
  const {
    visibleMessages,
    visibleForesights,
    latestForesight,
    hasMainContent,
    showListeningStarter,
  } = panelModel;
  const pendingReplyLabel = streamingMessage && isThinking && !streamingMessage.content.trim()
    ? IN_CLASS_PENDING_REPLY_LABEL
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <Header
        mode={mode}
        foresightCount={visibleForesights.length}
        latestForesight={latestForesight}
        onForesightAccept={onForesightAccept}
        afterClass={afterClass}
      />

      {/* 消息流 */}
      <div className="flex-1 overflow-y-auto pt-3 pb-5">
        {!hasMainContent ? (
          <EmptyCompanion mode={mode} onPickSkill={onSend} onOpenApp={onOpenApp} />
        ) : (
          <div className="flex flex-col">
            {visibleMessages.map((m) => (
              <CompanionBubble
                key={m.id}
                message={m}
                onCitationJump={onCitationJump}
                onActionInvoke={onInlineAction}
                onInlineAppInteraction={onInlineAppInteraction}
                onInlineAppRetry={onInlineAppRetry}
              />
            ))}
            {showListeningStarter ? (
              <ListeningStarterCard
                onPickSkill={onSend}
                onOpenApp={onOpenApp}
                suggestedPrompts={suggestedPrompts}
                afterClass={afterClass}
                onAfterClassAction={onAfterClassAction}
              />
            ) : null}
            {streamingMessage ? (
              <StreamingBubble message={streamingMessage} pendingLabel={pendingReplyLabel} />
            ) : null}
          </div>
        )}
      </div>

      {/* 有内容时：在 composer 上方挂一条横向滚动的 skill row——
         始终一眼看得见"我能让它做什么"，但信息密度低不打扰阅读。
         空态里 skill 已经用 grid 展示过了，这里就不重复。
         onSay={onSend}——agent-native 主路径：chip = 发 utterance 给 AI 同桌，
         由 AI 侧决定调用哪个工具；onOpenApp 保留作为加速路径。 */}
      {hasMainContent && !showListeningStarter ? (
        <div className="flex-shrink-0 border-t border-divider/70">
          <SkillChipRow
            variant="row"
            onPick={onSend}
            onSay={onSend}
            onOpenApp={onOpenApp}
            excludeAppKeys={IN_CLASS_EXCLUDED_SKILL_APP_KEYS}
          />
        </div>
      ) : null}

      <CompanionComposer placeholder={effectivePlaceholder} onSend={onSend} statusLabel={pendingReplyLabel} />
    </div>
  );
}

export default ClassroomCompanionPanel;
