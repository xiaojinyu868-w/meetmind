'use client';

import React, { useCallback } from 'react';

interface IntentBubbleExplorerProps {
  transcriptText: string;
  onSend: (prompt: string, meta?: { role: string; intent: string }) => void;
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
      });
    },
    [onSend, preferSupportContext]
  );

  return (
    <div className="mx-auto flex w-full max-w-[430px] flex-col gap-2 px-1 py-1.5">
      <div className="rounded-[20px] border border-slate-200/80 bg-white/88 px-3.5 py-3 shadow-[0_10px_24px_rgba(148,163,184,0.06)]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-semibold text-slate-900">
            {preferSupportContext ? '可以顺着刚选内容继续' : '可以直接开始问'}
          </p>
          <span className="text-[12px] text-slate-400">可选，不想点也可以直接输入</span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {STARTER_INTENTS.map((intent) => (
            <button
              key={intent.id}
              type="button"
              disabled={!hasContext}
              onClick={() => handleStart(intent)}
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-medium text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {intent.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
