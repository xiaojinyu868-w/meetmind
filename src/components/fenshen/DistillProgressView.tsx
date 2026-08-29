'use client';

/**
 * DistillProgressView — 账本式蒸馏进度（distill-progress 事件流）。
 *
 * 可折叠、默认收起：异步为主，通知到位即可。视觉用 copy-in 的 AI Elements
 * Tool 容器（折叠 + 状态徽章），内容区是编号进展列表。
 * 铁律：skill 内容不进 UI——这里渲染的是服务端文案化后的动作流水（note）。
 */

import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import { COPY } from '@/lib/ui/copy';
import type { DistillProgressEntry } from './fenshen-events';

interface DistillProgressViewProps {
  entries: DistillProgressEntry[];
  /** 蒸馏完成（ego-ready 已到） */
  done: boolean;
}

export function DistillProgressView({ entries, done }: DistillProgressViewProps) {
  if (entries.length === 0) return null;
  return (
    <Tool defaultOpen={false} className="mb-0 shadow-none">
      <ToolHeader
        type="tool-distill"
        state={done ? 'output-available' : 'input-available'}
        title={COPY.fenshen.progressLedger(entries.length)}
      />
      <ToolContent>
        <ol className="max-h-48 space-y-1.5 overflow-y-auto px-4 pb-3">
          {entries.map((entry, index) => (
            <li key={entry.id} className="flex gap-2 text-[12px] leading-relaxed text-ink-secondary">
              <span className="shrink-0 font-mono text-ink-muted">{index + 1}.</span>
              <span>{entry.note}</span>
            </li>
          ))}
        </ol>
      </ToolContent>
    </Tool>
  );
}
