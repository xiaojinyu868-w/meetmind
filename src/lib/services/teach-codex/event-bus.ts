/**
 * 教学事件总线 —— 按线程的进程内 pub/sub。
 *
 * 事件来源两路：codex 通知（text-delta / turn-complete / interrupted / error）
 * 与内部工具回调（tool-call / tool-result）。会话服务 publish，
 * SSE 路由 subscribe 扇出给浏览器；thread-store 同步把每个事件落盘
 * （data/teach-events/<threadId>.jsonl），供刷新重放与复习线消费。
 *
 * 事件契约（SSE data 行的 JSON，与前端并行开发的唯一事实源）：
 *   {type:'thread',threadId}        订阅建立时的首个事件
 *   {type:'text-delta',text}        老师讲的话（流式增量）
 *   {type:'tool-call',id,name,args} 板书工具调用（args 为已解析 JSON）
 *   {type:'tool-result',id,result}  工具结果（BoardEnv digest：{ok,board,...}）
 *   {type:'turn-complete'}          一轮讲完
 *   {type:'interrupted'}            当前 turn 被打断
 *   {type:'image-ready',id,url}     插图回填完成（id = image tool-call 的 id）
 *   {type:'error',message}          错误（人可读）
 */

export type TeachStreamEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool-result'; id: string; result: unknown }
  | { type: 'turn-complete' }
  | { type: 'interrupted' }
  | { type: 'image-ready'; id: string; url: string }
  | { type: 'error'; message: string };

/**
 * 事件日志行 = SSE 契约事件 + 学生消息记录（只落盘不广播，供回放恢复对话：
 * 学生消息不经总线——它就是 turn 的输入，SSE 订阅者就是自己发的）。
 */
export type TeachLogEvent = TeachStreamEvent | { type: 'student-message'; text: string };

export type TeachEventListener = (event: TeachStreamEvent) => void;

interface BusState {
  listeners: Map<string, Set<TeachEventListener>>;
}

const globalForBus = globalThis as unknown as { __teachBus?: BusState };
const state: BusState = globalForBus.__teachBus ?? { listeners: new Map() };
globalForBus.__teachBus = state;

export function subscribeTeachThread(threadId: string, listener: TeachEventListener): () => void {
  let set = state.listeners.get(threadId);
  if (!set) {
    set = new Set();
    state.listeners.set(threadId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) state.listeners.delete(threadId);
  };
}

export function publishTeachEvent(threadId: string, event: TeachStreamEvent): void {
  const set = state.listeners.get(threadId);
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
export function teachSubscriberCount(threadId: string): number {
  return state.listeners.get(threadId)?.size ?? 0;
}
