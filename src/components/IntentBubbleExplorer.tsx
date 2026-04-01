'use client';

import React, { useCallback } from 'react';

interface IntentBubbleExplorerProps {
  transcriptText: string;
  onSend: (prompt: string, meta?: { role: string; intent: string; displayText?: string; hideBubble?: boolean }) => void;
  preferSupportContext?: boolean;
}

interface StarterIntent {
  id: string;
  label: string;
  prompt: (preferSupportContext: boolean) => string;
}

const buildContextPrefix = (preferSupportContext: boolean) =>
  preferSupportContext ? '顺着我刚圈出的内容继续，' : '围绕这节课当前的内容继续，';

const STARTER_INTENTS: StarterIntent[] = [
  {
    id: 'core',
    label: '先讲核心',
    prompt: (preferSupportContext) =>
      `${buildContextPrefix(preferSupportContext)}先用一句话说清楚核心结论，再拆开讲我最容易卡住的地方。`,
  },
  {
    id: 'example',
    label: '换成例子',
    prompt: (preferSupportContext) =>
      `${buildContextPrefix(preferSupportContext)}先给我一个最容易懂的例子或类比，再回到原内容解释。`,
  },
  {
    id: 'steps',
    label: '拆成步骤',
    prompt: (preferSupportContext) =>
      `${buildContextPrefix(preferSupportContext)}请把关键过程拆成 3 到 5 步，每一步只讲一个重点。`,
  },
  {
    id: 'summary',
    label: '提炼要点',
    prompt: (preferSupportContext) =>
      `${buildContextPrefix(preferSupportContext)}先帮我提炼 3 个最值得记住的要点，再给我一个最值得继续追问的问题。`,
  },
];

export default function IntentBubbleExplorer({
  transcriptText,
  onSend,
  preferSupportContext = false,
}: IntentBubbleExplorerProps) {
  const hasContext = transcriptText.trim().length > 0;

  const handleStart = useCallback(
    (intent: StarterIntent) => {
      onSend(intent.prompt(preferSupportContext), {
        role: preferSupportContext ? '已选内容' : '当前课堂',
        intent: intent.label,
        displayText: intent.label,
        hideBubble: true,
      });
    },
    [onSend, preferSupportContext]
  );

  return (
    <div className="mx-auto flex w-full max-w-[430px] flex-col gap-2 px-1 py-2">
      <div className="flex flex-wrap gap-2">
          {STARTER_INTENTS.map((intent) => (
            <button
              key={intent.id}
              type="button"
              disabled={!hasContext}
              onClick={() => handleStart(intent)}
              className="inline-flex min-h-10 items-center rounded-full border border-[#E9E9E7] bg-white px-4 py-2 text-[13px] font-medium text-[#232322] transition-colors hover:bg-[#F7F7F5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {intent.label}
            </button>
          ))}
      </div>
    </div>
  );
}
