'use client';

/**
 * TeachChatPanel — /teach 页右侧 Agent 对话栏（v32）。
 *
 * 复用 Chat 底座（ChatMessageList / ChatBubble / ChatComposer / ChatRenderer），
 * 事件流来自 teach-client（自定义 SSE 契约，非 AI SDK 协议，故不用 useChat）：
 * - text-delta → 当前 assistant 气泡流式追加
 * - tool-call → 聚合活动行（✏️ 板书 ×6 · ⭕ 圈注 ×1，不做 chip 墙；
 *   动作是语境不是内容，画布才是动作的主可视化）
 * - 底部输入框随时提问：讲课中发送 = 立即 interrupt + 发消息（hook 内做），
 *  「当前句讲完再说」的精确时机留给后端联调
 * - 语音输入：UI 占位（disabled + tooltip「即将上线」），决策延后
 * - 划线引用提问：quote chip 进输入框顶部（topSlot），随消息发给后端
 */

import { useRef } from 'react';
import { X } from 'lucide-react';
import {
  ChatBubble,
  ChatComposer,
  ChatMessageList,
  ChatRenderer,
  ChatThinkingStripBubble,
  useChatComposer,
} from '@/components/chat';
import { COPY } from '@/lib/ui/copy';
import type { TeachChatMessage } from './teach-events';

/** tool-call → 活动行图标（标签在 COPY.apps.teach.toolChip） */
const CHIP_ICON: Record<string, string> = {
  write: '✏️',
  circle: '⭕',
  underline: '🖍️',
  arrow: '↗️',
  mark: '✅',
  image: '🖼️',
  flip_page: '📄',
  ask: '❓',
};

/**
 * 动作可视化 = 聚合活动行，不是 chip 墙（v33 修正）。
 * 成熟产品的共识（ChatGPT 折叠思考条 / Cursor "edited 3 files" 摘要行）：
 * 动作是语境不是内容——老师说的话才是气泡，手上的动作收成一条低存在感
 * 灰行（✏️ 板书 ×6 · ⭕ 圈注 ×1），连续同类按名聚合、保持首现顺序；
 * 画布本身就是动作的主可视化，对话栏只需要一个 whisper。
 */
function aggregateChips(chips: TeachChatMessage['chips']): Array<{ name: string; count: number }> {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const chip of chips) {
    if (!counts.has(chip.name)) order.push(chip.name);
    counts.set(chip.name, (counts.get(chip.name) ?? 0) + 1);
  }
  return order.map((name) => ({ name, count: counts.get(name) ?? 0 }));
}

interface TeachChatPanelProps {
  threadId: string | null;
  messages: TeachChatMessage[];
  streaming: boolean;
  /** 划线引用（画布传来）；发送后清空 */
  quote: string | null;
  onQuoteChange: (quote: string | null) => void;
  onSend: (text: string, quote?: string) => void;
}

export function TeachChatPanel({
  threadId,
  messages,
  streaming,
  quote,
  onQuoteChange,
  onSend,
}: TeachChatPanelProps) {
  const composer = useChatComposer({
    draftKey: threadId ?? 'teach-new',
    onSubmit: (text) => {
      onSend(text, quote ?? undefined);
      onQuoteChange(null);
    },
    // 随时可问：讲课中不禁输入（发送 = interrupt + 发消息，见 useTeachSession）
    disabled: false,
  });
  const formRef = useRef<HTMLFormElement>(null);

  const last = messages[messages.length - 1];
  const watchKey = `${messages.length}:${last?.text.length ?? 0}:${last?.chips.length ?? 0}`;
  const waitingReply = streaming && last?.role === 'user';

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <ChatMessageList
        watchKey={watchKey}
        showEmpty={messages.length === 0}
        emptyState={
          <p className="pt-10 text-center text-[13px] text-ink-muted">{COPY.apps.teach.emptyChat}</p>
        }
        contentMaxWidth="max-w-none"
      >
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          if (message.role === 'user') {
            return (
              <div key={message.id} className="flex flex-col items-end gap-1">
                {message.quote ? (
                  <div className="w-fit max-w-[85%] rounded-lg border-l-2 border-pine/60 bg-paper-warm px-2.5 py-1 text-[12px] leading-snug text-ink-secondary line-clamp-2">
                    {message.quote}
                  </div>
                ) : null}
                <ChatBubble role="user" messageId={message.id}>
                  {message.text}
                </ChatBubble>
              </div>
            );
          }
          return (
            <div key={message.id} className="flex flex-col gap-1.5">
              {message.chips.length > 0 ? (
                <div
                  className={`flex items-center gap-1.5 text-[11px] text-ink-muted${
                    streaming && isLast ? ' animate-pulse' : ''
                  }`}
                >
                  {aggregateChips(message.chips).map((item) => (
                    <span key={item.name} className="inline-flex items-center gap-0.5">
                      <span aria-hidden="true">{CHIP_ICON[item.name] ?? '🔧'}</span>
                      {COPY.apps.teach.toolChip[item.name] ?? item.name}
                      {item.count > 1 ? ` ×${item.count}` : ''}
                    </span>
                  ))}
                </div>
              ) : null}
              {message.text ? (
                <ChatBubble role="assistant" messageId={message.id}>
                  <ChatRenderer
                    content={message.text}
                    isStreaming={streaming && isLast}
                    className="text-[14px] leading-relaxed"
                  />
                </ChatBubble>
              ) : null}
            </div>
          );
        })}
        {waitingReply ? <ChatThinkingStripBubble label={COPY.apps.teach.thinking} /> : null}
      </ChatMessageList>

      <ChatComposer
        containerRef={formRef}
        textareaProps={composer.textareaProps}
        onSubmit={composer.submit}
        busy={false}
        capabilities={{ mic: true }}
        micDisabledHint={COPY.apps.teach.voiceSoon}
        placeholder={COPY.apps.teach.askPlaceholder}
        topSlot={
          quote ? (
            <div className="flex items-start gap-2 rounded-lg border border-divider bg-paper-warm px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate border-l-2 border-pine/60 pl-2 text-[12px] text-ink-secondary">
                {quote}
              </span>
              <button
                type="button"
                onClick={() => onQuoteChange(null)}
                className="shrink-0 p-0.5 text-ink-muted hover:text-ink"
                aria-label={COPY.apps.teach.removeQuote}
                title={COPY.apps.teach.removeQuote}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
