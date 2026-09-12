import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/services/llm-service', () => ({ chat: vi.fn() }));
vi.mock('@/lib/config/app.config', () => ({ ModelDefaults: { tutorQuick: 'quick-model', workshop: 'workshop-model' } }));

import { applyVerdict, buildJudgePrompt, judgeContinueReading, type ChatFn } from './zhihu-continue-judge';
import type { ContinueReadingGroup, ZhihuDiscoveryCandidate } from './zhihu-discovery-service';

function cand(i: number, over: Partial<ZhihuDiscoveryCandidate> = {}): ZhihuDiscoveryCandidate {
  return {
    title: `候选 ${i}`,
    url: `https://www.zhihu.com/answer/${i}`,
    snippet: `候选 ${i} 的摘要：讲了正则化为什么有用`,
    contentType: 'Answer',
    author: `作者${i}`,
    authorityLevel: 2,
    voteUpCount: 100 * i,
    commentCount: 1,
    featuredComments: i === 1 ? ['反对：这个解释不对'] : [],
    editTime: 0,
    score: 8,
    reason: `有一定权威 · ${100 * i} 赞同`,
    ...over,
  };
}

const group: ContinueReadingGroup = { concept: '正则化', candidates: [cand(1), cand(2), cand(3), cand(4)] };

describe('buildJudgePrompt / applyVerdict', () => {
  it('prompt 带缺口概念、课题、已读标题、候选元信息与精选评论；要求只输出 JSON', () => {
    const messages = buildJudgePrompt('正则化', group.candidates, { topic: '机器学习入门', materialTitles: ['过拟合到底是什么？'] });
    const system = String(messages[0].content);
    const user = String(messages[1].content);
    expect(system).toContain('「正则化」上还没稳');
    expect(system).toContain('「机器学习入门」');
    expect(system).toContain('《过拟合到底是什么？》');
    expect(system).toContain('只输出 JSON');
    expect(user).toContain('1. 《候选 1》（回答 · 作者 作者1 · 权威等级 2/4 · 赞同 100）');
    expect(user).toContain('评论区：反对：这个解释不对');
    expect(user).toContain('4. 《候选 4》');
  });

  it('verdict：按编号取、越界 / 重复 / 非法丢掉、理由裁到 60 字；空的返回 null', () => {
    const picked = applyVerdict(group.candidates, { picks: [{ index: 3, reason: '  用例子讲清了 λ 太大会欠拟合  ' }, { index: 3, reason: 'dup' }, { index: 9, reason: 'x' }, { index: 1, reason: '' }] }, 2);
    expect(picked?.map((c) => c.title)).toEqual(['候选 3', '候选 1']);
    expect(picked?.[0].reason).toBe('用例子讲清了 λ 太大会欠拟合');
    expect(picked?.[1].reason).toBe('有一定权威 · 100 赞同'); // 空理由保留元数据理由
    expect(applyVerdict(group.candidates, { picks: [] }, 2)).toBeNull();
    expect(applyVerdict(group.candidates, null, 2)).toBeNull();
    expect(applyVerdict(group.candidates, { picks: 'bad' } as never, 2)).toBeNull();
  });
});

describe('judgeContinueReading', () => {
  it('模型挑出的替换候选顺序与理由；模型输出坏 JSON 或超时时退回前 N 条元数据理由；候选不足 2 条不叫模型', async () => {
    const calls: string[] = [];
    const chatFn: ChatFn = async (messages, modelId) => {
      calls.push(modelId);
      const system = String(messages[0].content);
      if (system.includes('「早停」')) return { content: 'not json at all' };
      if (system.includes('「交叉验证」')) return new Promise(() => undefined); // 永不返回 → 超时
      return { content: JSON.stringify({ picks: [{ index: 4, reason: '摘要里直接对比了 L1 和 L2 的几何形状' }, { index: 2, reason: '有一个可视化的例子' }] }) };
    };
    const groups: ContinueReadingGroup[] = [
      group,
      { concept: '早停', candidates: [cand(5), cand(6), cand(7)] },
      { concept: '交叉验证', candidates: [cand(8), cand(9), cand(10)] },
      { concept: '只有一条', candidates: [cand(11)] },
    ];
    const out = await judgeContinueReading(groups, { topic: '机器学习入门' }, { chatFn, perConcept: 2, timeoutMs: 50 });

    expect(out[0].candidates.map((c) => [c.title, c.reason])).toEqual([
      ['候选 4', '摘要里直接对比了 L1 和 L2 的几何形状'],
      ['候选 2', '有一个可视化的例子'],
    ]);
    expect(out[1].candidates.map((c) => c.title)).toEqual(['候选 5', '候选 6']); // 坏 JSON → 前 2 条
    expect(out[1].candidates[0].reason).toBe('有一定权威 · 500 赞同');
    expect(out[2].candidates.map((c) => c.title)).toEqual(['候选 8', '候选 9']); // 超时 → 前 2 条
    expect(out[3].candidates).toHaveLength(1);
    expect(calls).toHaveLength(3); // 只有一条的组没叫模型
    expect(calls.every((m) => m === 'quick-model')).toBe(true);
    // 不改入参
    expect(group.candidates).toHaveLength(4);
  });
});
