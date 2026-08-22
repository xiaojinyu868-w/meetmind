'use client';

/**
 * CheckpointPanel — checkpoint 等待态按钮组（我会了 / 给我提示 / 看解析）。
 *
 * 粉笔描边小按钮，板面内右下、字幕区上方（不遮字幕不压板书）；
 * 文案走 COPY.apps.explainer。
 */

import { COPY } from '@/lib/ui/copy';
import type { CheckpointState } from './board-checkpoint';
import { waitButtons } from './board-checkpoint';

interface CheckpointPanelProps {
  state: CheckpointState;
  onKnow(): void;
  onHint(): void;
  onShowAnswer(): void;
}

const BUTTON_LABELS = {
  know: COPY.apps.explainer.checkpointKnow,
  hint: COPY.apps.explainer.checkpointHint,
  show_answer: COPY.apps.explainer.checkpointAnswer,
} as const;

export function CheckpointPanel({ state, onKnow, onHint, onShowAnswer }: CheckpointPanelProps) {
  const handlers = { know: onKnow, hint: onHint, show_answer: onShowAnswer } as const;
  return (
    <div
      style={{
        position: 'absolute',
        right: 14,
        bottom: 46,
        display: 'flex',
        gap: 8,
        zIndex: 5,
      }}
    >
      {waitButtons(state).map((button) => (
        <button
          key={button}
          type="button"
          onClick={handlers[button]}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.2,
            color: 'rgba(245,242,232,0.9)',
            background: 'rgba(245,242,232,0.08)',
            border: '1px solid rgba(245,242,232,0.3)',
            cursor: 'pointer',
          }}
        >
          {BUTTON_LABELS[button]}
        </button>
      ))}
    </div>
  );
}
