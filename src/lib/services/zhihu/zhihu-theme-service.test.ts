import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('@/lib/services/llm-service', () => ({ chat: vi.fn() }));
vi.mock('@/lib/config/app.config', () => ({ ModelDefaults: { tutorQuick: 'quick-model', workshop: 'workshop-model' } }));

import type { ZhihuCaptureRecord } from './zhihu-import-service';

let tmp: string;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zhihu-themes-'));
  process.env.ZHIHU_THEMES_DIR = path.relative(process.cwd(), tmp);
});
afterAll(async () => {
  delete process.env.ZHIHU_THEMES_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

function rec(id: string, title: string, over: Partial<ZhihuCaptureRecord['zhihu']> = {}, text = '正文'.repeat(100)): ZhihuCaptureRecord {
  return {
    id,
    sourceKey: `k-${id}`,
    title,
    previewText: `${title} 的摘要`,
    normalizedText: text,
    sourceUrl: `https://www.zhihu.com/question/1/answer/${id}`,
    occurredAt: null,
    zhihu: { v: 1, kind: 'answer', url: `https://www.zhihu.com/question/1/answer/${id}`, title, author: '甲', authorUrl: null, voteUpCount: 10, commentCount: 0, favoriteCount: 0, createdAt: 0, favTime: 0, favlists: [{ urlToken: '9', title: '收藏夹九' }], body: 'summary', ...over },
  };
}

describe('zhihu-theme-service', () => {
  it('prompt 用编号代替 id；normalize 把编号对回 id、一篇只属一条线、未知编号丢弃、没归线的进 misc、start 只能是可讲的', async () => {
    const { buildThemePrompt, normalizeThemes } = await import('./zhihu-theme-service');
    const records = [rec('a', '过拟合'), rec('b', 'L1 与 L2'), rec('c', '早停'), rec('v', '一个视频', { kind: 'zvideo' }), rec('d', '暑期工的想法', { kind: 'pin' })];
    const { messages, alias } = buildThemePrompt('机器学习入门', records);
    expect(String(messages[1].content)).toContain('1. [回答] 过拟合 — 甲（赞同 10）：过拟合 的摘要');
    expect(String(messages[1].content)).toContain('4. [视频] 一个视频');
    expect(alias.get('1')).toBe('a');
    const out = normalizeThemes({ themes: [{ title: '正则化', why: '一条线', ids: [1, 2, 2, 99] }, { title: '空的', ids: [] }, { title: '再来', ids: ['3'] }], misc: [4], start: { id: 4, why: '视频' } }, alias, records)!;
    expect(out.themes.map((t) => [t.title, t.itemIds])).toEqual([['正则化', ['a', 'b']], ['再来', ['c']]]);
    expect(out.misc).toEqual(['v', 'd']);
    expect(out.start).toBeNull(); // 视频不能当起点
    expect(normalizeThemes(null, alias, records)).toBeNull();
    expect(normalizeThemes({ themes: [{ ids: [99] }] }, alias, records)).toBeNull();
  });

  it('themesForFavlist：叫一次模型 → 落盘缓存 → 条目不变直接读缓存；坏 JSON 退回一条线；≤1 篇可讲不叫模型', async () => {
    const { themesForFavlist, readCachedThemes } = await import('./zhihu-theme-service');
    const records = [rec('a', '过拟合'), rec('b', 'L1 与 L2'), rec('c', '早停')];
    const chatFn = vi.fn(async () => ({ content: JSON.stringify({ themes: [{ title: '正则化三讲', why: '同一条线', ids: [1, 2, 3] }], misc: [], start: { id: 1, why: '最基础' } }) }));
    const first = await themesForFavlist('u1', '9', '机器学习入门', records, { chatFn, now: () => 1_000 });
    expect(first.source).toBe('model');
    expect(first.themes[0]).toMatchObject({ title: '正则化三讲', itemIds: ['a', 'b', 'c'] });
    expect(first.start).toEqual({ itemId: 'a', why: '最基础' });
    expect(chatFn).toHaveBeenCalledTimes(1);

    const again = await themesForFavlist('u1', '9', '机器学习入门', records, { chatFn });
    expect(again.createdAt).toBe(first.createdAt);
    expect(chatFn).toHaveBeenCalledTimes(1); // 缓存
    expect(await readCachedThemes('u1', '9')).toMatchObject({ hash: first.hash });

    // 条目变了 → 重算；模型给坏 JSON → fallback 一条线 + 赞同最高的当起点
    const changed = [...records, rec('d', '交叉验证', { voteUpCount: 99 })];
    const bad = vi.fn(async () => ({ content: 'nope' }));
    const fb = await themesForFavlist('u1', '9', '机器学习入门', changed, { chatFn: bad });
    expect(fb.source).toBe('fallback');
    expect(fb.themes).toHaveLength(1);
    expect(fb.themes[0].itemIds).toHaveLength(4);
    expect(fb.start?.itemId).toBe('d');

    // 只有一篇可讲：不叫模型
    const one = vi.fn();
    const trivial = await themesForFavlist('u1', '8', '只有一篇', [rec('x', '唯一'), rec('v', '视频', { kind: 'zvideo' })], { chatFn: one });
    expect(trivial.source).toBe('trivial');
    expect(trivial.themes[0].itemIds).toEqual(['x']);
    expect(trivial.misc).toEqual(['v']);
    expect(one).not.toHaveBeenCalled();
  });
});
