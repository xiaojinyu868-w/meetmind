/**
 * 分身事件总线 —— 按分身（egoId）的进程内 pub/sub。
 *
 * 蒸馏进度与对话共用一条订阅（GET /api/fenshen/egos/[id]/stream）。
 * 事件来源：codex 通知（text-delta / turn-complete / interrupted / error）、
 * 蒸馏线程的内置 exec/MCP 通知映射（distill-progress）、蒸馏完成检测
 * （ego-ready）。session/distill 服务 publish，SSE 路由 subscribe 扇出给
 * 浏览器；thread-store 同步把每个事件落盘（data/fenshen-events/<egoId>.jsonl）。
 *
 * 事件契约（SSE data 行的 JSON，与前端并行开发的唯一事实源）：
 *   {type:'thread',threadId}          订阅建立时的首个事件（threadId = egoId）
 *   {type:'text-delta',text}          分身/蒸馏 agent 说的话（流式增量）
 *   {type:'distill-progress',note}    账本式蒸馏进度（内置 exec/MCP 动作文案化）
 *   {type:'ego-ready',skillPath}      蒸馏完成（SKILL.md 已落盘），分身可对话
 *   {type:'turn-complete'}            一轮结束
 *   {type:'interrupted'}              当前 turn 被打断
 *   {type:'error',message}            错误（人可读）
 */

export type FenshenStreamEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'distill-progress'; note: string }
  | { type: 'ego-ready'; skillPath: string }
  | { type: 'turn-complete' }
  | { type: 'interrupted' }
  | { type: 'error'; message: string };

/**
 * 事件日志行 = SSE 契约事件 + 用户消息记录（只落盘不广播，供回放恢复对话：
 * 用户消息不经总线——它就是 turn 的输入，SSE 订阅者就是自己发的）。
 */
export type FenshenLogEvent = FenshenStreamEvent | { type: 'user-message'; text: string };

export type FenshenEventListener = (event: FenshenStreamEvent) => void;

interface BusState {
  listeners: Map<string, Set<FenshenEventListener>>;
}

const globalForBus = globalThis as unknown as { __fenshenBus?: BusState };
const state: BusState = globalForBus.__fenshenBus ?? { listeners: new Map() };
globalForBus.__fenshenBus = state;

export function subscribeFenshenEgo(egoId: string, listener: FenshenEventListener): () => void {
  let set = state.listeners.get(egoId);
  if (!set) {
    set = new Set();
    state.listeners.set(egoId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) state.listeners.delete(egoId);
  };
}

export function publishFenshenEvent(egoId: string, event: FenshenStreamEvent): void {
  const set = state.listeners.get(egoId);
  if (!set) return;
  for (const listener of [...set]) {
    try {
      listener(event);
    } catch {
      // 单个订阅者异常不影响其他订阅者
    }
  }
}

/** 测试辅助：当前订阅数 */
export function fenshenSubscriberCount(egoId: string): number {
  return state.listeners.get(egoId)?.size ?? 0;
}
