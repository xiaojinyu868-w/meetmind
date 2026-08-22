/**
 * teach-client — /teach 页与后端会话层（teach-codex）之间的唯一收口。
 *
 * 契约终稿（src/app/api/teach/DOMAIN.md）与 mock 阶段的暂定差异：
 * - **订阅制 SSE**：GET /api/teach/threads/[id]/stream 长连接扇出所有事件
 *  （首事件 thread）；POST messages/interrupt 只回 ack（turn 进行中 409）
 * - interrupt 附带 text = 打断+续讲一步完成（事件流在同一条 SSE 连接上）
 * - 历史恢复：GET .../events 回放事件日志（含 student-message 记录），
 *  无独立快照格式——事件日志即单一事实源
 * - messages 只收 text：划线引用按 buildWireText 拼进 text（teach-events.ts）
 *
 * mock 模式（默认）：MockTeachSession 本地生成器 + localStorage 历史。
 * 切换：URL ?mock=0 或 NEXT_PUBLIC_TEACH_MOCK=0。
 */

import type { BoardScript } from '@/lib/ai-native/plugins/board-script';
import { sanitizeBoardScript } from '@/lib/ai-native/plugins/board-script';
import type { TeachEvent } from './teach-events';
import { MockTeachSession } from './mockTeachStream';
import type { MockPace } from './mockTeachStream';
import {
  listTeachThreads,
  loadTeachSnapshot,
  saveTeachThreadMeta,
} from './teach-store';
import type { TeachThreadMeta } from './teach-store';

/** mock 数据源（Phase A 的 agent 板书脚本，含 pages/segments/actions + cue） */
const MOCK_SCRIPT_URL = '/demo/board-script-agent.json';

/** mock 脚本 URL（?script=board-script-overload.json 可换 /demo/ 下的替代脚本，布局回归用） */
function mockScriptUrl(): string {
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('script');
    if (param && /^[\w.-]+\.json$/.test(param)) return `/demo/${param}`;
  }
  return MOCK_SCRIPT_URL;
}

/** 新建线程的默认课题（mock 下被脚本标题覆盖；真实模式作为 POST body 的 topic） */
export function teachDefaultTopic(): string {
  return '一元二次方程：求根公式与判别式';
}

/** mock / 真实切换：默认真实（2026-08-21 翻转——线上默认 mock 导致用户拿到罐头回答）；
 *  演示/开发用 ?mock=1 或 NEXT_PUBLIC_TEACH_MOCK=1 显式走 mock */
export function isMockMode(): boolean {
  if (typeof window !== 'undefined') {
    const flag = new URLSearchParams(window.location.search).get('mock');
    if (flag === '1') return true;
    if (flag === '0') return false;
  }
  return process.env.NEXT_PUBLIC_TEACH_MOCK === '1';
}

// ── mock 会话注册表（页面会话级；刷新后由快照游标重建） ─────────────────────

const mockSessions = new Map<string, MockTeachSession>();
let mockScriptPromise: Promise<BoardScript> | null = null;

function loadMockScript(): Promise<BoardScript> {
  mockScriptPromise ??= fetch(mockScriptUrl())
    .then((response) => {
      if (!response.ok) throw new Error(`mock script HTTP ${response.status}`);
      return response.json();
    })
    .then((data: { script: BoardScript }) => sanitizeBoardScript(data.script).script);
  return mockScriptPromise;
}

/** 历史线程恢复后重建 mock 会话（游标续播；真实模式是 no-op） */
export async function attachMockSession(
  threadId: string,
  cursor: number,
  pendingCheckpoint: boolean,
  pace?: MockPace,
): Promise<void> {
  if (!isMockMode() || mockSessions.has(threadId)) return;
  const script = await loadMockScript();
  const session = new MockTeachSession(script, pace);
  session.restore(cursor, pendingCheckpoint);
  mockSessions.set(threadId, session);
}

/** mock 续播游标（快照落盘用；真实模式返回 null） */
export function mockCursorOf(threadId: string): { cursor: number; pendingCheckpoint: boolean; done: boolean } | null {
  const session = mockSessions.get(threadId);
  if (!session) return null;
  return {
    cursor: session.getCursor(),
    pendingCheckpoint: session.pendingCheckpoint !== null,
    done: session.isDone(),
  };
}

// ── 线程列表 / 新建（双模式同签名） ─────────────────────────────────────────

interface ServerThreadRow {
  id: string;
  title: string;
  createdAt: string;
}

function serverThreadToMeta(row: ServerThreadRow): TeachThreadMeta {
  return { id: row.id, title: row.title, createdAt: Date.parse(row.createdAt) || Date.now() };
}

export async function teachListThreads(): Promise<TeachThreadMeta[]> {
  if (isMockMode()) return listTeachThreads();
  const response = await fetch('/api/teach/threads');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { threads: ServerThreadRow[] };
  return data.threads.map(serverThreadToMeta);
}

export async function teachCreateThread(topic: string, pace?: MockPace): Promise<TeachThreadMeta> {
  if (isMockMode()) {
    const script = await loadMockScript();
    const meta: TeachThreadMeta = {
      id: `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: script.title || topic,
      createdAt: Date.now(),
    };
    mockSessions.set(meta.id, new MockTeachSession(script, pace));
    saveTeachThreadMeta(meta);
    return meta;
  }
  const response = await fetch('/api/teach/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { thread: ServerThreadRow };
  return serverThreadToMeta(data.thread);
}

// ── mock 流（生成器；真实模式走订阅制，见下） ───────────────────────────────

/** 开课（首条流）：mock 直接从 cursor 播 */
export function teachStartLesson(threadId: string): AsyncGenerator<TeachEvent> {
  const session = mockSessions.get(threadId);
  if (!session) throw new Error(`mock session 不存在：${threadId}`);
  return session.run();
}

/** 发消息（mock：提问 / 作答），返回事件流 */
export function teachSendMessage(
  threadId: string,
  input: { text: string; quote?: string },
): AsyncGenerator<TeachEvent> {
  const session = mockSessions.get(threadId);
  if (!session) throw new Error(`mock session 不存在：${threadId}`);
  return session.pendingCheckpoint ? session.answer(input.text) : session.ask(input.text, input.quote);
}

/** mock 打断：当前生成器流出尽快停（真实模式打断走 teachPostInterrupt） */
export async function teachInterrupt(threadId: string): Promise<void> {
  mockSessions.get(threadId)?.abort();
}

// ── 真实模式：订阅 + ack 型 POST ────────────────────────────────────────────

/** 订阅线程事件流（EventSource；首事件 thread 表示连接建立）。返回退订函数。
 *  注意：断线重连会重复收到 thread 首事件；需要"连接建立"语义或断线自愈的
 *  调用方请直接用 EventSource（useTeachSession.subscribeReal 即如此）。 */
export function teachSubscribe(threadId: string, onEvent: (event: TeachEvent) => void): () => void {
  const source = new EventSource(`/api/teach/threads/${encodeURIComponent(threadId)}/stream`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as TeachEvent);
    } catch {
      // 坏包跳过
    }
  };
  return () => source.close();
}

/** 发学生消息/开课（ack；事件经订阅流出）。turn 进行中 409。 */
export async function teachPostMessage(threadId: string, text: string): Promise<Response> {
  return fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

/** 打断；附带 text 时 interrupted 落地后同线程续讲 */
export async function teachPostInterrupt(threadId: string, text?: string): Promise<Response> {
  return fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/interrupt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(text ? { text } : {}),
  });
}

/** 事件日志回放（历史课程恢复；真实模式） */
export async function teachFetchEvents(threadId: string): Promise<TeachEvent[]> {
  const response = await fetch(`/api/teach/threads/${encodeURIComponent(threadId)}/events`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as { events: TeachEvent[] };
  return data.events;
}

/** 历史线程快照（mock：localStorage） */
export function teachLoadSnapshot(threadId: string) {
  return loadTeachSnapshot(threadId);
}
