import { describe, it, expect } from 'vitest';
import { continueReading, reasonFor, scoreZhihuItem, searchZhihuCandidates, stripEm } from './zhihu-discovery-service';
import { createZhihuOpenClient } from './zhihu-open-client';
import type { ZhihuConfig } from '@/lib/config/zhihu.config';

const config: ZhihuConfig = {
  enabled: true,
  accessSecret: 'secret',
  oauth: { appId: '1', appKey: 'k', redirectUri: 'https://zhihu.meetmind.online/cb' },
  apiBaseUrl: 'https://developer.zhihu.com',
  oauthBaseUrl: 'https://openapi.zhihu.com',
  timeoutMs: 1000,
  zhidaTimeoutMs: 1000,
  selfModeUserIds: [],
};

function item(over: Record<string, unknown>) {
  return {
    Title: '标题',
    ContentType: 'Answer',
    ContentID: '1',
    ContentText: '摘要 <em>正则化</em> 是……',
    Url: 'https://www.zhihu.com/answer/1?utm_medium=openapi_platform&utm_source=x',
    CommentCount: 3,
    VoteUpCount: 10,
    AuthorName: '作者',
    AuthorAvatar: '',
    AuthorBadge: '',
    AuthorBadgeText: '',
    EditTime: 1_700_000_000,
    CommentInfoList: [],
    AuthorityLevel: '1',
    ...over,
  };
}

function clientWith(responder: (query: string) => Record<string, unknown>[]) {
  const queries: string[] = [];
  const client = createZhihuOpenClient({
    config,
    fetchImpl: async (url) => {
      const q = new URL(url).searchParams.get('Query') ?? '';
      queries.push(q);
      return new Response(JSON.stringify({ Code: 0, Data: { HasMore: false, Items: responder(q) } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  return { client, queries };
}

describe('评分与理由', () => {
  it('权威与赞同决定分数，上限 12；理由是人话', () => {
    expect(scoreZhihuItem({ authorityLevel: null, voteUpCount: 0, featuredComments: [] })).toBe(5);
    expect(scoreZhihuItem({ authorityLevel: 2, voteUpCount: 99, featuredComments: ['x'] })).toBe(10.5);
    expect(scoreZhihuItem({ authorityLevel: 4, voteUpCount: 100000, featuredComments: ['x'] })).toBe(12);
    expect(reasonFor({ authorityLevel: 3, voteUpCount: 1234, featuredComments: ['x'], contentType: 'Answer' })).toBe('高权威作者 · 1.2k 赞同 · 评论区有不同看法');
    expect(reasonFor({ authorityLevel: 1, voteUpCount: 3, featuredComments: [], contentType: 'Article' })).toBe('一篇成体系的文章');
    expect(reasonFor({ authorityLevel: null, voteUpCount: 60, featuredComments: [], contentType: 'Answer' })).toBe('60 赞同');
    expect(stripEm('a <em>b</em>  c')).toBe('a b c');
  });
});

describe('searchZhihuCandidates', () => {
  it('未配置时返回空不出网；正常时按分数排序、去 <em>、按 canonical 去重与排除', async () => {
    const disabled = createZhihuOpenClient({ config: { ...config, accessSecret: '' }, fetchImpl: async () => { throw new Error('should not fetch'); } });
    expect(await searchZhihuCandidates('过拟合', { client: disabled, config: { ...config, accessSecret: '' } })).toEqual([]);

    const { client } = clientWith(() => [
      item({ Title: '低', VoteUpCount: 1 }),
      item({ Title: '高', Url: 'https://www.zhihu.com/answer/2', AuthorityLevel: '3', VoteUpCount: 5000, CommentInfoList: [{ Content: '反对' }] }),
      item({ Title: '重复', Url: 'https://www.zhihu.com/answer/2?utm_source=y' }),
      item({ Title: '已在材料里', Url: 'https://zhuanlan.zhihu.com/p/9' }),
    ]);
    const candidates = await searchZhihuCandidates('过拟合', { client, config, excludeUrls: ['https://zhuanlan.zhihu.com/p/9?utm_medium=openapi_platform'] });
    expect(candidates.map((c) => c.title)).toEqual(['高', '低']);
    expect(candidates[0]).toMatchObject({ authorityLevel: 3, voteUpCount: 5000, snippet: '摘要 正则化 是……', reason: '高权威作者 · 5k 赞同 · 评论区有不同看法' });
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
  });

  it('太短的 query 不出网；上游错误宁可少推（返回空）', async () => {
    const { client, queries } = clientWith(() => []);
    expect(await searchZhihuCandidates('a', { client, config })).toEqual([]);
    expect(queries).toEqual([]);
    const failing = createZhihuOpenClient({ config, fetchImpl: async () => new Response(JSON.stringify({ Code: 30002, Message: 'quota' }), { status: 200 }) });
    expect(await searchZhihuCandidates('过拟合 正则化', { client: failing, config })).toEqual([]);
  });
});

describe('continueReading', () => {
  it('每个概念搜一次（≤3）、带课题、各留 perConcept 条、跨概念不重复链接', async () => {
    const { client, queries } = clientWith((q) => [
      item({ Title: `${q}-1`, Url: 'https://www.zhihu.com/answer/shared', VoteUpCount: 900 }),
      item({ Title: `${q}-2`, Url: `https://www.zhihu.com/answer/${encodeURIComponent(q)}`, VoteUpCount: 500 }),
      item({ Title: `${q}-3`, Url: `https://www.zhihu.com/answer/${encodeURIComponent(q)}-b`, VoteUpCount: 100 }),
    ]);
    const groups = await continueReading(
      { concepts: ['正则化', '早停', '正则化', '交叉验证', '第四个'], topic: '机器学习入门', excludeUrls: [], perConcept: 2 },
      { client, config },
    );
    expect(queries).toEqual(['正则化 机器学习入门', '早停 机器学习入门', '交叉验证 机器学习入门']);
    expect(groups.map((g) => g.concept)).toEqual(['正则化', '早停', '交叉验证']);
    expect(groups[0].candidates.map((c) => c.title)).toEqual(['正则化 机器学习入门-1', '正则化 机器学习入门-2']);
    // shared 链接已被第一个概念拿走，后面的组不再出现
    expect(groups[1].candidates.map((c) => c.url)).not.toContain('https://www.zhihu.com/answer/shared');
    expect(groups[1].candidates).toHaveLength(2);
  });
});
