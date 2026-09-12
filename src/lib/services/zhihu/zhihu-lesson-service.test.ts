import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/services/auth-service', () => ({ authService: {} }));
vi.mock('@/lib/services/workspace-service', () => ({ workspaceService: {} }));
vi.mock('@/lib/services/workspace-context-service', () => ({ workspaceContextService: {} }));
vi.mock('@/lib/services/web-article-extract-service', () => ({ extractWebArticle: vi.fn() }));
vi.mock('@/lib/services/teach-codex/thread-store', () => ({ createThread: vi.fn() }));

import { buildMaterialPack, buildZhihuLesson, excerptBudget, excerptOf, selectLessonMaterials, type ZhihuLessonDeps } from './zhihu-lesson-service';
import type { ZhihuCaptureMeta, ZhihuCaptureRecord } from './zhihu-import-service';

const NOW = 1_757_400_000_000;

function record(id: string, over: Partial<ZhihuCaptureMeta> & { text?: string | null; title?: string } = {}): ZhihuCaptureRecord {
  const { text, title, ...meta } = over;
  const zhihu: ZhihuCaptureMeta = {
    v: 1,
    kind: 'answer',
    url: `https://www.zhihu.com/question/1/answer/${id}`,
    title: title ?? `回答 ${id}`,
    author: '作者',
    authorUrl: null,
    voteUpCount: 10,
    commentCount: 1,
    favoriteCount: 5,
    createdAt: 1_700_000_000,
    favTime: 1_757_000_000,
    favlists: [{ urlToken: '111', title: '机器学习入门' }],
    body: 'summary',
    ...meta,
  };
  return {
    id,
    sourceKey: `zhihu:u1:${id}`,
    title: zhihu.title,
    previewText: '摘要',
    normalizedText: text === undefined ? '这是摘要内容。' : text,
    sourceUrl: zhihu.url,
    occurredAt: new Date(NOW),
    zhihu,
  };
}

describe('挑材料与切节选', () => {
  it('按赞同排序、只留有正文可讲的、超出上限的与视频想法进 skipped', () => {
    const records = [
      record('low', { voteUpCount: 3 }),
      record('video', { kind: 'zvideo', voteUpCount: 999 }),
      record('pin', { kind: 'pin' }),
      record('empty', { voteUpCount: 500, text: '' }),
      record('high', { voteUpCount: 300 }),
      record('mid', { voteUpCount: 100, kind: 'article' }),
    ];
    const { chosen, skipped } = selectLessonMaterials(records, 2);
    expect(chosen.map((r) => r.id)).toEqual(['high', 'mid']);
    expect(skipped).toEqual([
      { sourceId: 'video', title: '回答 video', reason: '视频没有可讲的正文' },
      { sourceId: 'pin', title: '回答 pin', reason: '想法没有可讲的正文' },
      { sourceId: 'empty', title: '回答 empty', reason: '连摘要都没有' },
      { sourceId: 'low', title: '回答 low', reason: '这节课最多讲 2 篇，按赞同排在后面' },
    ]);
    expect(selectLessonMaterials(records, 99).chosen).toHaveLength(3); // 上限夹到 8，这里只有 3 篇可讲
  });

  it('预算前 3 篇 1800、接着 1200、其余 700；节选尽量按段落切并标注', () => {
    expect([0, 2, 3, 5, 6, 20].map(excerptBudget)).toEqual([1800, 1800, 1200, 1200, 700, 700]);
    const short = '很短的一段。';
    expect(excerptOf(short, 100)).toBe(short);
    const para = `${'第一段讲定义。'.repeat(10)}\n\n${'第二段讲例子。'.repeat(10)}\n\n${'第三段讲推导。'.repeat(10)}`;
    const cut = excerptOf(para, 160);
    expect(cut.endsWith('……（节选，全文见原链接）')).toBe(true);
    expect(cut).toContain('第一段讲定义。');
    const kept = cut.replace('\n……（节选，全文见原链接）', '');
    expect(kept.endsWith('。')).toBe(true); // 在句号处切，不切半句
    expect(kept.length).toBeLessThanOrEqual(160);
    // 段落边界太靠前（<60% 预算）时按预算硬切，不至于只剩一小截
    const noBreak = 'A'.repeat(1000);
    expect(excerptOf(noBreak, 300).length).toBeLessThan(330);
  });

  it('有小标题的长文按结构节选：开头 + 每个小标题及首段 + 结尾，中间略标出，预算内', () => {
    const sections = ['模型训练目标', '权重惩罚是一种可行的办法', 'L2 正则化的几何意义', '在 PyTorch 里怎么写', '回顾训练过程中的数学表达式'];
    const text = [
      '我是石溪，这篇回答选自我的专栏。'.repeat(3),
      ...sections.flatMap((h, i) => [`## ${h}`, `${h}的第一段讲的是要点${i}。`.repeat(6), `${h}的第二段是展开细节。`.repeat(8), `${h}的第三段是例子。`.repeat(8)]),
      '这样就非常轻松地完成了权重惩罚的构造过程，这就是全文的结论。',
    ].join('\n\n');
    expect(text.length).toBeGreaterThan(2000);
    const cut = excerptOf(text, 1800);
    expect(cut.length).toBeLessThanOrEqual(1800 + 60);
    for (const h of sections) expect(cut).toContain(`## ${h}`);
    expect(cut).toContain('模型训练目标的第一段');
    expect(cut).toContain('## 结尾');
    expect(cut).toContain('全文的结论');
    expect(cut).toContain('（本节其余略）'); // 三段的小节只带前两段
    expect(cut).not.toContain('第三段是例子');
    expect(cut.endsWith('……（按结构节选：开头、各小节首段与结尾；全文见原链接）')).toBe(true);
  });

  it('没有小标题或只有一个时退回从头切', () => {
    const plain = `${'第一段讲定义。'.repeat(40)}\n\n${'第二段讲例子。'.repeat(40)}`;
    expect(excerptOf(plain, 200).endsWith('……（节选，全文见原链接）')).toBe(true);
    const oneHeading = `## 唯一的标题\n\n${'正文。'.repeat(200)}`;
    expect(excerptOf(oneHeading, 200).endsWith('……（节选，全文见原链接）')).toBe(true);
  });

  it('材料包：引用 id 顺序、正文状态决定预算、元信息一行、skipped 原样带出', () => {
    const chosen = [
      record('a', { body: 'full', voteUpCount: 300, text: '正'.repeat(2500) }),
      record('b', { body: 'summary', voteUpCount: 100, text: '摘'.repeat(900) }),
    ];
    const pack = buildMaterialPack({ title: '机器学习入门', chosen, skipped: [{ sourceId: 'v', title: '视频', reason: 'x' }], now: NOW });
    expect(pack).toMatchObject({ v: 1, source: 'zhihu-favlist', title: '机器学习入门', createdAt: new Date(NOW).toISOString() });
    expect(pack.items.map((i) => i.ref)).toEqual(['A1', 'A2']);
    expect(pack.items[0]).toMatchObject({ body: 'full', sourceId: 'a', meta: '回答 · 赞同 300 · 评论 1 · 2025-09-04 收藏' });
    expect(pack.items[0].excerpt.length).toBeLessThanOrEqual(1800 + 20);
    expect(pack.items[1]).toMatchObject({ body: 'summary' });
    expect(pack.items[1].excerpt.length).toBeLessThanOrEqual(400 + 20);
    expect(pack.skipped).toEqual([{ sourceId: 'v', title: '视频', reason: 'x' }]);
  });
});

describe('buildZhihuLesson', () => {
  function deps(records: ZhihuCaptureRecord[], afterMaterialize?: ZhihuCaptureRecord[]) {
    const calls: Record<string, unknown[]> = { materialize: [], createThread: [], write: [] };
    let listCount = 0;
    const d: Partial<ZhihuLessonDeps> = {
      listCaptures: async (_userId, opts) => {
        listCount++;
        if (opts?.ids && afterMaterialize) return afterMaterialize.filter((r) => opts.ids!.includes(r.id));
        return records;
      },
      materialize: async (_userId, ids) => {
        calls.materialize.push(ids);
        return ids.map((id) => ({ captureId: id, status: 'full' as const, bodyChars: 999 }));
      },
      createThread: (async (params: Record<string, unknown>) => {
        calls.createThread.push(params);
        return { id: 'thread-1', title: String(params.topic).slice(0, 30), topic: String(params.topic), engine: 'live', model: 'm', codexThreadId: null, learnerJson: null, status: 'active', createdAt: new Date(), updatedAt: new Date() };
      }) as never,
      writeMaterials: async (threadId, pack) => {
        calls.write.push({ threadId, items: pack.items.length });
      },
      priorLessons: async (_userId, materialsTitle) => (materialsTitle === '机器学习入门' ? [{ threadId: 't0', title: '模型为什么会「背题」', topic: '机器学习入门', materialsTitle, itemCount: 2, createdAt: '2026-09-11T00:00:00.000Z', updatedAt: '2026-09-11T00:00:00.000Z' }] : []),
      providerModel: () => 'glm-test',
      now: () => NOW,
    };
    return { d, calls, listCount: () => listCount };
  }

  it('只给进材料包且还没正文的抽正文；课题默认取收藏夹名；线程 engine=live 且材料落盘', async () => {
    const records = [record('full', { body: 'full', voteUpCount: 500, text: '全文'.repeat(300) }), record('sum', { voteUpCount: 200 }), record('video', { kind: 'zvideo' })];
    const after = [records[0], { ...records[1], normalizedText: '抽到的全文'.repeat(100), zhihu: { ...records[1].zhihu, body: 'full' as const } }];
    const { d, calls } = deps(records, after);
    const result = await buildZhihuLesson('u1', { favlistUrlToken: '111' }, d);

    expect(calls.materialize).toEqual([['sum']]);
    expect(calls.createThread[0]).toMatchObject({ topic: '机器学习入门', engine: 'live', model: 'glm-test', learner: null });
    expect(calls.write).toEqual([{ threadId: 'thread-1', items: 2 }]);
    expect(result.thread).toEqual({ id: 'thread-1', title: '机器学习入门', topic: '机器学习入门' });
    expect(result.pack.items.map((i) => [i.ref, i.body])).toEqual([['A1', 'full'], ['A2', 'full']]);
    expect(result.pack.skipped).toEqual([{ sourceId: 'video', title: '回答 video', reason: '视频没有可讲的正文' }]);
    expect(result.materialized).toEqual([{ captureId: 'sum', status: 'full', bodyChars: 999 }]);
    // 同一收藏夹之前上过的课写进材料包（老师据此不从头讲同一段）
    expect(result.pack.priorLessons).toEqual([{ threadId: 't0', title: '模型为什么会「背题」', createdAt: '2026-09-11T00:00:00.000Z' }]);
  });

  it('显式课题优先；抽正文失败的仍以摘要进包；没有可讲内容报错', async () => {
    const records = [record('sum', { voteUpCount: 200 })];
    const { d, calls } = deps(records, records); // materialize 后仍是摘要
    const result = await buildZhihuLesson('u1', { captureIds: ['sum'], topic: '  过拟合专题  ', learner: { v: 1 } as never }, d);
    expect(calls.createThread[0]).toMatchObject({ topic: '过拟合专题', learner: { v: 1 } });
    expect(result.pack.items[0].body).toBe('summary');
    expect(result.pack.priorLessons).toHaveLength(1); // 之前的课按材料组（收藏夹）匹配，不按这次的课题

    await expect(buildZhihuLesson('u1', {}, d)).rejects.toMatchObject({ code: 'favlist_not_found' });
    const { d: empty } = deps([]);
    await expect(buildZhihuLesson('u1', { favlistUrlToken: '1' }, empty)).rejects.toMatchObject({ code: 'favlist_not_found' });
    const { d: onlyVideo } = deps([record('v', { kind: 'zvideo' })]);
    await expect(buildZhihuLesson('u1', { favlistUrlToken: '1' }, onlyVideo)).rejects.toMatchObject({ message: expect.stringContaining('视频或想法') });
  });
});
