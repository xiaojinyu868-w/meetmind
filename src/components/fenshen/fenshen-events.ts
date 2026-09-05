/**
 * fenshen-events — 分身线前端事件契约 + 纯状态机（无 React / fetch 依赖，
 * node 测试环境可直接 import）。
 *
 * 契约事实源：src/app/api/fenshen/DOMAIN.md（SSE data 行 JSON）。
 * 与服务端 src/lib/services/fenshen/event-bus.ts 的类型保持一致，但按依赖
 * 方向铁律（components 不 import services）在这里独立声明。
 *
 * 状态机规则（useFenshenSession 与历史回放共用同一入口 applyFenshenEvent）：
 * - text-delta → 当前 assistant 气泡流式追加（bubbleOpen 期间不新开气泡）
 * - turn-complete / interrupted → 一轮结束，下一段 text-delta 开新气泡
 * - distill-progress → 账本式进度追加一条（DistillProgressView 渲染）
 * - ego-ready → ready=true（分身可对话 / 试听）
 * - user-message → 仅事件日志回放出现（只落盘不广播），还原用户气泡
 * - thread / error → 连接信号 / 错误落地
 */

export type FenshenSourceType = 'hall' | 'bilibili' | 'upload';

export type FenshenEgoStatus = 'learning' | 'ready' | 'failed';

/** GET /api/fenshen/egos 的列表项 DTO（契约见 api/fenshen/DOMAIN.md） */
export interface FenshenEgoDto {
  id: string;
  name: string;
  sourceType: FenshenSourceType;
  sourceRef: string;
  status: FenshenEgoStatus;
  failReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FenshenStreamEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'distill-progress'; note: string }
  | { type: 'ego-ready'; skillPath: string }
  | { type: 'turn-complete' }
  | { type: 'interrupted' }
  | { type: 'error'; message: string };

/** 这节课的快照（guest/demo 会话未持久化到服务端 DB 时的上下文来源） */
export interface FenshenLessonSnapshot {
  title?: string;
  segments?: { startMs: number; endMs: number; text: string; speakerId?: string | null }[];
}

/** 发送时的物化范围：sessionId 定位这节课，lessonSnapshot 兜底这节课的内容 */
export interface FenshenChatScope {
  sessionId?: string;
  lessonSnapshot?: FenshenLessonSnapshot;
}

/** 事件日志行 = SSE 契约事件 + 用户消息记录（只落盘不广播，回放恢复对话用） */
export type FenshenLogEvent = FenshenStreamEvent | { type: 'user-message'; text: string };

export interface FenshenChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface DistillProgressEntry {
  id: string;
  note: string;
}

export interface FenshenSessionState {
  messages: FenshenChatMessage[];
  progress: DistillProgressEntry[];
  streaming: boolean;
  /** 收到 ego-ready（蒸馏完成，分身可对话） */
  ready: boolean;
  /** 人可读错误（error 事件落地） */
  error: string | null;
  /** 内部：assistant 气泡正在累积中（turn 边界前 text-delta 不新开气泡） */
  bubbleOpen: boolean;
}

export function initialFenshenSessionState(): FenshenSessionState {
  return {
    messages: [],
    progress: [],
    streaming: false,
    ready: false,
    error: null,
    bubbleOpen: false,
  };
}

/** 消息 id 生成器（测试注入确定性序列；生产默认时间戳+随机） */
export type FenshenIdGen = () => string;

export const defaultFenshenIdGen: FenshenIdGen = () =>
  `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** 单事件落地（实时流 / 日志回放共用；幂等：重放从 initialState 全量重放） */
export function applyFenshenEvent(
  state: FenshenSessionState,
  event: FenshenLogEvent,
  createId: FenshenIdGen = defaultFenshenIdGen,
): FenshenSessionState {
  switch (event.type) {
    case 'text-delta': {
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === 'assistant' && state.bubbleOpen) {
        return {
          ...state,
          streaming: true,
          messages: [...state.messages.slice(0, -1), { ...last, text: last.text + event.text }],
        };
      }
      return {
        ...state,
        streaming: true,
        bubbleOpen: true,
        messages: [...state.messages, { id: createId(), role: 'assistant', text: event.text }],
      };
    }
    case 'user-message':
      return {
        ...state,
        bubbleOpen: false,
        messages: [...state.messages, { id: createId(), role: 'user', text: event.text }],
      };
    case 'distill-progress':
      return {
        ...state,
        progress: [...state.progress, { id: createId(), note: event.note }],
      };
    case 'ego-ready':
      return { ...state, ready: true };
    case 'turn-complete':
      return { ...state, streaming: false, bubbleOpen: false };
    case 'interrupted':
      return { ...state, streaming: false, bubbleOpen: false };
    case 'error':
      return { ...state, streaming: false, error: event.message };
    case 'thread':
      return state;
  }
}

/** 事件日志全量重放（历史恢复；回放末态按不在讲处理——崩溃中断的 turn 不再流式） */
export function replayFenshenEvents(
  events: FenshenLogEvent[],
  createId: FenshenIdGen = defaultFenshenIdGen,
): FenshenSessionState {
  let state = initialFenshenSessionState();
  for (const event of events) state = applyFenshenEvent(state, event, createId);
  return { ...state, streaming: false, bubbleOpen: false };
}
