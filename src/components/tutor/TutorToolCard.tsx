/**
 * Tutor 消息流中内嵌的 Workshop 工具调用卡片（M5 T3.4 / T5.5）
 *
 * Vercel AI SDK v6 的 `useChat` 会把 tool-call 帧以 `part.type = 'tool-<toolName>'` 形式渲染。
 * 这个组件只负责"嵌入对话流"的精简形态；点开可扩展成 FlashcardsWindow / MindmapWindow。
 *
 * 状态文案 / 工具名映射 / 提取函数放在 tutor-tool-card-utils.ts（方便 vitest 纯逻辑测）。
 *
 * Taste: 平涂、克制、不打扰对话节奏。只在成功/失败时有极淡的状态色。
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  readableToolName,
  statusText,
  type TutorToolPartLike,
  type TutorToolState,
} from './tutor-tool-card-utils';

export type { TutorToolPartLike, TutorToolState } from './tutor-tool-card-utils';
export { extractToolParts } from './tutor-tool-card-utils';

export interface TutorToolCardProps {
  part: TutorToolPartLike;
  onExpand?: (part: TutorToolPartLike) => void;
  className?: string;
}

export function TutorToolCard({ part, onExpand, className }: TutorToolCardProps) {
  const toolTitle = readableToolName(part.type);
  const state = part.state ?? (part.output ? 'output-available' : 'input-available');
  const isOk = state === 'output-available' && part.output?.ok !== false;
  const isError = state === 'output-error' || part.output?.ok === false;
  const isPending = state === 'input-streaming' || state === 'input-available';

  const error = part.errorText ?? part.output?.error;

  return (
    <div
      className={cn(
        'my-2 rounded-lg border px-3 py-2 text-sm transition-colors',
        isPending && 'border-divider bg-paper-warm text-ink-secondary',
        isOk && 'border-pine/15 bg-pine-fog text-ink',
        isError && 'border-vermilion/15 bg-vermilion-mist/40/50 text-vermilion-deep',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-ink-muted text-xs">
            {isPending && '·'}
            {isOk && '✓'}
            {isError && '!'}
          </span>
          <span>{statusText(state, toolTitle, error)}</span>
        </div>
        {isOk && onExpand ? (
          <button
            type="button"
            onClick={() => onExpand(part)}
            className="text-xs text-ink-muted hover:text-ink-secondary underline-offset-2 hover:underline"
          >
            展开
          </button>
        ) : null}
      </div>

      {/* lookupTranscript 特殊渲染：直接在气泡内展示 3 条匹配 */}
      {isOk && part.type === 'tool-lookupTranscript' && Array.isArray(part.output?.matches) ? (
        <ul className="mt-2 space-y-1 text-xs text-ink-secondary">
          {part.output.matches.slice(0, 3).map((m, idx) => {
            const match = m as { text: string; citation?: string };
            return (
              <li key={idx} className="flex gap-2">
                {match.citation ? (
                  <span className="shrink-0 text-ink-muted">{match.citation}</span>
                ) : null}
                <span>{match.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
