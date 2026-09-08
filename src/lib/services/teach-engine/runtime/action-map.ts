/**
 * 教学动作词表与事件映射 —— 教学动作协议 v1 的单一事实源（服务侧）。
 *
 * - KNOWN_ACTIONS：vendor 引擎认识的全部动作（spike runner 同款 22 个）。
 * - ACTIONS_V1：v1 降级词表（已拍板）：speech / wb_open / wb_close / wb_draw_text /
 *   wb_draw_latex / wb_clear / spotlight / laser / discussion。shape/table/line/code/
 *   edit_code 等进 KNOWN 但不进 V1（模型被告知只用 V1；越表动作计 unknownActions
 *   不执行），`TEACH_ACTIONS_FULL=1` 放开到全量 KNOWN。
 * - ACTIONS_V2_RESERVED：v2 预留（KNOWN 但不启用）——widget_show（lab-sim），
 *   不在 KNOWN_ACTIONS（vendor 引擎不认识），不进任何启用词表。
 * - actionToToolCallEvent：闭合动作 → SSE 契约 tool-call 事件（name=动作名、
 *   args 原样透传 params）。
 * - ensureElementId：落元素动作（wb_draw_*）缺省补 `elementId: a_${n}`（单写者
 *   id 约定，分身×家教合流的前置，设计文档 §5.1 三条硬约定之一）。
 */
import type { ParsedAction } from '../vendor/openmaic/orchestration/stateless-generate';

export const KNOWN_ACTIONS: readonly string[] = [
  'speech',
  'spotlight',
  'laser',
  'wb_open',
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_draw_code',
  'wb_edit_code',
  'wb_clear',
  'wb_delete',
  'wb_close',
  'play_video',
  'discussion',
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
];

export const ACTIONS_V1: readonly string[] = [
  'speech',
  'wb_open',
  'wb_close',
  'wb_draw_text',
  'wb_draw_latex',
  'wb_clear',
  'spotlight',
  'laser',
  'discussion',
];

/**
 * v2 预留动作（KNOWN 但不启用）：widget_show —— lab-sim 交互实验
 * （自包含 HTML + iframe srcDoc + postMessage，skill 内容已落
 * assets/teach-skills/lab-sim/ 并 disable-model-invocation）。
 * 注意它不在 KNOWN_ACTIONS：vendor ActionEngine 不认识该类型，
 * 进 KNOWN 会让 TEACH_ACTIONS_FULL=1 把它放进引擎执行路径。
 * v2 接线 = 前端 iframe 渲染器（并行任务）+ 本常量并入启用词表。
 */
export const ACTIONS_V2_RESERVED: readonly string[] = ['widget_show'];

/** 词表默认全量 KNOWN_ACTIONS（P3 渲染器已补齐，2026-09-05 翻转）；
 *  `TEACH_ACTIONS_FULL=0` 收回到 v1 降级词表（事故回滚用）。 */
export function teachActionsFull(): boolean {
  return (process.env.TEACH_ACTIONS_FULL || '').trim() !== '0';
}

/** 当前生效的词表（prompt 词表生成与运行时过滤共用同一份）。 */
export function enabledActions(): readonly string[] {
  return teachActionsFull() ? KNOWN_ACTIONS : ACTIONS_V1;
}

export function isActionEnabled(name: string): boolean {
  return enabledActions().includes(name);
}

/** 落元素动作（缺省 elementId 需要补 a_${n} 的那批）。 */
const ELEMENT_PRODUCING_ACTIONS = new Set([
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_draw_code',
]);

/**
 * 缺省补 elementId：nextId 由调用方按线程持有计数器（`a_${n}` 单调递增）。
 * 已带 elementId 的原样保留（模型指定 id 供 spotlight/laser 引用）。
 */
export function ensureElementId(
  name: string,
  params: Record<string, unknown>,
  nextId: () => string,
): Record<string, unknown> {
  if (!ELEMENT_PRODUCING_ACTIONS.has(name)) return params;
  if (typeof params.elementId === 'string' && params.elementId) return params;
  return { ...params, elementId: nextId() };
}

/** 闭合动作 → tool-call 事件载荷（id 稳定由调用方分配，args 原样透传）。 */
export function actionToToolCallEvent(
  parsed: ParsedAction,
  id: string,
): { id: string; name: string; args: Record<string, unknown> } {
  return { id, name: parsed.actionName, args: parsed.params };
}
