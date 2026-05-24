import { describe, expect, it } from 'vitest';
import { resolveTutorMessageRenderPlan } from './tutor-message-rendering';

describe('resolveTutorMessageRenderPlan', () => {
  it('renders assistant review answers as markdown so GFM tables are not shown as raw pipe text', () => {
    const plan = resolveTutorMessageRenderPlan({
      role: 'assistant',
      text: '| 位置 | 核心任务 |\n|---|---|\n| 前卫 | 把球送出去 |',
    });

    expect(plan.renderer).toBe('markdown');
    expect(plan.content).toContain('| 位置 | 核心任务 |');
  });

  it('keeps user messages as plain text', () => {
    expect(resolveTutorMessageRenderPlan({ role: 'user', text: '**不要渲染**' }).renderer).toBe('plain');
  });

  it('strips open_app marker before markdown rendering', () => {
    const plan = resolveTutorMessageRenderPlan({ role: 'assistant', text: '好。\n<open_app:mindmap/>' });

    expect(plan.renderer).toBe('markdown');
    expect(plan.content).toBe('好。');
  });
});
