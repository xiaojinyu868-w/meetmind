'use client';

/**
 * IntentMessageItem —— 目标共建的单条消息渲染（用户气泡 / AI 气泡 + 卡片 + 选项）。
 *
 * 一条 AI 消息可能同时携带：可见文本、---我了解到的你--- 卡、---我想要的--- 卡、
 * ---选项--- 果冻按钮。流式中先剃掉未闭合的半截 marker，避免露出原始标记。
 * 模型偶尔不输出选项块时，给兜底快答（继续说 / 帮我捋出来记着），保证永远能点选推进。
 */

import * as React from 'react';
import type { UIMessage } from 'ai';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import {
  ChatBubble,
  ChatRenderer,
  collectMessageText,
  extractIntentSummary,
  extractIntentBio,
  extractIntentOptions,
  stripPartialIntentBlocks,
} from '@/components/chat';
import { COPY } from '@/lib/ui/copy';
import { IntentSummaryCard } from './IntentSummaryCard';
import { IntentBioCard } from './IntentBioCard';
import { IntentOptionChips } from './IntentOptionChips';
import type { GoalEntry } from '@/types/user';

type SummaryParams = {
  title: string;
  summary?: string;
  horizon?: GoalEntry['horizon'];
  acceptedPoints?: string[];
  rejectedPoints?: string[];
};

type BioParams = {
  headline: string;
  detail?: string;
  acceptedPoints?: string[];
  rejectedPoints?: string[];
};

interface IntentMessageItemProps {
  message: UIMessage;
  isLast: boolean;
  busy: boolean;
  summarySaved: boolean;
  summaryDismissed: boolean;
  bioSaved: boolean;
  bioDismissed: boolean;
  onDismissSummary: () => void;
  onAcceptSummary: (params: SummaryParams) => void;
  onDismissBio: () => void;
  onAcceptBio: (params: BioParams) => void;
  onPickOption: (option: string) => void;
}

export function IntentMessageItem({
  message,
  isLast,
  busy,
  summarySaved,
  summaryDismissed,
  bioSaved,
  bioDismissed,
  onDismissSummary,
  onAcceptSummary,
  onDismissBio,
  onAcceptBio,
  onPickOption,
}: IntentMessageItemProps) {
  const rawText = collectMessageText(message);
  const isStreaming = busy && isLast && message.role === 'assistant';

  if (message.role === 'user') {
    return (
      <ChatBubble
        role="user"
        variant="paper"
        messageId={message.id}
        className="animate-in fade-in slide-in-from-bottom-1 duration-200"
      >
        {rawText}
      </ChatBubble>
    );
  }
  if (message.role !== 'assistant') return null;

  // 流式中先剃掉未闭合的半截 marker，避免露出原始标记
  const text = isStreaming ? stripPartialIntentBlocks(rawText) : rawText;
  const bio = extractIntentBio(text);
  const afterBio = bio ? bio.textWithoutBlock : text;
  const extracted = extractIntentSummary(afterBio);
  const afterSummary = extracted ? extracted.textWithoutBlock : afterBio;
  const optionHit = extractIntentOptions(afterSummary);
  const visibleText = optionHit ? optionHit.textWithoutBlock : afterSummary;

  // 卡片堆叠：bio 在上、goal 在下
  const footers: React.ReactNode[] = [];
  if (bio && !bioDismissed) {
    footers.push(
      <IntentBioCard
        key="bio"
        points={bio.points}
        saved={bioSaved}
        onDismiss={onDismissBio}
        onAccept={onAcceptBio}
      />,
    );
  }
  if (extracted && !summaryDismissed) {
    footers.push(
      <IntentSummaryCard
        key="summary"
        points={extracted.points}
        horizon={extracted.horizon}
        saved={summarySaved}
        onDismiss={onDismissSummary}
        onAccept={onAcceptSummary}
      />,
    );
  }
  // 果冻选项：只跟最新一条 AI 消息走，对话往前就消失
  if (optionHit && isLast && !busy) {
    footers.push(
      <IntentOptionChips key="options" options={optionHit.options} disabled={busy} onPick={onPickOption} />,
    );
  }
  // 兜底选项：模型没输出选项块时也保证能点选推进（有待确认卡片时不展示，避免干扰）
  const hasPendingCard = Boolean((bio && !bioDismissed) || (extracted && !summaryDismissed));
  if (!optionHit && isLast && !busy && !hasPendingCard && visibleText.trim()) {
    footers.push(
      <IntentOptionChips
        key="fallback-options"
        options={[COPY.intent.fallbackContinue, COPY.intent.fallbackWrapUp]}
        disabled={busy}
        onPick={onPickOption}
      />,
    );
  }
  const summaryFooter = footers.length > 0 ? <div className="flex flex-col gap-3">{footers}</div> : null;

  if (!visibleText.trim() && !summaryFooter) return null;

  return (
    <ChatBubble
      role="assistant"
      variant="paper"
      messageId={message.id}
      avatar={<OctoAvatar mood={isStreaming ? 'happy' : 'idle'} size="sm" aura={isStreaming} />}
      footer={summaryFooter}
      className="animate-in fade-in slide-in-from-bottom-1 duration-200"
    >
      {visibleText.trim() ? (
        <ChatRenderer content={visibleText} isStreaming={isStreaming} messageId={message.id} />
      ) : null}
    </ChatBubble>
  );
}

export default IntentMessageItem;
