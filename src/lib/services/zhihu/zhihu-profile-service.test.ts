import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/services/learning-observation-service', () => ({ recordLearningObservation: vi.fn() }));

import { buildZhihuProfileObservation, collectZhihuProfileFacts, recordZhihuProfileObservation, resetProfileThrottle } from './zhihu-profile-service';
import type { ZhihuOpenClient } from './zhihu-open-client';

const favlists = [
  { urlToken: '1', url: 'u', title: '机器学习入门', description: '从零开始', isPublic: false },
  { urlToken: '2', url: 'u', title: 'deeplearning', description: '', isPublic: true },
];
const recent = [
  { title: '过拟合到底是什么？', url: 'https://www.zhihu.com/question/1/answer/2', summary: '', contentType: 'answer', createdAt: 0, likeCount: 1, commentCount: 0, favoriteCount: 0, favTime: 0, favlists: [], author: { name: '石溪', urlToken: 's', url: '', gender: 0, headline: '' } },
  { title: '', url: 'https://zhuanlan.zhihu.com/p/3', summary: '只有摘要的一条想法内容', contentType: 'pin', createdAt: 0, likeCount: 1, commentCount: 0, favoriteCount: 0, favTime: 0, favlists: [], author: null },
];
const followees = [{ fullname: '王喆', urlToken: 'w', url: '', avatarUrl: '', headline: '深度学习推荐系统作者', gender: 0, followerCount: 1 }];
const answers = [{ contentType: 'answer', url: '', createdAt: 0, likeCount: 12, commentCount: 0, favoriteCount: 0, title: '如何入门 PyTorch？', summary: '' }];

describe('buildZhihuProfileObservation', () => {
  it('四段事实各一句、有来源与日期、不下判断、≤900 字；全空返回空串', () => {
    const text = buildZhihuProfileObservation({ favlists, recent, followees, answers, articles: [] }, new Date('2026-09-12T10:00:00+08:00'));
    expect(text.startsWith('知乎账号里的学习痕迹（2026-09-12 同步，来源：本人授权的知乎开放平台数据）。')).toBe(true);
    expect(text).toContain('收藏夹 2 个：「机器学习入门」（私密）：从零开始、「deeplearning」。');
    expect(text).toContain('最近收藏：《过拟合到底是什么？》（回答，石溪）；《只有摘要的一条想法内容》（想法）。');
    expect(text).toContain('关注的作者：王喆（深度学习推荐系统作者）。');
    expect(text).toContain('自己写过：《如何入门 PyTorch？》（回答，赞同 12）。');
    expect(text).not.toMatch(/初学者|水平|擅长/);
    expect(text.length).toBeLessThanOrEqual(900);
    expect(buildZhihuProfileObservation({ favlists: [], recent: [], followees: [], answers: [], articles: [] })).toBe('');
  });
});

describe('collectZhihuProfileFacts / recordZhihuProfileObservation', () => {
  it('子接口失败只少一段；写成 activity 事件 + zhihu.profile 观察，幂等键按天；24h 内第二次不写', async () => {
    resetProfileThrottle();
    const client = {
      userFavlists: vi.fn(async () => ({ items: favlists })),
      recentCollections: vi.fn(async () => ({ items: recent })),
      userFollowees: vi.fn(async () => {
        throw new Error('quota');
      }),
      userContents: vi.fn(async (opts: { contentType: string }) => ({ items: opts.contentType === 'answer' ? answers : [], paging: {} })),
    } as unknown as ZhihuOpenClient;

    const facts = await collectZhihuProfileFacts(client, {}, { recent });
    expect(facts.followees).toEqual([]);
    expect(facts.answers).toHaveLength(1);
    expect(client.recentCollections).not.toHaveBeenCalled(); // 传入的最近收藏被复用，不再花额度

    const record = vi.fn(async () => ({ eventId: 'e1', receipt: null }));
    let clock = new Date('2026-09-12T10:00:00+08:00').getTime();
    const now = () => clock;
    const wrote = await recordZhihuProfileObservation('u1', {}, { recent }, { client, record, now });
    expect(wrote).toBe(true);
    const input = record.mock.calls[0][1] as { appId: string; type: string; payload: { kind: string; detail: string }; idempotencyKey: string; observation: { type: string; content: string; locator: string } };
    expect(input.appId).toBe('zhihu');
    expect(input.type).toBe('activity');
    expect(input.payload.kind).toBe('capture');
    expect(input.payload.detail).toBe('收藏夹 2 个 · 最近收藏 2 条 · 关注 0 人 · 创作 1 篇');
    expect(input.idempotencyKey).toBe('zhihu-profile:u1:2026-09-12');
    expect(input.observation.type).toBe('zhihu.profile');
    expect(input.observation.content).toContain('「机器学习入门」');

    clock += 60 * 60 * 1000;
    expect(await recordZhihuProfileObservation('u1', {}, { recent }, { client, record, now })).toBe(false);
    expect(record).toHaveBeenCalledTimes(1);

    // record 抛错也不外抛
    resetProfileThrottle('u2');
    const boom = vi.fn(async () => {
      throw new Error('db down');
    });
    expect(await recordZhihuProfileObservation('u2', {}, { recent }, { client, record: boom, now })).toBe(false);
  });
});
