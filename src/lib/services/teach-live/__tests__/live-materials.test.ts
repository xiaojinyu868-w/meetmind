import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let tmp: string;
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-live-materials-'));
  process.env.TEACH_MATERIALS_DIR = path.relative(process.cwd(), path.join(tmp, 'materials'));
});
afterAll(async () => {
  delete process.env.TEACH_MATERIALS_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('live-materials', () => {
  it('没有材料时 prompt 一字不加', async () => {
    const { formatLiveMaterialsBlock, readLiveMaterialsBlock } = await import('../live-materials');
    expect(formatLiveMaterialsBlock(null)).toBe('');
    expect(formatLiveMaterialsBlock({ v: 1, source: 'x', title: 't', items: [], createdAt: '' })).toBe('');
    expect(await readLiveMaterialsBlock('thread-does-not-exist')).toBe('');
  });

  it('落盘再读回同一份；格式化段带引用 id、元信息、正文状态与四条讲法约束', async () => {
    const { writeLiveMaterials, readLiveMaterials, formatLiveMaterialsBlock } = await import('../live-materials');
    const pack = {
      v: 1 as const,
      source: 'zhihu-favlist',
      title: '机器学习入门',
      items: [
        { ref: 'A1', title: '过拟合到底是什么？', author: '张三', url: 'https://www.zhihu.com/question/1/answer/2', meta: '回答 · 赞同 120 · 评论 8', body: 'full' as const, excerpt: '过拟合的本质是……', sourceId: 'cap-1' },
        { ref: 'A2', title: '正则化为什么有用', author: null, url: 'https://zhuanlan.zhihu.com/p/1', meta: '文章 · 赞同 30 · 评论 2', body: 'summary' as const, excerpt: '正则化通过惩罚项……', sourceId: 'cap-2' },
      ],
      skipped: [{ sourceId: 'cap-3', title: '一个视频', reason: '视频没有可讲的正文' }],
      createdAt: '2026-09-12T00:00:00.000Z',
    };
    await writeLiveMaterials('thread/../evil id', pack);
    const back = await readLiveMaterials('thread/../evil id');
    expect(back).toEqual(pack);
    const files = await fs.readdir(path.join(tmp, 'materials'));
    expect(files).toEqual(['thread____evil_id.json']); // 路径字符被替换，写不出目录

    const block = formatLiveMaterialsBlock(pack);
    expect(block.startsWith('# 这节课的材料（学生自己收藏的 2 篇，来自「机器学习入门」')).toBe(true);
    expect(block).toContain('[A1] 《过拟合到底是什么？》 · 张三 · 回答 · 赞同 120 · 评论 8 · 正文节选');
    expect(block).toContain('[A2] 《正则化为什么有用》 · 文章 · 赞同 30 · 评论 2 · 只有摘要');
    expect(block).toContain('材料 1 说……，材料 3 却认为……');
    expect(block).toContain('只能当线索，不要替它编细节');
    expect(block).toContain('这段不在你收藏里');
    expect(block).toContain('不要照抄某一篇的标题');
    expect(block).not.toContain('一个视频'); // skipped 不进 prompt
    expect(block).not.toContain('已经上过'); // 没有 priorLessons 就不提

    const again = formatLiveMaterialsBlock({ ...pack, priorLessons: [{ threadId: 't0', title: '模型为什么会「背题」', createdAt: '2026-09-11T00:00:00.000Z' }] });
    expect(again).toContain('这位学生用这组材料已经上过 1 节：《模型为什么会「背题」》。这次不要从头讲同一段');
  });

  it('损坏的文件当作没有材料', async () => {
    const { readLiveMaterials } = await import('../live-materials');
    await fs.writeFile(path.join(tmp, 'materials', 'broken.json'), '{not json', 'utf8');
    expect(await readLiveMaterials('broken')).toBeNull();
    await fs.writeFile(path.join(tmp, 'materials', 'v2.json'), JSON.stringify({ v: 2, items: [] }), 'utf8');
    expect(await readLiveMaterials('v2')).toBeNull();
  });
});
