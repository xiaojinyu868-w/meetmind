'use client';

/**
 * live-client —— /teach/live 与 /api/teach/* 的唯一收口（真实路由，无 mock）。
 *
 * 会话模型同老线：一条 SSE 长连接订阅（GET .../stream）+ POST ack 发消息 / 打断。
 * 订阅带断线自愈：EventSource error 后浏览器自动重连，我们在 onopen 时通知调用方
 * 「重连了」，由它决定是否全量回放事件日志追齐。
 */

import type { TeachStreamEvent } from '@/lib/services/teach-codex/event-bus';

export interface LiveThreadMeta {
  id: string;
  title: string;
  topic: string;
  engine: string;
  createdAt: string;
  updatedAt: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // 非 JSON 错误体
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function liveListThreads(): Promise<LiveThreadMeta[]> {
  const data = await readJson<{ threads: LiveThreadMeta[] }>(await fetch('/api/teach/threads?engine=live'));
  return data.threads;
}

export async function liveCreateThread(topic: string, learner?: unknown): Promise<LiveThreadMeta> {
  const data = await readJson<{ thread: LiveThreadMeta }>(
    await fetch('/api/teach/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, engine: 'live', ...(learner ? { learner } : {}) }),
    }),
  );
  return data.thread;
}

export async function liveFetchEvents(threadId: string): Promise<{ events: TeachStreamEvent[]; title: string; topic: string }> {
  return readJson(await fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/events`));
}

export async function livePostMessage(threadId: string, text: string, boardNote?: string): Promise<void> {
  await readJson(
    await fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(boardNote ? { text, boardNote } : { text }),
    }),
  );
}

export async function livePostInterrupt(threadId: string, text?: string, boardNote?: string): Promise<void> {
  await readJson(
    await fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(text ? (boardNote ? { text, boardNote } : { text }) : {}),
    }),
  );
}

/** <draw> 脚本自愈：让模型只修出错的那一段（服务端复跑验证）。失败抛错，调用方回退到「没画出来」提示。 */
export async function liveFixDraw(
  threadId: string,
  chunks: string[],
  index: number,
  error: string,
  segmentId?: string,
): Promise<{ script: string; verified: boolean; error?: string }> {
  return readJson(
    await fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/draw-fix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks, index, error, segmentId }),
    }),
  );
}

export interface LiveSubscription {
  close(): void;
}

/**
 * 订阅线程事件流。onOpen 在每次连接建立时触发（含自动重连），
 * 首次 open 后的 open 一律视为「重连」。
 */
export function liveSubscribe(
  threadId: string,
  handlers: {
    onEvent: (event: TeachStreamEvent) => void;
    onOpen?: (reconnected: boolean) => void;
    onError?: () => void;
  },
): LiveSubscription {
  const source = new EventSource(`/api/teach/threads/${encodeURIComponent(threadId)}/stream`);
  let opened = false;
  source.onopen = () => {
    handlers.onOpen?.(opened);
    opened = true;
  };
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as TeachStreamEvent;
      if (event.type === 'thread') return;
      handlers.onEvent(event);
    } catch {
      // 坏包跳过
    }
  };
  source.onerror = () => handlers.onError?.();
  return { close: () => source.close() };
}
