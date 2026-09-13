import { describe, it, expect } from 'vitest';
import { buildLessonRecord, lessonRecordDigestLine, materialRefsInText, LESSON_MS_PER_CHAR } from '../lesson-record';
import type { TeachLogEvent } from '@/lib/services/teach-codex/event-bus';
import type { LiveMaterialPack } from '../live-materials';

const thread = { id: 't1', title: '惩罚项：给参数立规矩', topic: 'L1 和 L2', createdAt: new Date('2026-09-13T04:00:00Z'), updatedAt: new Date('2026-09-13T04:05:00Z') };

const pack: LiveMaterialPack = {
  v: 1,
  source: 'zhihu-favlist',
  title: 'deeplearning',
  mode: 'single',
  pickReason: '最基础的一篇',
  ownerUserId: 'u1',
  createdAt: '2026-09-13T04:00:00Z',
  priorLessons: [{ threadId: 't0', title: '上一节', createdAt: '2026-09-12T00:00:00Z' }],
  items: [
    { ref: 'A1', title: 'L1 和 L2 正则化的区别', author: '甲', url: 'https://zhuanlan.zhihu.com/p/1', meta: '文章 · 赞同 860', body: 'full', excerpt: '正文。'.repeat(50) },
    { ref: 'A2', title: '早停', author: null, url: 'https://www.zhihu.com/question/1/answer/2', meta: '回答 · 赞同 430', body: 'full', excerpt: '（全文 20000 字、6 节，下面是开头、各节首段与结尾；目录：a / b）\n\n开头。' },
  ],
  skipped: [{ title: '一个视频', reason: '视频没有可讲的正文' }],
};

const events: TeachLogEvent[] = [
  { type: 'student-message', text: '开始上课' },
  { type: 'block-open', id: 'b1', kind: 'say', attrs: {} },
  { type: 'text-delta', text: '你收藏的这篇文章说，' },
  { type: 'text-delta', text: '一张图就能讲清 L1 和 L2 {{ 1+1 }}。' },
  { type: 'block-close', id: 'b1', complete: true },
  { type: 'cue', name: 'scene', args: { title: '先看它加在哪儿' } },
  { type: 'block-open', id: 'd1', kind: 'draw', attrs: {} },
  { type: 'block-delta', id: 'd1', text: 'plot(...)' },
  { type: 'block-close', id: 'd1', complete: true },
  { type: 'block-open', id: 'b2', kind: 'ask', attrs: {} },
  { type: 'text-delta', text: '材料二提到早停，你觉得它算正则化吗？' },
  { type: 'block-close', id: 'b2', complete: true },
  { type: 'turn-complete' },
  { type: 'student-message', text: '算吧，它也限制了参数。' },
  { type: 'block-open', id: 'b3', kind: 'say', attrs: {} },
  { type: 'text-delta', text: '对，作者也这么认为。' },
  { type: 'block-close', id: 'b3', complete: true },
  { type: 'turn-complete' },
] as TeachLogEvent[];

describe('materialRefsInText', () => {
  it('阿拉伯数字 / 全角 / 中文数字都认，去重', () => {
    expect(materialRefsInText('材料 1 说，材料一又说，材料３和材料两……')).toEqual(['A1', 'A3', 'A2']);
    expect(materialRefsInText('没有提材料')).toEqual([]);
  });
});

describe('buildLessonRecord', () => {
  it('事件日志 → 老师 / 学生两个说话人的转录段（按语速铺时间轴、去内联计算、首条「开始上课」不算）、页与板书统计、轮次、材料引用', () => {
    const record = buildLessonRecord(thread, events, pack);
    expect(record.title).toBe('惩罚项：给参数立规矩');
    expect(record.settled).toBe(true);
    expect(record.rounds).toBe(2);
    expect(record.segments.map((s) => [s.speaker, s.page, s.round])).toEqual([
      ['teacher', 0, 1],
      ['teacher', 1, 1],
      ['student', 1, 2],
      ['teacher', 1, 2],
    ]);
    expect(record.segments[0].text).toBe('你收藏的这篇文章说，一张图就能讲清 L1 和 L2 。');
    expect(record.segments[0].startMs).toBe(0);
    expect(record.segments[0].endMs).toBe(record.segments[0].text.length * LESSON_MS_PER_CHAR);
    expect(record.segments[1].startMs).toBeGreaterThan(record.segments[0].endMs);
    expect(record.segments[0].sourceRef).toBe('A1'); // single 模式默认归 A1
    expect(record.segments[1].sourceRef).toBe('A2'); // 口播点名「材料二」
    expect(record.pages).toEqual([{ index: 1, title: '先看它加在哪儿', startMs: record.segments[1].startMs, blocks: { draw: 1 } }]);
    expect(record.materials?.items.map((i) => [i.ref, i.coverage, i.mentioned])).toEqual([
      ['A1', 'full-text', true],
      ['A2', 'outline', true],
    ]);
    expect(record.materials?.pickReason).toBe('最基础的一篇');
    expect(record.materials?.skipped).toEqual([{ title: '一个视频', reason: '视频没有可讲的正文' }]);
    expect(record.priorLessons).toHaveLength(1);
    expect(record.stageHref).toBe('/apps/zhihu/lesson/t1');
    expect(record.durationMs).toBe(record.segments[3].endMs);
    expect(record.digest).toEqual({ pagesTaught: ['先看它加在哪儿'], materialsMentioned: ['A1', 'A2'], teacherChars: record.segments.filter((s) => s.speaker === 'teacher').reduce((n, s) => n + s.text.length, 0), studentTurns: 1 });
    expect(lessonRecordDigestLine(record)).toBe('《惩罚项：给参数立规矩》（1 分钟，2 轮）：讲了 1 页：先看它加在哪儿；点到 A1 A2');
  });

  it('没有材料包（/teach/live 自己开的课）也能物化；被打断 / 未闭合的块算未讲完', () => {
    const record = buildLessonRecord(thread, [events[0], events[1], events[2], { type: 'interrupted' } as TeachLogEvent], null);
    expect(record.materials).toBeNull();
    expect(record.stageHref).toBe('/teach/live?t=t1');
    expect(record.settled).toBe(false);
    expect(record.segments).toHaveLength(1);
    expect(record.segments[0].sourceRef).toBeUndefined();
    expect(buildLessonRecord(thread, [], null).durationMs).toBe(0);
  });
});
