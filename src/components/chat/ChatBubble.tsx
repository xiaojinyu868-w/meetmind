/**
 * ChatBubble —— 单条消息壳。
 *
 * 三个 slot：
 *   - avatar：左侧头像（assistant 用 Octo，user 通常不传）
 *   - children：消息体（一般是 ChatRenderer，也可以是任意内容）
 *   - actions：消息底部操作行（复制/重生成/反馈）—— 默认 hover 才显示
 *   - footer：底部追加内容（例如内联 IntentSummaryCard / InlineAppCard）
 *
 * 三种风格 variant：
 *   - 'paper'（默认）：v7 米白纸感、克制风（用于复习态、设置页）
 *   - 'glass'：半透明 + backdrop-blur（用于 IntentDialog 沉浸式背景上）
 *   - 'minimal'：无背景无边框（用于浮窗 WordExplainer / 移动端纯文字态）
 *
 * 用户消息 vs AI 消息：
 *   - 用户：右对齐 + 实心深色气泡
 *   - AI：左对齐 + paper/glass 半透明
 */

'use client';

import * as React from 'react';
import { readStoredAccessToken } from '@/lib/hooks/useAuth';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ChatBubbleRole = 'user' | 'assistant' | 'system';
export type ChatBubbleVariant = 'paper' | 'glass' | 'minimal';

export interface ChatBubbleProps {
  role: ChatBubbleRole;
  variant?: ChatBubbleVariant;
  /** assistant 的左侧头像 */
  avatar?: React.ReactNode;
  /** 消息底部操作行（hover 显示） */
  actions?: React.ReactNode;
  /** 底部 slot（永远显示，例如 SummaryCard） */
  footer?: React.ReactNode;
  /** 消息体 */
  children: React.ReactNode;
  /** assistant 消息可允许气泡占满（用于内联应用卡场景） */
  fullWidth?: boolean;
  /** M12：消息 ID —— 加到消息体 DOM 的 data-msg-id，让 copyMessageSmart 能取 innerHTML 复制富文本 */
  messageId?: string;
  className?: string;
}

const ROLE_ALIGN: Record<ChatBubbleRole, string> = {
  user: 'justify-end',
  assistant: 'justify-start',
  system: 'justify-center',
};

function bubbleClasses(role: ChatBubbleRole, variant: ChatBubbleVariant): string {
  if (role === 'user') {
    // 用户气泡：墨黑实心，右下角小圆角
    return cn(
      'rounded-2xl rounded-br-md',
      'px-4 py-2.5 text-[15px] leading-[1.7] whitespace-pre-wrap break-words',
      // glass：在沉浸式深色背景上，用 white/12 半透明 + 白字（不要 bg-ink，会糊在背景里）
      variant === 'glass'
        ? 'bg-white/12 border border-white/20 backdrop-blur-md text-white shadow-[0_2px_12px_rgba(0,0,0,0.35)]'
        : 'bg-ink text-white',
    );
  }
  // assistant
  if (variant === 'glass') {
    // bug 修复：原来 bg-white/82 + text-ink 在深色背景下气泡 + 文字都偏深，用户看不见。
    // 顶级 immersive 产品（Apple Intelligence / Linear AI）的做法是：assistant 用接近实白的卡片
    // 让深色文字稳定可读，"glass 感"靠 backdrop-blur + 极轻透明度 + 阴影实现，
    // 而不是把背景做透。
    return cn(
      'rounded-2xl rounded-bl-md',
      'bg-white/95 backdrop-blur-xl',
      'border border-white/40',
      'shadow-[0_4px_24px_rgba(0,0,0,0.25)]',
      'px-4 py-3 text-[15px] leading-[1.75] text-ink',
    );
  }
  if (variant === 'minimal') {
    return cn(
      'text-[14.5px] leading-[1.75] text-ink',
      'whitespace-pre-wrap break-words',
    );
  }
  // paper（默认）
  return cn(
    'rounded-2xl rounded-bl-md',
    'border border-divider bg-canvas',
    'px-4 py-2.5 text-[14.5px] leading-[1.75] text-ink',
    'break-words',
  );
}

export const ChatBubble = React.memo(function ChatBubble({
  role,
  variant = 'paper',
  avatar,
  actions,
  footer,
  children,
  fullWidth,
  messageId,
  className,
}: ChatBubbleProps) {
  const isUser = role === 'user';
  return (
    <div className={cn('group/chat-bubble flex w-full', ROLE_ALIGN[role], className)}>
      {/* 左侧 avatar（仅 assistant + 非 minimal 显示） */}
      {!isUser && avatar && variant !== 'minimal' ? (
        <div className="mr-2.5 mt-0.5 shrink-0">{avatar}</div>
      ) : null}
      <div
        className={cn(
          'flex flex-col',
          fullWidth ? 'w-full max-w-full' : 'max-w-[88%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        <div className={bubbleClasses(role, variant)} data-msg-id={messageId}>{children}</div>
        {/* hover 时浮起来的操作行 */}
        {actions ? (
          <div
            className={cn(
              'mt-1 flex items-center gap-1 px-1',
              'opacity-0 transition-opacity duration-150 group-hover/chat-bubble:opacity-100',
              'focus-within:opacity-100',
            )}
            aria-hidden={false}
          >
            {actions}
          </div>
        ) : null}
        {footer ? <div className={cn('mt-2', fullWidth ? 'w-full' : 'min-w-[280px]')}>{footer}</div> : null}
      </div>
    </div>
  );
});

ChatBubble.displayName = 'ChatBubble';

// ─────────────────────────────────────────────────────────
// 通用消息操作按钮（消费者可自由组合）
// ─────────────────────────────────────────────────────────

export interface ChatBubbleActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}

export function ChatBubbleActionButton({ icon, label, onClick, active }: ChatBubbleActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px]',
        'text-ink-muted transition-colors',
        'hover:bg-paper-warm hover:text-ink-secondary',
        active && 'bg-pine/10 text-pine',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// M14.5: 消息级 👍 / 👎 反馈按钮（标志性大厂能力）
// ─────────────────────────────────────────────────────────

export interface ChatMessageFeedbackButtonsProps {
  /** 被反馈的消息 ID */
  messageId: string;
  /** 被反馈的消息文本（截断后由 API 服务端 cap 1000 字） */
  messageText?: string;
  /** 透传给后端，便于分析哪个 mode / model 上 👎 多 */
  mode?: string;
  modelId?: string;
  /** 登录用户 ID（访客可省略，由 IP 追溯） */
  userId?: string;
  /**
   * 反馈成功回调（外部可显示 toast）。失败时不调；不传则 hook 自身静默处理。
   */
  onFeedbackSent?: (rating: 'up' | 'down') => void;
}

/**
 * 消息底部反馈按钮（用在 ChatBubble.actions 里）。
 *
 * 设计：
 *   - 一次只能选 up 或 down（再点一次不可撤销，但可以切换）
 *   - 点击后立刻上报，不弹对话框追问理由（追问会大幅降低参与率，详见 ChatGPT 早期 A/B）
 *   - 网络失败静默 —— 不打扰用户主流程
 *
 * 复用 Feedback 表 type='message-rating'：
 *   - title = "[messageId 前 60 字] 👍 / 👎"
 *   - content = JSON.stringify({ rating, mode, modelId, messageText, comment })
 */
export function ChatMessageFeedbackButtons({
  messageId,
  messageText,
  mode,
  modelId,
  userId,
  onFeedbackSent,
}: ChatMessageFeedbackButtonsProps) {
  const [chosen, setChosen] = React.useState<'up' | 'down' | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const send = React.useCallback(
    async (rating: 'up' | 'down') => {
      if (submitting) return;
      // 切换到同一选项：忽略
      if (chosen === rating) return;
      // messageId 为空时无法上报（AI SDK 流式消息可能在某些路径下 id 缺失）
      if (!messageId) {
        setChosen(rating);
        onFeedbackSent?.(rating);
        return;
      }
      setSubmitting(true);
      const previous = chosen;
      setChosen(rating); // optimistic
      try {
        const accessToken = readStoredAccessToken();
        const resp = await fetch('/api/feedback/message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            messageId,
            rating,
            mode,
            modelId,
            messageText,
            userId,
          }),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        onFeedbackSent?.(rating);
      } catch {
        setChosen(previous); // rollback
        // 失败时给用户一个轻提示，避免"点了没反馈"
        if (typeof window !== 'undefined') {
          import('sonner').then(({ toast }) => {
            toast.error('网络不太好，反馈没送出去', { duration: 1500 });
          }).catch(() => undefined);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [chosen, submitting, messageId, mode, modelId, messageText, userId, onFeedbackSent],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => void send('up')}
        disabled={submitting}
        title="赞"
        aria-label="赞"
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
          chosen === 'up'
            ? 'bg-pine/10 text-pine'
            : 'text-ink-muted hover:bg-paper-warm hover:text-ink-secondary',
        )}
      >
        <ThumbsUp size={12} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={() => void send('down')}
        disabled={submitting}
        title="可以更好"
        aria-label="可以更好"
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
          chosen === 'down'
            ? 'bg-vermilion/10 text-vermilion'
            : 'text-ink-muted hover:bg-paper-warm hover:text-ink-secondary',
        )}
      >
        <ThumbsDown size={12} strokeWidth={1.8} />
      </button>
    </>
  );
}
