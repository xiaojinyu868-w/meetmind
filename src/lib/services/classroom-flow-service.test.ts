import { describe, expect, it } from 'vitest';
import {
  createEmptyClassroomFlow,
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

  it('limits the visible state without requiring the model to fill a quota', () => {
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

    expect(flow.recent.map((item) => item.id)).toEqual(['r4', 'r5', 'r6', 'r7']);
    expect(flow.keep).toHaveLength(4);
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
});
