import { describe, it, expect } from 'vitest';
import { buildExecutePayload, materialsToTranscript, sourceForTime, weakConceptsFromAssessment } from './zhihu-lesson-model';
import type { LiveMaterialPack } from '@/lib/services/teach-live/live-materials';

const pack: LiveMaterialPack = {
  v: 1,
  source: 'zhihu-favlist',
  title: '机器学习入门',
  createdAt: '2026-09-12T00:00:00.000Z',
  items: [
    {
      ref: 'A1',
      title: '过拟合到底是什么？',
      author: '张三',
      url: 'https://www.zhihu.com/question/1/answer/2',
      meta: '回答 · 赞同 120',
      body: 'full',
      excerpt: `${'过拟合的本质是模型把训练数据里的噪声也学了进去。'.repeat(3)}\n\n${'正则化通过惩罚项限制参数。'.repeat(3)}\n……（节选，全文见原链接）`,
      sourceId: 'cap-a',
    },
    { ref: 'A2', title: '早停法', author: null, url: 'https://zhuanlan.zhihu.com/p/9', meta: '文章 · 赞同 30', body: 'summary', excerpt: '早停是在验证集误差开始上升时停止训练。', sourceId: 'cap-b' },
  ],
};

describe('materialsToTranscript', () => {
  it('每篇材料 = 标题段 + 各正文段；时间轴按朗读估时顺序铺开且不重叠；总时长过 readiness 的 60 秒门', () => {
    const { transcript, spans, durationMs } = materialsToTranscript(pack);
    expect(transcript.map((s) => s.id)).toEqual(['A1-0', 'A1-1', 'A1-2', 'A2-0', 'A2-1']);
    expect(transcript[0].text).toBe('[A1]《过拟合到底是什么？》（张三）');
    expect(transcript[3].text).toBe('[A2]《早停法》');
    expect(transcript.every((s) => s.confidence === 1 && s.isFinal)).toBe(true);
    expect(transcript[1].sourceItemId).toBe('cap-a');
    for (let i = 1; i < transcript.length; i++) {
      expect(transcript[i].startMs).toBeGreaterThan(transcript[i - 1].endMs);
    }
    expect(transcript[1].endMs - transcript[1].startMs).toBe('过拟合的本质是模型把训练数据里的噪声也学了进去。'.repeat(3).length * 220);
    expect(transcript[4].endMs - transcript[4].startMs).toBeGreaterThanOrEqual(1500);
    expect(transcript.some((s) => s.text.includes('节选'))).toBe(false);

    expect(spans.map((s) => s.ref)).toEqual(['A1', 'A2']);
    expect(spans[0].startMs).toBe(0);
    expect(spans[1].startMs).toBe(transcript[3].startMs);
    expect(sourceForTime(spans, transcript[2].startMs)?.url).toBe('https://www.zhihu.com/question/1/answer/2');
    expect(sourceForTime(spans, transcript[4].startMs)?.ref).toBe('A2');
    expect(sourceForTime(spans, durationMs + 1)).toBeNull();
  });

  it('几千字的真实体量能过 readiness（≥220 字、≥60 秒）', () => {
    const big: LiveMaterialPack = {
      ...pack,
      items: [{ ...pack.items[0], excerpt: Array.from({ length: 6 }, () => '一段大约六十个字的正文用来模拟真实材料的长度这样才能把估算出来的时长撑过一分钟的客观门槛并且保证字数也充足。').join('\n\n') }],
    };
    const { transcript, durationMs } = materialsToTranscript(big);
    expect(transcript.reduce((n, s) => n + s.text.length, 0)).toBeGreaterThan(220);
    expect(durationMs).toBeGreaterThan(60_000);
  });
});

describe('buildExecutePayload / weakConceptsFromAssessment', () => {
  it('请求体对齐 /api/apps/execute 契约：appKey、goal、input（伪转录 + 元信息）、memory 摘要；learner 可选', () => {
    const { transcript } = materialsToTranscript(pack);
    const payload = buildExecutePayload({ appKey: 'quiz', threadId: 'th-1', pack, transcript });
    expect(payload.appKey).toBe('quiz');
    expect(payload.goal).toMatchObject({ appKey: 'quiz', expectedOutput: 'mixed' });
    expect(payload.goal.intent).toContain('收藏的知乎材料');
    expect(payload.input.sessionId).toBe('zhihu-lesson:th-1');
    expect(payload.input.dataSource).toBe('unknown');
    expect(payload.input.transcript).toBe(transcript);
    expect(payload.input.metadata).toEqual({ title: '机器学习入门', contextType: 'zhihu-favlist', materialsCount: 2 });
    expect(payload.memory.summary).toContain('[A1]过拟合到底是什么？');
    expect('learner' in payload).toBe(false);
    expect(buildExecutePayload({ appKey: 'flashcards', threadId: 't', pack, transcript, learner: { v: 1 } }).learner).toEqual({ v: 1 });
  });

  it('只挑没稳的结果，去重、保序、限量', () => {
    const draft = {
      appKey: 'quiz',
      items: [
        { concept: '过拟合  的定义', outcome: 'correct' as const },
        { concept: '正则化', outcome: 'wrong' as const },
        { concept: '早停', outcome: 'missed' as const },
        { concept: '正则化', outcome: 'wrong' as const },
        { concept: 'x', outcome: 'wrong' as const },
        { concept: '交叉验证', outcome: 'blind-spot' as const },
        { concept: '第四个', outcome: 'wrong' as const },
      ],
    };
    expect(weakConceptsFromAssessment(draft)).toEqual(['正则化', '早停', '交叉验证']);
    expect(weakConceptsFromAssessment(draft, 1)).toEqual(['正则化']);
    expect(weakConceptsFromAssessment(null)).toEqual([]);
    expect(weakConceptsFromAssessment({ appKey: 'quiz', items: [{ concept: '全对', outcome: 'correct' }] })).toEqual([]);
  });
});
