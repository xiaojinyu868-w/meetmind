/**
 * 教学会话服务 —— codex app-server 底座的编排层。
 *
 * 职责：按需拉起（shim → 写线程 CODEX_HOME config.toml → codex app-server
 * 进程 → thread/start 或 thread/resume）、turn 驱动（turn/start /
 * turn/interrupt）、codex 通知 → SSE 契约事件 → 事件总线 + 落盘。
 *
 * 生命周期：进程按线程隔离（data/teach-codex/<threadId>/），空闲由
 * codex-app-server 的 reaper 回收；崩溃后下一次发消息自动重启并
 * thread/resume 续讲（codexThreadId 落库在 TeachThread）。
 *
 * 无 ask 阻塞结构：教学提问走自然轮次（学生消息 = 新 turn）。
 *
 * 注意：所有可变状态必须挂 globalThis——Next dev 下每个路由是独立编译
 * entry，模块级 Map 会被复制多份（冒烟实测：messages 与 interrupt 路由
 * 各持一份 activeTurns，打断静默失效）。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@/lib/logger';
import { resolveTeachProvider, teachProviderApiKey, TeachConfig } from '@/lib/config/teach.config';
import { buildTeachBaseInstructions } from '@/lib/prompts/teach-teacher-prompt';
import { normalizeFormulaText } from '@/lib/services/teach-agent/tools';
import { publishTeachEvent, type TeachStreamEvent } from './event-bus';
import { ensureShimServer } from './shim-server';
import { executeTeachTool } from './board-env';
import {
  CodexAppServer,
  getCodexSession,
  registerCodexSession,
  type CodexNotification,
} from './codex-app-server';
import { getTeachInternalToken } from './internal-auth';
import * as store from './thread-store';

const log = createLogger('teach-session');

interface SessionState {
  /** 当前每线程活跃 turn（turn-active 防并发；interrupt 用它定位） */
  activeTurns: Map<string, string>;
  /** interrupt 等待者：turn/completed 到达时 resolve */
  interruptWaiters: Map<string, () => void>;
  /** ensureSession 串行化（防双击并发起拉两个进程） */
  sessionInflight: Map<string, Promise<{ session: CodexAppServer; codexThreadId: string }>>;
}

const globalForSession = globalThis as unknown as { __teachSessionState?: SessionState };
const state: SessionState = globalForSession.__teachSessionState ?? {
  activeTurns: new Map(),
  interruptWaiters: new Map(),
  sessionInflight: new Map(),
};
globalForSession.__teachSessionState = state;

function emit(threadId: string, event: TeachStreamEvent) {
  publishTeachEvent(threadId, event);
  store.appendThreadEvent(threadId, event).catch((cause) => {
    log.warn('event append failed', {
      threadId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
}

/** 发消息前的同步预检（provider key 缺失时路由直接 500，不开 SSE） */
export function preflightTeach(): { ok: true } | { ok: false; error: string } {
  const provider = resolveTeachProvider();
  if (!teachProviderApiKey(provider)) {
    return { ok: false, error: `教学底座未配置 ${provider.apiKeyEnv}（provider=${provider.id}）` };
  }
  return { ok: true };
}

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 每线程 CODEX_HOME 的 config.toml（provider 永远指向本地 shim） */
async function writeCodexConfig(threadId: string, codexHome: string): Promise<void> {
  const provider = resolveTeachProvider();
  const shim = await ensureShimServer();
  const mcpServer = path.join(process.cwd(), 'server', 'teach', 'teach-mcp-server.mjs');
  const toml = `# 自动生成 by teach-session-service（每线程 CODEX_HOME，勿手改）
model = "${tomlEscape(provider.model)}"
model_provider = "teach_shim"
approval_policy = "never"

[model_providers.teach_shim]
name = "teach responses->chat shim (${tomlEscape(provider.id)})"
base_url = "${tomlEscape(shim.baseUrl)}"
env_key = "TEACH_SHIM_KEY"
wire_api = "responses"

[mcp_servers.teach]
command = "${tomlEscape(process.execPath)}"
args = ["${tomlEscape(mcpServer)}"]
default_tools_approval_mode = "approve"

[mcp_servers.teach.env]
TEACH_THREAD_ID = "${tomlEscape(threadId)}"
TEACH_TOOL_CALLBACK = "${tomlEscape(`${TeachConfig.internalBaseUrl}/api/teach/internal/tool`)}"
TEACH_TOOLS_URL = "${tomlEscape(`${TeachConfig.internalBaseUrl}/api/teach/internal/tools`)}"
TEACH_INTERNAL_TOKEN = "${tomlEscape(getTeachInternalToken())}"
`;
  await writeFile(path.join(codexHome, 'config.toml'), toml, 'utf8');
}

function threadParams(row: store.TeachThreadRow, codexHome: string) {
  const provider = resolveTeachProvider();
  return {
    model: provider.model,
    modelProvider: 'teach_shim',
    cwd: path.join(codexHome, 'work'),
    approvalPolicy: 'never',
    sandbox: 'read-only',
    baseInstructions: buildTeachBaseInstructions(row.topic),
  };
}

function onCodexNotification(threadId: string, notification: CodexNotification) {
  const { method, params } = notification;
  const p = (params ?? {}) as Record<string, unknown>;

  if (method === 'item/agentMessage/delta') {
    const delta = typeof p.delta === 'string' ? p.delta : '';
    if (delta) emit(threadId, { type: 'text-delta', text: delta });
    return;
  }
  if (method === 'turn/started') {
    const turn = p.turn as { id?: string } | undefined;
    if (turn?.id) state.activeTurns.set(threadId, turn.id);
    return;
  }
  if (method === 'turn/completed') {
    const turn = p.turn as { status?: string } | undefined;
    state.activeTurns.delete(threadId);
    emit(threadId, turn?.status === 'interrupted' ? { type: 'interrupted' } : { type: 'turn-complete' });
    store.touchThread(threadId).catch(() => {});
    const waiter = state.interruptWaiters.get(threadId);
    if (waiter) {
      state.interruptWaiters.delete(threadId);
      waiter();
    }
    return;
  }
  // tool-call / tool-result 事件不走这里：由 MCP 内部回调直接发
  // （带我们自己的 id 与 BoardEnv digest，避免双通道重复事件）
}

/** 确保线程的 codex 会话可用（进程 + codex 线程），返回句柄与 codexThreadId */
async function ensureSession(
  row: store.TeachThreadRow,
): Promise<{ session: CodexAppServer; codexThreadId: string }> {
  const existing = getCodexSession(row.id);
  if (existing && row.codexThreadId) return { session: existing, codexThreadId: row.codexThreadId };
  const inflight = state.sessionInflight.get(row.id);
  if (inflight) return inflight;

  const starting = (async (): Promise<{ session: CodexAppServer; codexThreadId: string }> => {
    const codexHome = path.join(process.cwd(), TeachConfig.codexHomeRoot, row.id);
    await mkdir(path.join(codexHome, 'work'), { recursive: true });
    await writeCodexConfig(row.id, codexHome);

    const session = new CodexAppServer(row.id, codexHome);
    session.setNotificationHandler((n) => onCodexNotification(row.id, n));
    await session.start();
    registerCodexSession(session);

    const params = threadParams(row, codexHome);
    let codexThreadId = row.codexThreadId;
    if (codexThreadId) {
      await session.request('thread/resume', { ...params, threadId: codexThreadId });
      log.info('codex thread resumed', { threadId: row.id, codexThreadId });
    } else {
      const result = (await session.request('thread/start', params)) as {
        thread?: { id?: string };
        id?: string;
      };
      codexThreadId = result.thread?.id || result.id || null;
      if (!codexThreadId) throw new Error('thread/start 未返回 thread id');
      await store.setCodexThreadId(row.id, codexThreadId);
      log.info('codex thread started', { threadId: row.id, codexThreadId });
    }
    return { session, codexThreadId };
  })();

  state.sessionInflight.set(row.id, starting);
  try {
    return await starting;
  } finally {
    state.sessionInflight.delete(row.id);
  }
}

/**
 * 发学生消息（或开课指令）：确保会话 → turn/start。
 * resolve 时机 = codex 收下 turn（事件随后经总线流出）；同步错误抛给路由。
 */
export async function sendTeachMessage(threadId: string, text: string): Promise<void> {
  const row = await store.getThread(threadId);
  if (!row) throw new TeachServiceError('thread-not-found', '课程不存在', 404);
  if (state.activeTurns.has(threadId)) {
    throw new TeachServiceError('turn-active', '老师正在讲，先打断或等讲完', 409);
  }

  const { session, codexThreadId } = await ensureSession(row);
  const result = (await session.request('turn/start', {
    threadId: codexThreadId,
    input: [{ type: 'text', text }],
  })) as { turn?: { id?: string }; id?: string };
  const turnId = result.turn?.id || result.id;
  if (turnId) state.activeTurns.set(threadId, turnId);
  await store.touchThread(threadId);
  // 学生消息落事件日志（只落盘不广播）：回放恢复对话记录用
  store.appendThreadEvent(threadId, { type: 'student-message', text }).catch(() => undefined);
  log.info('turn started', { threadId, turnId, chars: text.length });
}

/**
 * 打断当前 turn；附带学生消息时，等 interrupted 落地后同线程续讲
 * （上下文保留，spike §5c 已验证）。无活跃 turn 时附带消息直接发。
 */
export async function interruptTeachThread(threadId: string, text?: string): Promise<void> {
  const row = await store.getThread(threadId);
  if (!row) throw new TeachServiceError('thread-not-found', '课程不存在', 404);

  const session = getCodexSession(threadId);
  const turnId = state.activeTurns.get(threadId);
  if (session && turnId && row.codexThreadId) {
    const interrupted = new Promise<void>((resolve) => {
      state.interruptWaiters.set(threadId, resolve);
      setTimeout(() => {
        if (state.interruptWaiters.delete(threadId)) resolve(); // 兜底 15s
      }, 15_000).unref?.();
    });
    await session.request('turn/interrupt', { threadId: row.codexThreadId, turnId });
    await interrupted;
  }

  if (text?.trim()) {
    await sendTeachMessage(threadId, text.trim());
  }
}

export class TeachServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * MCP 工具回调（内部路由 → 这里）：发 tool-call 事件 → 按线程 BoardEnv
 * 执行 → 发 tool-result 事件（digest）→ 把 digest 返回给 MCP server
 * （经它回填给 codex/模型，环境观测闭环）。
 */
export async function handleMcpToolCall(
  threadId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // 模型偶发把 LaTeX 反斜杠双重转义（\\cdot）：在事件源头收敛，事件流与
  // BoardEnv 拿到的是同一份干净文本（前端画布按事件渲染）
  const finalArgs =
    name === 'write' && args.role === 'formula' && typeof args.text === 'string'
      ? { ...args, text: normalizeFormulaText(args.text) }
      : args;
  const id = `tc_${crypto.randomUUID()}`;
  emit(threadId, { type: 'tool-call', id, name, args: finalArgs });
  const result = await executeTeachTool(threadId, name, finalArgs);
  emit(threadId, { type: 'tool-result', id, result });
  log.info('teach tool', { threadId, name, ok: result.ok !== false });
  return result;
}
