import { describe, it, expect, vi } from 'vitest';
import { createZhihuOpenClient, parsePaging, ZhihuApiError } from './zhihu-open-client';
import type { ZhihuConfig } from '@/lib/config/zhihu.config';

// 夹具取自官方 zhihu skill v0.2.1 references/http-api.md / user-api.md / oauth.md 的响应示例（字段名与大小写原样）

const config: ZhihuConfig = {
  enabled: true,
  accessSecret: 'secret-abc',
  oauth: { appId: '12345', appKey: 'app-key-xyz', redirectUri: 'https://example.com/api/auth/zhihu/callback' },
  apiBaseUrl: 'https://developer.zhihu.com',
  oauthBaseUrl: 'https://openapi.zhihu.com',
  timeoutMs: 5_000,
  zhidaTimeoutMs: 5_000,
};

const NOW_MS = 1_757_400_000_123; // 2026-09-09 附近，秒级应为 1757400000

function jsonResponse(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': contentType },
  });
}

function setup(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    return responder(url, init);
  });
  const client = createZhihuOpenClient({ config, fetchImpl, now: () => NOW_MS });
  return { client, calls, fetchImpl };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

const SEARCH_SAMPLE = {
  Code: 0,
  Message: 'success',
  Data: {
    HasMore: false,
    SearchHashId: '1234567890',
    Items: [
      {
        Title: 'ChatGPT现在还值得开会员吗？',
        ContentType: 'Answer',
        ContentID: '1903044959663284716',
        ContentText: '首先要澄清一个常见误解：ChatGPT的免费版和付费版…',
        Url: 'https://www.zhihu.com/answer/1903044959663284716?utm_medium=openapi_platform&utm_source=6d23634e',
        CommentCount: 22,
        VoteUpCount: 18,
        AuthorName: '时光纪',
        AuthorAvatar: 'https://picx.zhimg.com/50/v2-84ce.jpg',
        AuthorBadge: '',
        AuthorBadgeText: '',
        EditTime: 1748355858,
        CommentInfoList: [{ Content: '没啥区别，免费也是4o' }, { Content: '免费版现在也可以用gpt4o啊' }],
        AuthorityLevel: '2',
        RankingScore: 0.98,
      },
      {
        Title: 'RAG 评测方法综述',
        ContentType: 'Article',
        ContentID: '123456789',
        ContentText: '本文介绍了主流 RAG 评测框架…',
        Url: 'https://zhuanlan.zhihu.com/p/123456789?utm_medium=openapi_platform&utm_source=6d23634e',
        CommentCount: 15,
        VoteUpCount: 128,
        AuthorName: '张三',
        AuthorAvatar: '',
        AuthorBadge: '',
        AuthorBadgeText: '',
        EditTime: 1710000000,
        CommentInfoList: [],
        AuthorityLevel: '9', // 越界值 → null
      },
    ],
  },
};

describe('zhihu-open-client · 请求构造', () => {
  it('带 Bearer / 秒级时间戳 / JSON 头，Query 编码，Count 夹到 1–10', async () => {
    const { client, calls } = setup(() => jsonResponse(SEARCH_SAMPLE));
    const result = await client.searchZhihu('怎么理解 rave 文化', { count: 50 });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url.origin + url.pathname).toBe('https://developer.zhihu.com/api/v1/content/zhihu_search');
    expect(url.searchParams.get('Query')).toBe('怎么理解 rave 文化');
    expect(url.searchParams.get('Count')).toBe('10');
    expect(init.method).toBe('GET');
    const headers = headersOf(init);
    expect(headers.Authorization).toBe('Bearer secret-abc');
    expect(headers['X-Request-Timestamp']).toBe('1757400000');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-OAuth-Token']).toBeUndefined();

    expect(result.hasMore).toBe(false);
    expect(result.searchHashId).toBe('1234567890');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      title: 'ChatGPT现在还值得开会员吗？',
      contentType: 'Answer',
      contentId: '1903044959663284716',
      voteUpCount: 18,
      authorName: '时光纪',
      authorityLevel: 2,
      rankingScore: 0.98,
    });
    expect(result.items[0].featuredComments).toEqual(['没啥区别，免费也是4o', '免费版现在也可以用gpt4o啊']);
    expect(result.items[1].authorityLevel).toBeNull();
    expect(result.items[1].rankingScore).toBeNull();
  });

  it('空 Query 在出网前就拒绝', async () => {
    const { client, fetchImpl } = setup(() => jsonResponse(SEARCH_SAMPLE));
    await expect(client.searchZhihu('   ')).rejects.toMatchObject({ kind: 'param' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('全网搜索透传 Filter / SearchDB，Count 夹到 1–20', async () => {
    const { client, calls } = setup(() => jsonResponse({ Code: 0, Data: { HasMore: true, Items: [] } }));
    const result = await client.searchGlobal('人工智能', {
      count: 99,
      filter: 'host=="example.com" AND publish_time>=1778494631',
      searchDb: 'realtime',
    });
    const { url } = calls[0];
    expect(url.pathname).toBe('/api/v1/content/global_search');
    expect(url.searchParams.get('Count')).toBe('20');
    expect(url.searchParams.get('Filter')).toBe('host=="example.com" AND publish_time>=1778494631');
    expect(url.searchParams.get('SearchDB')).toBe('realtime');
    expect(result.hasMore).toBe(true);
  });

  it('热榜 Limit 夹到 1–30，解析 Total 与空字段', async () => {
    const { client, calls } = setup(() =>
      jsonResponse({
        Code: 0,
        Data: {
          Total: 2,
          Items: [
            { Title: '如何评价某个热点问题？', Url: 'https://www.zhihu.com/question/123456789', ThumbnailUrl: 'https://pic1.zhimg.com/x.jpg', Summary: '摘要' },
            { Title: '一篇文章', Url: 'https://zhuanlan.zhihu.com/p/987654321', ThumbnailUrl: '', Summary: '' },
          ],
        },
      }),
    );
    const result = await client.hotList({ limit: 0 });
    expect(calls[0].url.searchParams.get('Limit')).toBe('30');
    expect(result.total).toBe(2);
    expect(result.items[1]).toEqual({ title: '一篇文章', url: 'https://zhuanlan.zhihu.com/p/987654321', thumbnailUrl: '', summary: '' });
  });

  it('未配置 Access Secret 时不出网直接报 auth', async () => {
    const fetchImpl = vi.fn();
    const client = createZhihuOpenClient({ config: { ...config, accessSecret: '' }, fetchImpl });
    await expect(client.hotList()).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('zhihu-open-client · 错误映射', () => {
  it.each([
    [10001, 'param', false],
    [20001, 'auth', false],
    [30001, 'rate_limit', false],
    [30002, 'quota', false],
    [90001, 'server', true],
  ])('HTTP 200 里 Code=%i → kind=%s', async (code, kind, retryable) => {
    const { client } = setup(() => jsonResponse({ Code: code, Message: `err ${code}`, Data: null }));
    const error = await client.hotList().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ZhihuApiError);
    expect(error).toMatchObject({ kind, code, endpoint: '/api/v1/content/hot_list', message: `err ${code}` });
    expect((error as ZhihuApiError).retryable).toBe(retryable);
  });

  it('HTTP 401 → auth，HTTP 503 → server（可重试）', async () => {
    const unauthorized = setup(() => jsonResponse('nope', 401, 'text/plain'));
    await expect(unauthorized.client.hotList()).rejects.toMatchObject({ kind: 'auth', status: 401 });

    const down = setup(() => jsonResponse('', 503, 'text/plain'));
    const error = await down.client.hotList().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'server', status: 503 });
    expect((error as ZhihuApiError).retryable).toBe(true);
  });

  it('响应不是 JSON → protocol；缺 Code → protocol', async () => {
    const html = setup(() => jsonResponse('<html>登录</html>', 200, 'text/html'));
    await expect(html.client.hotList()).rejects.toMatchObject({ kind: 'protocol' });

    const noCode = setup(() => jsonResponse({ Data: {} }));
    await expect(noCode.client.hotList()).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('fetch 抛错 → network', async () => {
    const client = createZhihuOpenClient({
      config,
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    await expect(client.hotList()).rejects.toMatchObject({ kind: 'network', message: 'ECONNRESET' });
  });
});

describe('zhihu-open-client · 用户数据', () => {
  const CONTENTS_SAMPLE = {
    Code: 0,
    Message: 'success',
    Data: {
      Items: [
        {
          ContentType: 'answer',
          Url: 'https://www.zhihu.com/question/1/answer/2',
          CreatedAt: 1750000000,
          LikeCount: 12,
          CommentCount: 3,
          FavoriteCount: 4,
          Title: '一个回答',
          Summary: '摘要…',
        },
      ],
      Paging: { IsEnd: false, NextOffset: '20', Totals: 57 },
    },
  };

  it('本人模式不带 X-OAuth-Token；ContentType 必填进 query；分页原样回传', async () => {
    const { client, calls } = setup(() => jsonResponse(CONTENTS_SAMPLE));
    const result = await client.userContents({ contentType: 'all', sortField: 'like_count', limit: 500 });
    const { url, init } = calls[0];
    expect(url.pathname).toBe('/api/v1/user/contents');
    expect(url.searchParams.get('ContentType')).toBe('all');
    expect(url.searchParams.get('SortField')).toBe('like_count');
    expect(url.searchParams.get('Offset')).toBe('0');
    expect(url.searchParams.get('Limit')).toBe('50');
    expect(headersOf(init)['X-OAuth-Token']).toBeUndefined();
    expect(result.items[0]).toMatchObject({ contentType: 'answer', likeCount: 12, title: '一个回答' });
    expect(result.paging).toEqual({ isEnd: false, nextOffset: '20', totals: 57 });
  });

  it('授权用户模式加 X-OAuth-Token，Access Secret 仍在 Bearer', async () => {
    const { client, calls } = setup(() => jsonResponse(CONTENTS_SAMPLE));
    await client.userContents({ contentType: 'answer', offset: '20' }, { oauthToken: 'user-token-1' });
    const headers = headersOf(calls[0].init);
    expect(headers.Authorization).toBe('Bearer secret-abc');
    expect(headers['X-OAuth-Token']).toBe('user-token-1');
    expect(calls[0].url.searchParams.get('Offset')).toBe('20');
  });

  it('收藏夹列表 / 收藏夹内容 / 近期收藏的字段归一', async () => {
    const { client, calls } = setup((url) => {
      if (url.includes('/user/favlists')) {
        return jsonResponse({
          Code: 0,
          Data: { Items: [{ UrlToken: 123456789, Url: 'https://www.zhihu.com/collection/123456789', Title: '机器学习入门', Description: '', IsPublic: true }] },
        });
      }
      if (url.includes('/user/favlist_contents')) {
        return jsonResponse({
          Code: 0,
          Data: {
            Items: [
              {
                ContentType: 'article',
                Url: 'https://zhuanlan.zhihu.com/p/21407711',
                CreatedAt: 1460000000,
                FavTime: 1757000000,
                LikeCount: 3000,
                CommentCount: 100,
                FavoriteCount: 9000,
                Title: 'CS231n课程笔记翻译：反向传播笔记',
                Summary: '译者注…',
                Favlists: [{ UrlToken: 123456789, Title: '机器学习入门', Url: 'https://www.zhihu.com/collection/123456789' }],
                Author: { Name: '杜客', UrlToken: 'du-ke', Url: 'https://www.zhihu.com/people/du-ke', Gender: 0, Headline: '' },
              },
            ],
            Paging: { IsEnd: true, Totals: 1 },
          },
        });
      }
      return jsonResponse({ Code: 0, Data: { Items: [{ ContentType: 'answer', Url: 'u', Title: 't', Summary: 's', Favlists: [] }] } });
    });

    const favlists = await client.userFavlists({ limit: 100 });
    expect(calls[0].url.searchParams.get('Limit')).toBe('50');
    expect(favlists.items[0]).toEqual({
      urlToken: '123456789',
      url: 'https://www.zhihu.com/collection/123456789',
      title: '机器学习入门',
      description: '',
      isPublic: true,
    });

    const contents = await client.favlistContents({ favlistUrlToken: favlists.items[0].urlToken });
    expect(calls[1].url.searchParams.get('FavlistUrlToken')).toBe('123456789');
    expect(contents.paging).toEqual({ isEnd: true, nextOffset: null, totals: 1 });
    expect(contents.items[0]).toMatchObject({
      contentType: 'article',
      favTime: 1757000000,
      favlists: [{ urlToken: '123456789', title: '机器学习入门', url: 'https://www.zhihu.com/collection/123456789' }],
      author: { name: '杜客', urlToken: 'du-ke' },
    });

    const recent = await client.recentCollections();
    expect(calls[2].url.pathname).toBe('/api/v1/user/collections');
    expect(recent.items[0].author).toBeNull();
    expect(recent.items[0].favlists).toEqual([]);
  });

  it('非法 FavlistUrlToken 不出网', async () => {
    const { client, fetchImpl } = setup(() => jsonResponse({ Code: 0, Data: {} }));
    await expect(client.favlistContents({ favlistUrlToken: 'abc' })).rejects.toMatchObject({ kind: 'param' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parsePaging：IsEnd=false 却没有合法 NextOffset → protocol，不静默截断', () => {
    expect(parsePaging({ IsEnd: true, Totals: 3 }, '/x')).toEqual({ isEnd: true, nextOffset: null, totals: 3 });
    expect(parsePaging({ IsEnd: false, NextOffset: 40, Totals: 3 }, '/x')).toEqual({ isEnd: false, nextOffset: '40', totals: 3 });
    expect(() => parsePaging({ IsEnd: false, NextOffset: '20abc' }, '/x')).toThrow(ZhihuApiError);
    expect(() => parsePaging({ IsEnd: false }, '/x')).toThrow(/NextOffset/);
    expect(parsePaging(undefined, '/x')).toEqual({ isEnd: true, nextOffset: null, totals: 0 });
  });
});

describe('zhihu-open-client · 直答', () => {
  it('POST Chat Completions，默认 fast 档，解析 content + reasoning_content', async () => {
    const { client, calls } = setup(() =>
      jsonResponse({
        id: 'chatcmpl-xxxx',
        object: 'chat.completion',
        model: 'zhida-fast-1p5',
        choices: [{ index: 0, message: { role: 'assistant', reasoning_content: '先分析…', content: 'Rave 文化…' }, finish_reason: 'stop' }],
      }),
    );
    const answer = await client.zhida([{ role: 'user', content: '怎么理解rave文化' }]);
    const { url, init } = calls[0];
    expect(url.origin + url.pathname).toBe('https://developer.zhihu.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'zhida-fast-1p5',
      messages: [{ role: 'user', content: '怎么理解rave文化' }],
      stream: false,
    });
    expect(answer).toEqual({ content: 'Rave 文化…', reasoning: '先分析…', model: 'zhida-fast-1p5', id: 'chatcmpl-xxxx' });
  });

  it('OpenAI 风格 error 信封 → ZhihuApiError', async () => {
    const { client } = setup(() =>
      jsonResponse({ error: { message: 'model not found', type: 'invalid_request_error', param: 'model', code: 'model_not_found' } }, 400),
    );
    await expect(client.zhida([{ role: 'user', content: 'x' }], { model: 'zhida-agent' })).rejects.toMatchObject({
      kind: 'param',
      code: 'model_not_found',
      message: 'model not found',
    });
  });
});

describe('zhihu-open-client · OAuth', () => {
  it('授权页 URL 带 redirect_uri / app_id / response_type=code / state', () => {
    const { client } = setup(() => jsonResponse({}));
    const url = new URL(client.buildAuthorizeUrl({ state: 'st-1' }));
    expect(url.origin + url.pathname).toBe('https://openapi.zhihu.com/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/api/auth/zhihu/callback');
    expect(url.searchParams.get('app_id')).toBe('12345');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('st-1');
  });

  it('回调优先取 authorization_code，兼容 code，空值返回 null', () => {
    const { client } = setup(() => jsonResponse({}));
    expect(client.extractAuthorizationCode(new URLSearchParams('authorization_code=abc&code=zzz'))).toBe('abc');
    expect(client.extractAuthorizationCode(new URLSearchParams('code=zzz'))).toBe('zzz');
    expect(client.extractAuthorizationCode({ authorization_code: '  ' })).toBeNull();
    expect(client.extractAuthorizationCode({})).toBeNull();
  });

  it('换 token：表单字段固定 grant_type=authorization_code，code 承载回调码；access_token 可嵌在 data 里', async () => {
    const { client, calls } = setup(() => jsonResponse({ code: 20000, data: { access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 } }));
    const token = await client.exchangeAuthorizationCode('auth-code-9');
    const { url, init } = calls[0];
    expect(url.toString()).toBe('https://openapi.zhihu.com/access_token');
    expect(init.method).toBe('POST');
    expect(headersOf(init)['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({
      app_id: '12345',
      app_key: 'app-key-xyz',
      grant_type: 'authorization_code',
      redirect_uri: 'https://example.com/api/auth/zhihu/callback',
      code: 'auth-code-9',
    });
    expect(token).toEqual({ accessToken: 'tok-1', tokenType: 'Bearer', expiresIn: 3600, expiresAt: NOW_MS + 3600 * 1000 });
  });

  it('换 token 顶层形状也认；没有 access_token → oauth 错误', async () => {
    const flat = setup(() => jsonResponse({ access_token: 'tok-2', token_type: 'Bearer', expires_in: 60 }));
    await expect(flat.client.exchangeAuthorizationCode('c')).resolves.toMatchObject({ accessToken: 'tok-2', expiresIn: 60 });

    const failed = setup(() => jsonResponse({ code: 40001, message: 'invalid code' }, 400));
    await expect(failed.client.exchangeAuthorizationCode('bad')).rejects.toMatchObject({ kind: 'oauth', code: 40001, message: 'invalid code' });
  });

  it('OAuth 三件套没配齐时不出网', async () => {
    const fetchImpl = vi.fn();
    const client = createZhihuOpenClient({ config: { ...config, oauth: { ...config.oauth, appKey: '' } }, fetchImpl });
    await expect(client.exchangeAuthorizationCode('c')).rejects.toMatchObject({ kind: 'oauth' });
    expect(() => createZhihuOpenClient({ config: { ...config, oauth: { ...config.oauth, redirectUri: '' } }, fetchImpl }).buildAuthorizeUrl()).toThrow(ZhihuApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('/user 资料尽力而为：带双凭证请求；失败返回 null 不抛', async () => {
    const ok = setup(() => jsonResponse({ code: 20000, data: { name: '小明', avatar_url: 'https://a/b.jpg', headline: '学生', url: 'https://www.zhihu.com/people/xm' } }));
    const profile = await ok.client.fetchOAuthProfile('tok-1');
    const headers = headersOf(ok.calls[0].init);
    expect(ok.calls[0].url.toString()).toBe('https://openapi.zhihu.com/user');
    expect(headers.Authorization).toBe('Bearer secret-abc');
    expect(headers['X-OAuth-Token']).toBe('tok-1');
    expect(profile).toEqual({ name: '小明', avatarUrl: 'https://a/b.jpg', headline: '学生', url: 'https://www.zhihu.com/people/xm' });

    const broken = setup(() => jsonResponse('<html/>', 500, 'text/html'));
    await expect(broken.client.fetchOAuthProfile('tok-1')).resolves.toBeNull();

    const empty = setup(() => jsonResponse({ code: 20000, data: {} }));
    await expect(empty.client.fetchOAuthProfile('tok-1')).resolves.toBeNull();
  });
});
