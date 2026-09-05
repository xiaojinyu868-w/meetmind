/**
 * fenshen-client — 分身线前端与 /api/fenshen/* 之间的唯一收口（照 teach-client
 * 的订阅制 SSE + ack 型 POST 模式；分身线无 mock 模式、无画布、无语音）。
 *
 * 契约事实源：src/app/api/fenshen/DOMAIN.md。
 * - 订阅：GET /api/fenshen/egos/[id]/stream（EventSource；首事件 thread）
 * - 历史：GET /api/fenshen/egos/[id]/events（事件日志回放，含 user-message）
 * - POST messages / interrupt / feedback 只回 ack；事件经订阅流出
 * - interrupt 附带 text = 打断+续讲一步完成（同一条 SSE 连接）
 */

import type {
  FenshenChatScope,
  FenshenEgoDto,
  FenshenLogEvent,
  FenshenSourceType,
  FenshenStreamEvent,
} from './fenshen-events';

const BASE = '/api/fenshen/egos';

function egoUrl(id: string, suffix = ''): string {
  return `${BASE}/${encodeURIComponent(id)}${suffix}`;
}

/** 从错误响应里掏出人可读 message（路由统一 {error} 形体） */
export async function fenshenErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === 'string' && data.error) return data.error;
  } catch {
    // 非 JSON 响应
  }
  return `HTTP ${response.status}`;
}

/** 分身架列表（updatedAt 倒序由服务端保证） */
export async function fenshenListEgos(): Promise<FenshenEgoDto[]> {
  const response = await fetch(BASE, { cache: 'no-store' });
  if (!response.ok) throw new Error(await fenshenErrorMessage(response));
  const data = (await response.json()) as { egos: FenshenEgoDto[] };
  return data.egos;
}

/** 请分身：建行后立即起蒸馏线程；启动失败 500（error 人可读） */
export async function fenshenCreateEgo(input: {
  name: string;
  sourceType: FenshenSourceType;
  sourceRef?: string;
}): Promise<FenshenEgoDto> {
  const response = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await fenshenErrorMessage(response));
  const data = (await response.json()) as { ego: FenshenEgoDto };
  return data.ego;
}

/** 上传录音（私有轨语料）：复用现有 /api/upload-audio，返回 fileUrl 作 sourceRef */
export async function fenshenUploadAudio(file: File): Promise<string> {
  const form = new FormData();
  form.append('audio', file);
  const response = await fetch('/api/upload-audio', { method: 'POST', body: form });
  const data = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    fileUrl?: string;
    error?: string;
  };
  if (!response.ok || !data.success || !data.fileUrl) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data.fileUrl;
}

/** 事件日志回放（历史恢复：蒸馏进度 + 对话） */
export async function fenshenFetchEvents(egoId: string): Promise<FenshenLogEvent[]> {
  const response = await fetch(egoUrl(egoId, '/events'), { cache: 'no-store' });
  if (!response.ok) throw new Error(await fenshenErrorMessage(response));
  const data = (await response.json()) as { events: FenshenLogEvent[] };
  return data.events;
}

/** 订阅分身事件流。返回退订函数。断线重连会重复收到 thread 首事件；
 *  需要"断线自愈 + 重放追齐"语义的调用方直接用 EventSource（useFenshenSession）。 */
export function fenshenSubscribe(
  egoId: string,
  onEvent: (event: FenshenStreamEvent) => void,
): () => void {
  const source = new EventSource(egoUrl(egoId, '/stream'));
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as FenshenStreamEvent);
    } catch {
      // 坏包跳过
    }
  };
  return () => source.close();
}

/** 与分身对话（ack；事件经订阅流出）。分身未 ready 或 turn 进行中 409。
 *  scope.sessionId = 用户当前复习页的课程会话，分身按这节课物化上下文；
 *  scope.lessonSnapshot = 这节课的前端快照（guest/demo 未持久化时服务端用它兜底）。 */
export async function fenshenPostMessage(
  egoId: string,
  text: string,
  scope: FenshenChatScope = {},
): Promise<Response> {
  return fetch(egoUrl(egoId, '/messages'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sessionId: scope.sessionId, lessonSnapshot: scope.lessonSnapshot }),
  });
}

/** 打断；附带 text 时 interrupted 落地后同线程续讲。scope 语义同 messages。 */
export async function fenshenPostInterrupt(
  egoId: string,
  text?: string,
  scope: FenshenChatScope = {},
): Promise<Response> {
  return fetch(egoUrl(egoId, '/interrupt'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sessionId: scope.sessionId, lessonSnapshot: scope.lessonSnapshot }),
  });
}

/** 试听反馈「像 / 不像他」；unlike 触发重蒸馏 turn（带 note 重听） */
export async function fenshenPostFeedback(
  egoId: string,
  verdict: 'like' | 'unlike',
  note?: string,
): Promise<Response> {
  return fetch(egoUrl(egoId, '/feedback'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note ? { verdict, note } : { verdict }),
  });
}
