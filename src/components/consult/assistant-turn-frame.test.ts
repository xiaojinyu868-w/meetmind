import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { summarizeAssistantTurn } from './assistant-turn-summary';

function assistant(parts: UIMessage['parts']): UIMessage {
  return { id: 'a1', role: 'assistant', parts } as UIMessage;
}

describe('summarizeAssistantTurn', () => {
  it('summarizes the latest meaningful UI tool instead of raw text', () => {
    const summary = summarizeAssistantTurn(assistant([
      { type: 'text', text: '我先判断一下。' },
      {
        type: 'tool-showAdvisorDiscovery',
        toolCallId: 't1',
        state: 'input-available',
        input: {
          title: 'Percy Liang 外联前判断',
          read: '学生还在探索导师，不应锁定。',
        },
      },
    ]));

    expect(summary).toEqual({
      label: '导师探索',
      title: 'Percy Liang 外联前判断',
      detail: '学生还在探索导师，不应锁定。',
    });
  });

  it('falls back to a compact first sentence for prose-only turns', () => {
    const summary = summarizeAssistantTurn(assistant([
      { type: 'text', text: '好的，我先帮你判断目标。然后再决定要不要查导师。' },
    ]));

    expect(summary.label).toBe('文字回复');
    expect(summary.title).toBe('好的，我先帮你判断目标。');
  });
});
