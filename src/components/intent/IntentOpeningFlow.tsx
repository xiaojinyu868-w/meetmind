'use client';

/**
 * IntentOpeningFlow —— 「聊聊你想要的」的开场问题流（Elys 式输入体验）。
 *
 * 问句是一条 AI 气泡，用户的回答是一条用户气泡——三个固定问题像聊天一样
 * 一来一回，不是一张表单。首次会面走三步固定选择题（身份 → 分支阶段 →
 * 时间尺度，零 LLM 往返）；回访用户一句欢迎 + 画像快捷入口。
 */

import * as React from 'react';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { ChatBubble } from '@/components/chat';
import { IntentOptionChips } from './IntentOptionChips';

const SERIF_STYLE = { fontFamily: '"Instrument Serif", "Inter", serif' } as const;

export interface OpeningQuizQuestion {
  question: string;
  options: string[];
  /** 已答则为答案原文；null = 当前待答 */
  answer: string | null;
}

interface IntentOpeningFlowProps {
  mode: 'quiz' | 'returning';
  /** quiz 模式：问题流（最后一项 answer=null 即当前待答） */
  quizQuestions?: OpeningQuizQuestion[];
  /** returning 模式：欢迎语 + 快捷选项 */
  returningHint?: string;
  returningOptions?: string[];
  busy: boolean;
  onPick: (option: string) => void;
}

function AssistantTextBubble({
  text,
  footer,
}: {
  text: string;
  footer?: React.ReactNode;
}) {
  return (
    <ChatBubble
      role="assistant"
      variant="paper"
      avatar={<OctoAvatar mood="idle" size="sm" />}
      footer={footer}
      className="animate-in fade-in slide-in-from-bottom-1 duration-300"
    >
      <span className="text-[15.5px] leading-7" style={SERIF_STYLE}>{text}</span>
    </ChatBubble>
  );
}

export function IntentOpeningFlow({
  mode,
  quizQuestions,
  returningHint,
  returningOptions,
  busy,
  onPick,
}: IntentOpeningFlowProps) {
  if (mode === 'returning') {
    return (
      <AssistantTextBubble
        text={`欢迎回来。${returningHint ?? ''}`}
        footer={
          <IntentOptionChips options={returningOptions ?? []} onPick={onPick} disabled={busy} />
        }
      />
    );
  }

  const items = quizQuestions ?? [];
  return (
    <>
      <div className="flex flex-col items-center pb-2 pt-10 text-center">
        <OctoAvatar mood="listening" size="xl" aura />
        <p className="mt-5 px-6 text-[20px] leading-[1.7] text-ink" style={SERIF_STYLE}>
          我是 Octo。
        </p>
        <p className="mt-2 max-w-md px-6 text-[13.5px] leading-6 text-ink-secondary">
          先花十几秒认识你一下——点着答就行。
        </p>
      </div>
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          <AssistantTextBubble
            text={item.question}
            footer={
              item.answer === null && idx === items.length - 1 ? (
                <IntentOptionChips options={item.options} onPick={onPick} disabled={busy} />
              ) : undefined
            }
          />
          {item.answer !== null ? (
            <ChatBubble
              role="user"
              variant="paper"
              className="animate-in fade-in slide-in-from-bottom-1 duration-200"
            >
              {item.answer}
            </ChatBubble>
          ) : null}
        </React.Fragment>
      ))}
    </>
  );
}

export default IntentOpeningFlow;
