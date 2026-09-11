import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  workspaceCapture: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock, prisma: prismaMock }));
vi.mock('@/lib/services/auth-service', () => ({ authService: {} }));
vi.mock('@/lib/services/workspace-service', () => ({ workspaceService: {} }));
vi.mock('@/lib/services/workspace-context-service', () => ({ workspaceContextService: { upsertCaptureForUser: vi.fn() } }));
vi.mock('@/lib/services/web-article-extract-service', () => ({ extractWebArticle: vi.fn() }));

import {
  captureInputFromCollectionItem,
  importFavlist,
  listFavlistsForUser,
  materializeCaptures,
  parseZhihuMeta,
  resolveZhihuIdentity,
  ZhihuImportError,
  zhihuSourceKey,
  type ZhihuCaptureMeta,
  type ZhihuImportDeps,
} from './zhihu-import-service';
import { createZhihuOpenClient } from './zhihu-open-client';
import type { ZhihuConfig } from '@/lib/config/zhihu.config';

const NOW = 1_757_400_000_000;
const config: ZhihuConfig = {
  enabled: true,
  accessSecret: 'secret',
  oauth: { appId: '1', appKey: 'k', redirectUri: 'https://zhihu.meetmind.online/cb' },
  apiBaseUrl: 'https://developer.zhihu.com',
  oauthBaseUrl: 'https://openapi.zhihu.com',
  timeoutMs: 1000,
  zhidaTimeoutMs: 1000,
  selfModeUserIds: ['demo-user'],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const FAVLISTS = { Code: 0, Data: { Items: [{ UrlToken: 111, Url: 'https://www.zhihu.com/collection/111', Title: '机器学习入门', Description: '', IsPublic: true }] } };
function contentsPage(offset: string, items: Array<Record<string, unknown>>, isEnd: boolean, nextOffset?: string) {
  return { Code: 0, Data: { Items: items, Paging: { IsEnd: isEnd, NextOffset: nextOffset, Totals: 3 } } };
}
const ITEM_A = {
  ContentType: 'answer',
  Url: 'https://www.zhihu.com/question/1/answer/2?utm_medium=openapi_platform&utm_source=x',
  CreatedAt: 1_700_000_000,
  FavTime: 1_757_000_000,
  LikeCount: 120,
  CommentCount: 8,
  FavoriteCount: 300,
  Title: '过拟合到底是什么？',
  Summary: '过拟合指模型在训练集上表现很好但泛化差……',
  Favlists: [{ UrlToken: 111, Title: '机器学习入门', Url: 'https://www.zhihu.com/collection/111' }],
  Author: { Name: '张三', UrlToken: 'zhang-san', Url: 'https://www.zhihu.com/people/zhang-san', Gender: 0, Headline: '' },
};
const ITEM_B = { ...ITEM_A, Url: 'https://zhuanlan.zhihu.com/p/21407711', ContentType: 'article', Title: 'CS231n 反向传播笔记', Favlists: [], Author: undefined };
const ITEM_VIDEO = { ...ITEM_A, Url: 'https://www.zhihu.com/zvideo/12345', ContentType: 'zvideo', Title: '一个视频', Favlists: [] };

function fakeClient(pages: Record<string, unknown>) {
  const seen: string[] = [];
  const client = createZhihuOpenClient({
    config,
    now: () => NOW,
    fetchImpl: async (url, init) => {
      const u = new URL(url);
      seen.push(`${u.pathname}?${u.searchParams.toString()}|oauth=${(init.headers as Record<string, string>)['X-OAuth-Token'] ?? '-'}`);
      if (u.pathname.endsWith('/user/favlists')) return jsonResponse(FAVLISTS);
      if (u.pathname.endsWith('/user/favlist_contents')) {
        const offset = u.searchParams.get('Offset') ?? '0';
        return jsonResponse(pages[offset] ?? contentsPage(offset, [], true));
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  return { client, seen };
}

function depsWith(overrides: Partial<ZhihuImportDeps>): Partial<ZhihuImportDeps> & { upserts: Array<{ userId: string; input: Record<string, unknown> }> } {
  const upserts: Array<{ userId: string; input: Record<string, unknown> }> = [];
  return {
    upserts,
    config,
    now: () => NOW,
    getIdentity: async () => ({ providerId: 'zhang-san', oauthToken: 'tok', expiresAt: new Date(NOW + 60_000), expired: false }),
    upsertCapture: async (userId, input) => {
      upserts.push({ userId, input: input as unknown as Record<string, unknown> });
      return {
        workspace: { id: 'ws' } as never,
        capture: {
          id: `cap-${upserts.length}`,
          sourceKey: input.sourceKey,
          sourceType: input.sourceType,
          status: 'active',
          role: input.role,
          contentType: input.contentType,
          title: input.title,
          previewText: input.previewText,
          normalizedText: input.normalizedText,
          sourceUrl: input.sourceUrl,
          occurredAt: input.occurredAt,
        } as never,
      } as never;
    },
    ...overrides,
  };
}

beforeEach(() => {
  prismaMock.workspaceCapture.findMany.mockReset();
  prismaMock.workspaceCapture.findUnique.mockReset();
  prismaMock.workspaceCapture.update.mockReset();
});

describe('纯函数', () => {
  it('sourceKey 按用户 + canonical URL 生成，utm 与尾斜杠不影响', () => {
    const a = zhihuSourceKey('u1', 'https://www.zhihu.com/question/1/answer/2?utm_source=x&utm_medium=y');
    const b = zhihuSourceKey('u1', 'https://www.zhihu.com/question/1/answer/2/');
    const c = zhihuSourceKey('u2', 'https://www.zhihu.com/question/1/answer/2');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^zhihu:u1:[0-9a-f]{16}$/);
  });

  it('收藏条目 → capture 输入：摘要进正文位、contentState=partial、metadata.zhihu 齐全、utm 去掉', () => {
    const client = createZhihuOpenClient({ config, fetchImpl: async () => jsonResponse(contentsPage('0', [ITEM_A], true)) });
    return client.favlistContents({ favlistUrlToken: '111' }).then(({ items }) => {
      const input = captureInputFromCollectionItem('u1', items[0], null);
      expect(input.sourceType).toBe('zhihu-favorite');
      expect(input.sourceUrl).toBe('https://www.zhihu.com/question/1/answer/2');
      expect(input.title).toBe('过拟合到底是什么？');
      expect(input.normalizedText).toBe(ITEM_A.Summary);
      expect(input.occurredAt).toBe(new Date(1_757_000_000 * 1000).toISOString());
      const zhihu = input.metadata.zhihu as ZhihuCaptureMeta;
      expect(zhihu).toMatchObject({ v: 1, kind: 'answer', body: 'summary', author: '张三', voteUpCount: 120, favlists: [{ urlToken: '111', title: '机器学习入门' }] });
      const provenance = input.metadata.provenance as Record<string, unknown>;
      expect(provenance).toMatchObject({ ingressChannel: 'system', platformId: 'zhihu', platformLabel: '知乎', contentState: 'partial', extractionMethod: 'zhihu-api-summary', author: '张三' });
      expect(parseZhihuMeta(JSON.stringify(input.metadata))).toEqual(zhihu);
      expect(parseZhihuMeta('{"zhihu":{"v":2}}')).toBeNull();
      expect(parseZhihuMeta('not json')).toBeNull();
    });
  });

  it('条目本身没带收藏夹信息时，用当前导入的收藏夹补上', async () => {
    const client = createZhihuOpenClient({ config, fetchImpl: async () => jsonResponse(contentsPage('0', [ITEM_B], true)) });
    const { items } = await client.favlistContents({ favlistUrlToken: '111' });
    const input = captureInputFromCollectionItem('u1', items[0], { urlToken: '111', url: '', title: '机器学习入门', description: '', isPublic: true });
    expect((input.metadata.zhihu as ZhihuCaptureMeta).favlists).toEqual([{ urlToken: '111', title: '机器学习入门' }]);
    expect((input.metadata.zhihu as ZhihuCaptureMeta).kind).toBe('article');
    expect((input.metadata.zhihu as ZhihuCaptureMeta).author).toBeNull();
  });
});

describe('身份', () => {
  it('已绑定且未过期 → oauth；过期 → reconnect；未绑定的白名单用户 → self；其他 → not_connected；关掉 → disabled', async () => {
    const { client } = fakeClient({});
    const oauth = await resolveZhihuIdentity('u1', depsWith({ client }));
    expect(oauth).toMatchObject({ mode: 'oauth', identity: { oauthToken: 'tok' } });

    await expect(
      resolveZhihuIdentity('u1', depsWith({ client, getIdentity: async () => ({ providerId: 'x', oauthToken: 'tok', expiresAt: new Date(NOW - 1), expired: true }) })),
    ).rejects.toMatchObject({ code: 'zhihu_reconnect' });

    const self = await resolveZhihuIdentity('demo-user', depsWith({ client, getIdentity: async () => null }));
    expect(self).toEqual({ mode: 'self', identity: {}, expiresAt: null });

    await expect(resolveZhihuIdentity('stranger', depsWith({ client, getIdentity: async () => null }))).rejects.toBeInstanceOf(ZhihuImportError);
    await expect(resolveZhihuIdentity('u1', depsWith({ client, config: { ...config, enabled: false } }))).rejects.toMatchObject({ code: 'zhihu_disabled' });
  });

  it('收藏夹列表按身份带 / 不带 X-OAuth-Token', async () => {
    const oauth = fakeClient({});
    await listFavlistsForUser('u1', depsWith({ client: oauth.client }));
    expect(oauth.seen[0]).toContain('oauth=tok');

    const self = fakeClient({});
    const result = await listFavlistsForUser('demo-user', depsWith({ client: self.client, getIdentity: async () => null }));
    expect(self.seen[0]).toContain('oauth=-');
    expect(result).toMatchObject({ mode: 'self', favlists: [{ urlToken: '111', title: '机器学习入门' }] });
  });
});

describe('importFavlist', () => {
  it('翻页拉全、每条 upsert、返回 capture 记录；limit 生效', async () => {
    const { client, seen } = fakeClient({
      '0': contentsPage('0', [ITEM_A, ITEM_B], false, '2'),
      '2': contentsPage('2', [ITEM_VIDEO], true),
    });
    const deps = depsWith({ client });
    const result = await importFavlist('u1', '111', {}, deps);
    expect(result.favlist?.title).toBe('机器学习入门');
    expect(result.fetched).toBe(3);
    expect(result.imported).toBe(3);
    expect(deps.upserts.map((u) => u.input.sourceUrl)).toEqual([
      'https://www.zhihu.com/question/1/answer/2',
      'https://zhuanlan.zhihu.com/p/21407711',
      'https://www.zhihu.com/zvideo/12345',
    ]);
    expect(result.captures[2].zhihu.kind).toBe('zvideo');
    expect(seen.filter((s) => s.includes('favlist_contents'))).toHaveLength(2);
    expect(seen.find((s) => s.includes('Offset=2'))).toBeTruthy();

    const limited = fakeClient({ '0': contentsPage('0', [ITEM_A, ITEM_B], false, '2') });
    const limitedDeps = depsWith({ client: limited.client });
    const r2 = await importFavlist('u1', '111', { limit: 2 }, limitedDeps);
    expect(r2.fetched).toBe(2);
    expect(limited.seen.filter((s) => s.includes('favlist_contents'))).toHaveLength(1);
  });
});

describe('materializeCaptures', () => {
  const baseMeta: ZhihuCaptureMeta = {
    v: 1, kind: 'answer', url: 'https://www.zhihu.com/question/1/answer/2', title: '过拟合到底是什么？', author: '张三', authorUrl: null,
    voteUpCount: 120, commentCount: 8, favoriteCount: 300, createdAt: 1_700_000_000, favTime: 1_757_000_000, favlists: [], body: 'summary',
  };
  const row = (id: string, meta: ZhihuCaptureMeta) => ({
    id, sourceKey: `zhihu:u1:${id}`, title: meta.title, previewText: '摘要', normalizedText: '摘要', sourceUrl: meta.url, occurredAt: new Date(NOW), metadataJson: JSON.stringify({ zhihu: meta, provenance: { ingressChannel: 'system', contentState: 'partial' } }),
  });
  const ANSWER_PAGE = [
    '# 过拟合到底是什么？', '', '[查看全部 3 个回答](https://www.zhihu.com/question/1)', '', '[张三](https://www.zhihu.com/people/zhang-san)', '', '签名', '', '\u200b 关注', '',
    '过拟合的本质是模型把训练数据里的噪声也学了进去，正则化、早停、数据增强都是在限制它的记忆力。'.repeat(8), '', '[编辑于2025-01-01 10:00](https://www.zhihu.com/question/1/answer/2)', '', '\u200b赞同 120\u200b\u200b8 条评论',
  ].join('\n');

  it('抽正文成功 → upsert 成 complete/full；视频跳过；抽取失败 → 留摘要并把失败写进 metadata.zhihu', async () => {
    prismaMock.workspaceCapture.findMany.mockResolvedValue([
      row('a', baseMeta),
      row('v', { ...baseMeta, kind: 'zvideo', url: 'https://www.zhihu.com/zvideo/1' }),
      row('f', { ...baseMeta, url: 'https://www.zhihu.com/question/9/answer/9' }),
    ]);
    prismaMock.workspaceCapture.findUnique.mockResolvedValue({ metadataJson: JSON.stringify({ zhihu: baseMeta, provenance: { ingressChannel: 'system', contentState: 'partial' }, keep: 1 }) });
    prismaMock.workspaceCapture.update.mockResolvedValue({});

    const deps = depsWith({
      client: fakeClient({}).client,
      extract: async (url: string) => {
        if (url.includes('/answer/9')) throw new Error('Firecrawl 503');
        return { title: '过拟合到底是什么？ - 知乎', content: ANSWER_PAGE, extractMethod: 'firecrawl', sourceUrl: url, provider: 'zhihu', providerLabel: '知乎', wordCount: 1 } as never;
      },
    });
    const results = await materializeCaptures('u1', ['a', 'v', 'f'], { concurrency: 2 }, deps);

    expect(results.map((r) => [r.captureId, r.status])).toEqual([['a', 'full'], ['v', 'unsupported'], ['f', 'failed']]);
    expect(results[0].cleanConfident).toBe(true);
    expect(deps.upserts).toHaveLength(1);
    const upserted = deps.upserts[0].input;
    expect(upserted.sourceKey).toBe('zhihu:u1:a');
    expect(String(upserted.normalizedText).startsWith('过拟合的本质')).toBe(true);
    expect((upserted.metadata as Record<string, unknown>).provenance).toMatchObject({ contentState: 'complete', extractionMethod: 'firecrawl+zhihu-page-clean', completeness: 1 });
    expect((upserted.metadata as Record<string, unknown>).zhihu).toMatchObject({ body: 'full', cleanConfident: true, editedAt: '2025-01-01 10:00', extractedAt: new Date(NOW).toISOString() });

    expect(prismaMock.workspaceCapture.update).toHaveBeenCalledTimes(1);
    const failedMeta = JSON.parse(prismaMock.workspaceCapture.update.mock.calls[0][0].data.metadataJson);
    expect(failedMeta.keep).toBe(1);
    expect(failedMeta.zhihu).toMatchObject({ body: 'summary', extractError: 'Firecrawl 503', extractFailedAt: new Date(NOW).toISOString() });
  });

  it('已是全文的不再抽（除非 force）；找不到的 capture 报错', async () => {
    prismaMock.workspaceCapture.findMany.mockResolvedValue([row('a', { ...baseMeta, body: 'full', cleanConfident: false })]);
    const extract = vi.fn();
    const deps = depsWith({ client: fakeClient({}).client, extract: extract as never });
    const results = await materializeCaptures('u1', ['a'], {}, deps);
    expect(results[0]).toMatchObject({ status: 'already-full', cleanConfident: false });
    expect(extract).not.toHaveBeenCalled();

    await expect(materializeCaptures('u1', ['a', 'missing'], {}, deps)).rejects.toMatchObject({ code: 'capture_not_found' });
  });
});
