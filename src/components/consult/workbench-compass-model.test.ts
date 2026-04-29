import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { deriveConsultWorkbench } from './workbench-compass-model';

function tool(name: string, input: unknown = {}, output?: unknown) {
  return {
    type: `tool-${name}`,
    toolCallId: `t-${name}`,
    state: output === undefined ? 'input-available' : 'output-available',
    input,
    output,
  };
}

describe('deriveConsultWorkbench', () => {
  it('does not duplicate a lightweight consultant move in the top workbench', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '我只有背景，不知道怎么走' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          tool('readProfile', { keys: ['cv'] }, { profile: {} }),
          tool('showConsultantMove', {
            title: '先定路线变量',
            read: '学生只有背景，目标还未确定',
            move: '先问一个高杠杆问题',
            actions: [{ id: 'route', label: '帮我定路线' }],
          }),
        ],
      },
    ] as UIMessage[];

    const state = deriveConsultWorkbench(messages);

    expect(state.visible).toBe(false);
    expect(state.stage).toBe('顾问判断');
    expect(state.title).toBe('先定路线变量');
  });

  it('keeps advisor exploration volatile instead of treating it as locked intent', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '想申请 Stanford NLP，怎么联系 Percy Liang' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          tool('readProfile', { keys: ['cv'] }, { profile: {} }),
          tool('webSearch', { query: 'Percy Liang CRFM recent papers' }, { citations: [{ title: 'CRFM', url: 'https://example.com' }] }),
          tool('showAdvisorDiscovery', {
            title: 'Percy Liang 值不值得先联系',
            read: '先判断 fit，不把 Percy 当成已锁定目标',
            candidates: [
              { name: 'Percy Liang', status: 'mentioned', why: '学生提到过，但还在探索' },
            ],
            actions: [{ id: 'search-more', label: '再查近期论文' }],
          }),
        ],
      },
    ] as UIMessage[];

    const state = deriveConsultWorkbench(messages);

    expect(state.stage).toBe('导师探索');
    expect(state.title).toBe('Percy Liang 值不值得先联系');
    expect(state.note).toContain('导师仍是探索对象');
    expect(state.signals).toContainEqual({ label: '来源', value: '1 条已核对' });
    expect(state.nextActions).toEqual([{ id: 'search-more', label: '再查近期论文' }]);
  });

  it('keeps askOptions in the message body instead of duplicating it in the top workbench', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: '帮我规划申请' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          tool('showConsultantMove', { title: '先定档次', read: '目标跨度大', move: '先选策略' }, { ok: true }),
          tool('askOptions', {
            prompt: '目标学校更倾向哪一档？',
            choices: [
              { id: 'reach', label: '冲刺顶尖' },
              { id: 'balanced', label: '混合策略' },
            ],
          }),
        ],
      },
    ] as UIMessage[];

    const state = deriveConsultWorkbench(messages, true);

    expect(state.visible).toBe(false);
    expect(state.status).toBe('working');
    expect(state.stage).toBe('关键选择');
    expect(state.title).toBe('目标学校更倾向哪一档？');
    expect(state.atoms).toEqual(expect.arrayContaining(['judgment', 'interaction']));
    expect(state.nextActions.map((action) => action.label)).toEqual(['冲刺顶尖', '混合策略']);
  });
});
