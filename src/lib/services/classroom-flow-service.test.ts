import { describe, expect, it } from 'vitest';
import {
  createEmptyClassroomFlow,
  mergeClassroomFlowDelta,
  sanitizeClassroomFlow,
} from './classroom-flow-service';

describe('classroom-flow-service', () => {
  it('returns an honest empty state for invalid model output', () => {
    expect(sanitizeClassroomFlow(null, 42_000, '宏观经济学')).toEqual(
      createEmptyClassroomFlow(42_000, '宏观经济学'),
    );
  });

  it('keeps the current moment concise and clamps anchors to the live class', () => {
    const flow = sanitizeClassroomFlow({
      title: '  机会成本与沉没成本  ',
      now: {
        id: 'now:bad id',
        title: '老师正在用旅行选择解释机会成本',
        summary: '比较选择一个方案时真正放弃的最好替代项。',
        teachingMove: '用生活案例建立定义',
        anchorMs: 99_000,
      },
      recent: [
        { id: 'a', title: '提出选择问题', anchorMs: 5_000 },
        { id: 'a', title: '重复的当前节点', anchorMs: 8_000 },
      ],
      keep: [
        { id: 'k1', kind: 'definition', text: '机会成本是放弃的最好替代项', anchorMs: -2 },
        { id: 'k2', kind: 'invented', text: '不要把沉没成本带进未来决策', anchorMs: 12_000 },
      ],
    }, 30_000);

    expect(flow.title).toBe('机会成本与沉没成本');
    expect(flow.now?.id).toBe('nowbadid');
    expect(flow.now?.anchorMs).toBe(30_000);
    expect(flow.keep[0].anchorMs).toBe(0);
    expect(flow.keep[1].kind).toBe('other');
  });

  it('keeps earlier classroom steps for long-form review', () => {
    const flow = sanitizeClassroomFlow({
      recent: Array.from({ length: 8 }, (_, index) => ({
        id: `r${index}`,
        title: `步骤 ${index}`,
        anchorMs: index * 1_000,
      })),
      keep: Array.from({ length: 8 }, (_, index) => ({
        id: `k${index}`,
        kind: 'other',
        text: `内容 ${index}`,
        anchorMs: index * 1_000,
      })),
    }, 20_000);

    expect(flow.recent.map((item) => item.id)).toEqual([
      'r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7',
    ]);
    expect(flow.keep).toHaveLength(8);
  });

  it('drops internal teaching-move enum names instead of leaking them into the classroom UI', () => {
    const flow = sanitizeClassroomFlow({
      now: {
        id: 'detail',
        title: '确认客户姓名 Jane Bond',
        teachingMove: 'listening_detail',
        anchorMs: 12_000,
      },
      recent: [{
        id: 'context',
        title: '交代搬家背景',
        teachingMove: '结合语境解释表达',
        anchorMs: 6_000,
      }],
    }, 20_000);

    expect(flow.now?.teachingMove).toBeUndefined();
    expect(flow.recent[0]?.teachingMove).toBe('结合语境解释表达');
  });

  it('applies only incremental upserts and preserves untouched classroom memory', () => {
    const prior = sanitizeClassroomFlow({
      title: '机会成本',
      now: { id: 'definition', title: '定义机会成本', anchorMs: 5_000 },
      recent: [{ id: 'opening', title: '提出选择问题', anchorMs: 1_000 }],
      keep: [{ id: 'formula', kind: 'formula', text: '净收益计算式', anchorMs: 4_000 }],
    }, 10_000);

    const next = mergeClassroomFlowDelta(prior, {
      now: { id: 'example', title: '用旅行选择举例', anchorMs: 15_000 },
      recentUpserts: [{ id: 'definition', title: '完成机会成本定义', anchorMs: 5_000 }],
      keepUpserts: [{ id: 'contrast', kind: 'contrast', text: '区分机会成本和沉没成本', anchorMs: 16_000 }],
      updatedAtMs: 20_000,
    }, 20_000);

    expect(next.title).toBe('机会成本');
    expect(next.now?.id).toBe('example');
    expect(next.recent.map((item) => item.id)).toEqual(['opening', 'definition']);
    expect(next.keep.map((item) => item.id)).toEqual(['formula', 'contrast']);
  });

  it('removes prior items only through explicit delta remove ids', () => {
    const prior = sanitizeClassroomFlow({
      keep: [
        { id: 'open-question', kind: 'question', text: '这个结论何时不成立', anchorMs: 3_000 },
        { id: 'definition', kind: 'definition', text: '核心定义', anchorMs: 4_000 },
      ],
    }, 5_000);

    const next = mergeClassroomFlowDelta(prior, {
      keepRemoveIds: ['open-question'],
      updatedAtMs: 12_000,
    }, 12_000);

    expect(next.keep.map((item) => item.id)).toEqual(['definition']);
  });
});
