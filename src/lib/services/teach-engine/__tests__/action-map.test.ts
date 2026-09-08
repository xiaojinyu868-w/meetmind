/**
 * action-map 单测：词表开关 / elementId 缺省补齐 / tool-call 事件映射。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIONS_V1,
  KNOWN_ACTIONS,
  actionToToolCallEvent,
  enabledActions,
  ensureElementId,
  isActionEnabled,
} from '../runtime/action-map';

describe('action-map 词表', () => {
  afterEach(() => {
    delete process.env.TEACH_ACTIONS_FULL;
  });

  it('ACTIONS_V1 是拍板的 9 动作降级词表', () => {
    expect([...ACTIONS_V1].sort()).toEqual(
      ['discussion', 'laser', 'spotlight', 'speech', 'wb_clear', 'wb_close', 'wb_draw_latex', 'wb_draw_text', 'wb_open'].sort(),
    );
  });

  it('shape/table/line/code/edit_code 进 KNOWN 但不进 V1', () => {
    for (const name of ['wb_draw_shape', 'wb_draw_table', 'wb_draw_line', 'wb_draw_code', 'wb_edit_code']) {
      expect(KNOWN_ACTIONS).toContain(name);
      expect(ACTIONS_V1).not.toContain(name);
    }
  });

  it('默认放开全量 KNOWN（P3 渲染器已补齐）；TEACH_ACTIONS_FULL=0 收回 V1', () => {
    expect(isActionEnabled('wb_draw_text')).toBe(true);
    expect(isActionEnabled('wb_draw_table')).toBe(true);
    expect(enabledActions()).toEqual(KNOWN_ACTIONS);

    process.env.TEACH_ACTIONS_FULL = '0';
    expect(isActionEnabled('wb_draw_table')).toBe(false);
    expect(enabledActions()).toEqual(ACTIONS_V1);
  });
});

describe('ensureElementId', () => {
  it('wb_draw_* 缺省补 a_${n}；已带 elementId 的原样保留', () => {
    let n = 0;
    const next = () => `a_${++n}`;
    expect(ensureElementId('wb_draw_text', { content: 'hi' }, next)).toEqual({
      content: 'hi',
      elementId: 'a_1',
    });
    expect(ensureElementId('wb_draw_text', { content: 'hi', elementId: 'title' }, next)).toEqual({
      content: 'hi',
      elementId: 'title',
    });
  });

  it('非落元素动作（spotlight/wb_clear）不补', () => {
    const next = () => 'a_x';
    expect(ensureElementId('spotlight', { elementId: 'note1' }, next)).toEqual({ elementId: 'note1' });
    expect(ensureElementId('wb_clear', {}, next)).toEqual({});
  });
});

describe('actionToToolCallEvent', () => {
  it('name=动作名、args 原样透传 params、id 用调用方给的稳定值', () => {
    const ev = actionToToolCallEvent(
      { actionId: 'x', actionName: 'wb_draw_text', params: { content: '质数', elementId: 'a_1' } },
      'tc_123',
    );
    expect(ev).toEqual({ id: 'tc_123', name: 'wb_draw_text', args: { content: '质数', elementId: 'a_1' } });
  });
});
