import { describe, expect, it } from 'vitest';
import { composeAskOpening } from './global-ask-opening';
import type { DeskGroup } from './global-ask-desk';

const desk: DeskGroup[] = [
  { id: 'reading', title: '正在读', items: [
    { id: 'reading:current-lesson', label: 'AI 场景上下文应用', meta: '这节课', prompt: '帮我讲清《AI 场景上下文应用》里最难的地方' },
    { id: 'reading:m1', label: '能听懂这段，说明已经跟了大部分英语学习', prompt: '帮我讲清《能听懂这段…》里最难的地方' },
  ] },
  { id: 'moments', title: '你标的', items: [
    { id: 'moment:a', label: '00:30 · My name is Jane', meta: '没跟上', prompt: '00:30「My name is Jane」那里我没跟上，从这讲一下', tone: 'vermilion' },
    { id: 'moment:b', label: '01:12 · You see', meta: '没跟上', prompt: '01:12「You see」那里我没跟上，从这讲一下', tone: 'vermilion' },
    { id: 'moment:c', label: '02:05', meta: '重点', prompt: '02:05 那里老师强调的是什么？帮我讲透' },
  ] },
  { id: 'unstable', title: '还没稳', items: [
    { id: 'concept:lp', label: '线性规划的建模', meta: '还没稳', prompt: '再讲一遍「线性规划的建模」，换一个新的例子', tone: 'vermilion' },
  ] },
  { id: 'memory', title: '记得', items: [
    { id: 'memory:1', label: '关注线性规划的建模与转化能力', meta: '在学', prompt: '围绕「关注线性规划的建模与转化能力」，我现在该学什么？' },
  ] },
];

const render = (parts: ReturnType<typeof composeAskOpening>['parts']) => parts.map((p) => p.text).join('');

describe('composeAskOpening', () => {
  it('有当前课：刚听完《课》。你在 00:30、01:12 等 3 处停过——最多两句，书名与时间点可点', () => {
    const opening = composeAskOpening({ desk, fallbackStarters: ['通用句'], depth: 'quick', canStartDemo: false });
    expect(render(opening.parts)).toBe('刚听完《AI 场景上下文应用》。你在 00:30、01:12 等 3 处停过。');
    expect(opening.parts.filter((p) => p.kind === 'lesson')).toHaveLength(1);
    expect(opening.parts.filter((p) => p.kind === 'stamp').map((p) => p.text)).toEqual(['00:30', '01:12']);
    expect(opening.parts.find((p) => p.kind === 'stamp')?.prompt).toContain('00:30');
    expect(opening.empty).toBe(false);
  });

  it('两句用完后，还没稳的概念退到「可以从这里开始」；开口里点到的不再重复；最多 3 条', () => {
    const opening = composeAskOpening({ desk, fallbackStarters: ['通用句 A', '通用句 B'], depth: 'quick', canStartDemo: false });
    const prompts = opening.starters.map((s) => s.prompt);
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toBe('02:05 那里老师强调的是什么？帮我讲透'); // 开口里没念到的第三个时刻
    expect(prompts).not.toContain('帮我讲清《AI 场景上下文应用》里最难的地方');
    expect(prompts).not.toContain('00:30「My name is Jane」那里我没跟上，从这讲一下');
  });

  it('没有当前课：上次是《…》；之前卡在「…」；有学习线索时第一条是接着上次的', () => {
    const opening = composeAskOpening({
      desk: [
        { id: 'recent', title: '最近', items: [{ id: 'recent:1', label: '线性规划：从业务问题到数学建模', prompt: '接着《线性规划…》，我哪里还没懂？' }] },
        { id: 'memory', title: '记得', items: [{ id: 'memory:c', label: '对偶问题', meta: '上次没弄明白', prompt: '再讲一遍「对偶问题」，上次没弄明白', tone: 'vermilion' }] },
      ],
      activeThread: { title: '线性规划：从业务问题到数学建模', intent: '我想搞懂线性规划建模', status: 'active' },
      fallbackStarters: [],
      depth: 'quick',
      canStartDemo: false,
    });
    expect(render(opening.parts)).toBe('上次是《线性规划：从业务问题到数学建模》。你之前卡在「对偶问题」。');
    expect(opening.starters[0]).toMatchObject({ id: 'thread', prompt: '我想搞懂线性规划建模' });
    expect(opening.starters[0].text).toContain('接着上次的');
  });

  it('什么都没读到：诚实说，并按有无试听入口给出口', () => {
    const guest = composeAskOpening({ desk: [], fallbackStarters: ['帮我解释刚才课堂里最难的概念'], depth: 'quick', canStartDemo: true });
    expect(guest.empty).toBe(true);
    expect(render(guest.parts)).toBe('我还没读到你的课。直接问也行，或者先试听一节示例课。');
    const user = composeAskOpening({ desk: [], fallbackStarters: [], depth: 'quick', canStartDemo: false });
    expect(render(user.parts)).toContain('先上一节课');
  });

  it('深度模式：开口相同，「从这里开始」只用有根的深度句（不把课堂 chip 当深度目标）', () => {
    const opening = composeAskOpening({ desk, fallbackStarters: ['我想系统学懂线性规划，并检验自己是否真的会了'], depth: 'deep', canStartDemo: false });
    expect(render(opening.parts)).toContain('刚听完《AI 场景上下文应用》');
    expect(opening.starters.map((s) => s.text)).toEqual(['我想系统学懂线性规划，并检验自己是否真的会了']);
  });
});
