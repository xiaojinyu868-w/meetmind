'use client';

/**
 * TeachChatPanel — /teach 页右侧 Agent 对话栏（v32）。
 *
 * 渲染层已迁移到 Vercel AI Elements（src/components/ai-elements/）：
 * - ChatMessageList → Conversation（use-stick-to-bottom 自动跟随 + 回到最新按钮）
 * - ChatBubble → Message / MessageContent
 * - ChatRenderer → MessageResponse（Streamdown 流式 markdown；CJK 加粗在原语内置）
 * - ChatThinkingStripBubble → Loader
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
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import { Loader } from '@/components/ai-elements/loader';
import { ChatComposer, useChatComposer } from '@/components/chat';
import { COPY } from '@/lib/ui/copy';
import { normalizeNarrationMarks } from '@/lib/utils/normalize-narration-marks';
// 与迁移前 ChatRenderer→StreamingMarkdown 对齐的数学公式能力（remark-math + KaTeX）；
// Streamdown 默认不含 math，这里用默认链 + 追加的方式补齐
import { defaultRehypePlugins, defaultRemarkPlugins } from 'streamdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
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

/**
 * 数学公式插件链：Streamdown 默认 remark/rehype 链 + remark-math/rehype-katex
 * （与迁移前 StreamingMarkdown 的能力对齐；katex CSS 在本文件顶部引入）
 */
const TEACH_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkMath];
const TEACH_REHYPE_PLUGINS = [...Object.values(defaultRehypePlugins), rehypeKatex];

/**
 * 排版规格（原样搬迁自 StreamingMarkdown v7 R9 打磨：呼吸感 + 双签名色 + 信息层级）：
 * - 正文/列表 leading-[1.85] text-[14.5px]（中文阅读舒适）
 * - 段落间距 mb-3.5（Streamdown 块间距 space-y-4 → 压回 space-y-3.5）
 * - 列表 marker 带 pine 主签名色，ol marker 用 mono
 * - 引用块极淡 pine 衬底 + 极细 pine 左竖线；链接 pine 色
 * 代码块/表格用 Streamdown 自带样式（teach 几乎不出，自带已足够好）
 */
const TEACH_RESPONSE_CLASSNAME = [
  'space-y-3.5 text-[14.5px] leading-[1.85] text-ink',
  '[&_p]:mb-3.5 [&_p]:last:mb-0 [&_p]:leading-[1.85] [&_p]:text-[14.5px] [&_p]:text-ink',
  '[&_li]:leading-[1.85] [&_li]:text-[14.5px] [&_li]:text-ink [&_li]:pl-1',
  '[&_h2]:mb-3 [&_h2]:mt-5 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:tracking-[-0.012em] [&_h2]:text-ink [&_h2]:first:mt-0 [&_h2]:leading-snug',
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-[14.5px] [&_h3]:font-semibold [&_h3]:text-ink [&_h3]:first:mt-0 [&_h3]:leading-snug',
  '[&_ul]:mb-3.5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:marker:text-pine/55 [&_ul]:marker:text-[0.95em]',
  '[&_ol]:mb-3.5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ol]:marker:font-mono [&_ol]:marker:text-pine/70 [&_ol]:marker:text-[0.92em] [&_ol]:marker:font-medium',
  '[&_em]:italic [&_em]:text-ink-secondary',
  '[&_blockquote]:my-3 [&_blockquote]:rounded-r-md [&_blockquote]:border-l-2 [&_blockquote]:border-pine/40 [&_blockquote]:bg-pine/[0.03] [&_blockquote]:py-1.5 [&_blockquote]:pl-3.5 [&_blockquote]:pr-2 [&_blockquote]:text-[14px] [&_blockquote]:text-ink-secondary [&_blockquote]:leading-[1.75]',
  '[&_a]:text-pine [&_a]:underline [&_a]:decoration-pine/35 [&_a]:decoration-1 [&_a]:underline-offset-[3px] [&_a]:transition-all [&_a:hover]:decoration-pine [&_a:hover]:decoration-2',
  '[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-paper-warm [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-[1px] [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[12.5px] [&_:not(pre)>code]:text-ink',
  '[&_hr]:my-4 [&_hr]:border-divider',
].join(' ');

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
  const waitingReply = streaming && last?.role === 'user';

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <Conversation className="bg-card">
        <ConversationContent className="gap-5 px-4 py-6">
          {messages.length === 0 ? (
            <p className="pt-10 text-center text-[13px] text-ink-muted">{COPY.apps.teach.emptyChat}</p>
          ) : (
            messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              if (message.role === 'user') {
                return (
                  <Message key={message.id} from="user">
                    {message.quote ? (
                      <div className="ml-auto w-fit max-w-[85%] rounded-lg border-l-2 border-pine/60 bg-paper-warm px-2.5 py-1 text-[12px] leading-snug text-ink-secondary line-clamp-2">
                        {message.quote}
                      </div>
                    ) : null}
                    <MessageContent className="whitespace-pre-wrap break-words text-[15px] leading-[1.7]">
                      {message.text}
                    </MessageContent>
                  </Message>
                );
              }
              return (
                <Message key={message.id} from="assistant">
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
                    <MessageContent>
                      <MessageResponse
                        remarkPlugins={TEACH_REMARK_PLUGINS}
                        rehypePlugins={TEACH_REHYPE_PLUGINS}
                        className={TEACH_RESPONSE_CLASSNAME}
                      >
                        {normalizeNarrationMarks(message.text)}
                      </MessageResponse>
                    </MessageContent>
                  ) : null}
                </Message>
              );
            })
          )}
          {waitingReply ? (
            <div className="flex items-center gap-2 text-[12.5px] text-ink-muted">
              <Loader size={14} className="text-pine" aria-hidden />
              <span>{COPY.apps.teach.thinking}</span>
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton aria-label={COPY.aiElements.backToLatest} />
      </Conversation>

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
