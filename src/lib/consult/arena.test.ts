import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { evaluatePercyFlagshipCase, hasPercyFlagshipPrompt } from './arena';

function tool(name: string, input: unknown = {}, output?: unknown) {
  return {
    type: `tool-${name}`,
    toolCallId: `t-${name}`,
    state: output === undefined ? 'input-available' : 'output-available',
    input,
    output,
  };
}

describe('evaluatePercyFlagshipCase', () => {
  it('passes the intended agent-native Percy path', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '我想申请 Stanford NLP，帮我看看怎么联系 Percy Liang' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          tool('readProfile', { keys: ['cv', 'target_field'] }, { profile: {} }),
          tool('webSearch', { query: 'Percy Liang Stanford CRFM recent papers 2026' }, { citations: [{ title: 'CRFM', url: 'https://stanford.edu' }] }),
          tool('showAdvisorDiscovery', { title: 'Percy Liang 探索', read: '先判断是否值得联系' }),
          tool('showOutreachWorkspace', { title: 'Percy Liang 外联工作台' }),
        ],
      },
    ] as UIMessage[];

    const score = evaluatePercyFlagshipCase(messages, {
      advisor_candidates: [{ name: 'Percy Liang', school: 'Stanford', status: 'exploring' }],
    });

    expect(score.status).toBe('passed');
    expect(score.score).toBe(score.maxScore);
  });

  it('fails when Percy is locked into profile', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '我想申请 Stanford NLP，帮我看看怎么联系 Percy Liang' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          tool('webSearch', { query: 'Percy Liang Stanford recent papers' }, { citations: [{ title: 'x', url: 'https://example.com' }] }),
          tool('showAdvisorDiscovery', { title: '探索', read: '先看' }),
          tool('writeProfile', { patch: { advisor_candidates: [{ name: 'Percy Liang', school: 'Stanford', status: 'shortlisted' }] } }, { ok: true }),
        ],
      },
    ] as UIMessage[];

    const score = evaluatePercyFlagshipCase(messages);

    expect(score.status).toBe('failed');
    expect(score.criteria.find((c) => c.id === 'profile-not-locked')?.passed).toBe(false);
  });
});

describe('hasPercyFlagshipPrompt', () => {
  it('detects the flagship prompt from user turns', () => {
    expect(hasPercyFlagshipPrompt([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '想申请 Stanford，怎么联系 Percy Liang' }] },
    ] as UIMessage[])).toBe(true);
  });
});
