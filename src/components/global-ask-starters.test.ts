import { describe, expect, it } from 'vitest';
import type { LearningActivityEntry, LearningMemoryEntry } from '@/types/user';
import { buildGlobalAskStarters, describeGlobalAskContext } from './global-ask-starters';

const lesson: LearningActivityEntry = { id: 'a1', kind: 'lesson', title: '贝叶斯定理入门', occurredAt: '2026-09-08T00:00:00Z' };
const appActivity: LearningActivityEntry = { id: 'a2', kind: 'app', title: '闪卡训练', occurredAt: '2026-09-08T01:00:00Z' };
const challenge: LearningMemoryEntry = {
  id: 'm1', kind: 'challenge', title: '先验和后验总是分不清', status: 'active', source: 'ai', createdAt: '', updatedAt: '',
};

describe('buildGlobalAskStarters', () => {
  it('有当前课堂转录：先点名这节课，再带上未过去的困惑；最多两条', () => {
    const out = buildGlobalAskStarters({
      depth: 'quick',
      currentMaterialTitles: ['当前课堂转录'],
      recentActivities: [lesson, appActivity],
      memories: [challenge],
    });
    expect(out).toEqual(['帮我讲清这节课里最难的地方', '再讲一遍「先验和后验总是分不清」，上次没弄明白']);
  });

  it('当前是一份资料：点名资料；没有困惑时接最近一节课', () => {
    const out = buildGlobalAskStarters({
      depth: 'quick',
      currentMaterialTitles: ['从工具到协作者：基于意图域重塑人机协同新范式'],
      recentActivities: [lesson],
      memories: [],
    });
    expect(out[0]).toBe('帮我讲清《从工具到协作者：基于意图域重塑人机…》里最难的地方');
    expect(out[1]).toBe('接着《贝叶斯定理入门》，我哪里还没懂？');
  });

  it('什么都没有：退回通用句；深度模式围绕最近课堂', () => {
    expect(buildGlobalAskStarters({ depth: 'quick', currentMaterialTitles: [], recentActivities: [], memories: [] }))
      .toEqual(['帮我解释刚才课堂里最难的概念', '把这份材料和我最近学的内容连起来']);
    const deep = buildGlobalAskStarters({ depth: 'deep', currentMaterialTitles: [], recentActivities: [lesson], memories: [] });
    expect(deep[0]).toBe('围绕《贝叶斯定理入门》，帮我系统学懂并检验是否真的会了');
    expect(deep).toHaveLength(2);
  });
});

describe('describeGlobalAskContext', () => {
  it('只有一份当前材料时点名，多份回退计数', () => {
    expect(describeGlobalAskContext({ currentMaterialTitles: ['贝叶斯定理入门'], recentCount: 3, memoryCount: 0 }))
      .toBe('会带上《贝叶斯定理入门》，还有 3 条最近学习');
    expect(describeGlobalAskContext({ currentMaterialTitles: ['a', 'b'], recentCount: 0, memoryCount: 2 }))
      .toBe('会参考 2 份当前内容、2 条长期理解');
    expect(describeGlobalAskContext({ currentMaterialTitles: [], recentCount: 0, memoryCount: 0 }))
      .toBe('这次先从你的问题开始');
  });
});
