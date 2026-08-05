'use client';

import type { UIMessage } from 'ai';
import type { LearningIntentAnswer, LearningIntentPlan } from '@/types/learning-intent';
import { COPY } from '@/lib/ui/copy';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { LearningIntentConfirmationCard } from '@/components/LearningIntentConfirmationCard';
import {
  ChatAssistantActions,
  ChatBubble,
  ChatRenderer,
  ChatThinkingStripBubble,
  collectMessageText,
} from '@/components/chat';

interface GlobalAskMessagesProps {
  messages: UIMessage[];
  busy: boolean;
  userId?: string;
  pendingQuery: string;
  intentBusy: boolean;
  intentPlan: LearningIntentPlan | null;
  showThinking: boolean;
  hasError: boolean;
  onConfirmIntent: (plan: LearningIntentPlan) => void;
  onResolveIntent: (plan: LearningIntentPlan, answers: LearningIntentAnswer[]) => void;
  onCancelIntent: () => void;
  onRetry: () => void;
}

export function GlobalAskMessages({
  messages,
  busy,
  userId,
  pendingQuery,
  intentBusy,
  intentPlan,
  showThinking,
  hasError,
  onConfirmIntent,
  onResolveIntent,
  onCancelIntent,
  onRetry,
}: GlobalAskMessagesProps) {
  return (
    <>
      {messages.map((message, index) => {
        const text = collectMessageText(message);
        const isStreaming = busy && index === messages.length - 1 && message.role === 'assistant';
        const actions = message.role === 'assistant' && !isStreaming && text.trim()
          ? <ChatAssistantActions content={text} messageId={message.id} mode="global" userId={userId} />
          : undefined;
        return (
          <ChatBubble
            key={message.id}
            role={message.role === 'user' ? 'user' : 'assistant'}
            avatar={message.role === 'assistant' ? <OctoAvatar mood={isStreaming ? 'thinking' : 'happy'} size="sm" /> : undefined}
            messageId={message.id}
            actions={actions}
          >
            {message.role === 'assistant'
              ? <ChatRenderer content={text} isStreaming={isStreaming} messageId={message.id} />
              : <span className="whitespace-pre-wrap">{text}</span>}
          </ChatBubble>
        );
      })}
      {pendingQuery && !intentPlan ? (
        <ChatBubble role="user"><span className="whitespace-pre-wrap">{pendingQuery}</span></ChatBubble>
      ) : null}
      {intentBusy ? (
        <ChatThinkingStripBubble label={COPY.globalAsk.preparingIntent} avatar={<OctoAvatar mood="thinking" size="sm" aura />} />
      ) : null}
      {intentPlan ? (
        <LearningIntentConfirmationCard
          plan={intentPlan}
          busy={busy || intentBusy}
          onConfirm={onConfirmIntent}
          onResolve={(answers) => onResolveIntent(intentPlan, answers)}
          onCancel={onCancelIntent}
        />
      ) : null}
      {showThinking ? (
        <ChatThinkingStripBubble label={COPY.globalAsk.thinking} avatar={<OctoAvatar mood="thinking" size="sm" aura />} />
      ) : null}
      {hasError ? (
        <div className="rounded-xl border border-vermilion/15 bg-vermilion-fog px-4 py-3 text-[12.5px] text-vermilion">
          {COPY.globalAsk.responseError}
          <button type="button" onClick={onRetry} className="ml-3 underline decoration-vermilion/35 underline-offset-2 hover:decoration-vermilion">
            {COPY.chatActions.retry}
          </button>
        </div>
      ) : null}
    </>
  );
}
