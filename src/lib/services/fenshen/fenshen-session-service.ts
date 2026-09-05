/**
 * 分身对话编排 —— codex app-server 底座的长期对话线程（照 teach-session-service 模式）。
 *
 * 职责：ensureChatSession（重刷上下文物化文件 → 写对话线程 CODEX_HOME 的
 * config.toml → 拉起/恢复 codex 线程，sandbox=read-only 不挂 MCP）→
 * turn/start / turn/interrupt（附消息时等 interrupted 再续讲）→ codex 通知
 * 映射为 SSE 契约事件 → 事件总线 + 落盘。
 *
 * 上下文物化在 ./lesson-context-service（prisma / 前端快照 → workspace
 * 文件，每次 ensureChatSession 重刷）。
 *
 * 注意：所有可变状态必须挂 globalThis——Next dev 下每个路由是独立编译
 * entry，模块级 Map 会被复制多份（teach 线冒烟实测踩过）。
 */

import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@/lib/logger';
import { resolveTeachProvider } from '@/lib/config/teach.config';
import { buildFenshenPersonaPrompt } from '@/lib/prompts/fenshen-persona-prompt';
import { publishFenshenEvent, type FenshenStreamEvent } from './event-bus';
import { egoPaths } from './fenshen-config';
import { materializeLessonContext, type MaterializeScope } from './lesson-context-service';
import { ensureShimServer } from '../teach-codex/shim-server';
import {
  CodexAppServer,
  getCodexSession,
  registerCodexSession,
  type CodexNotification,
} from '../teach-codex/codex-app-server';
import * as store from './thread-store';

const log = createLogger('fenshen-session');

/** 对话进程注册表 key（与蒸馏线程 key 区分） */
const chatKey = (egoId: string) => `${egoId}:chat`;

/** 进行中的对话轮（空轮静默重试用） */
interface PendingTurn {
  /** 本轮用户输入（重试时原样重发） */
  text: string;
  codexThreadId: string;
  /** 是否已收到任何文本 delta */
  gotDelta: boolean;
  /** 是否已补过一枪（只重试一次） */
  retried: boolean;
}

interface SessionState {
  /** 当前每分身活跃对话 turn（turn-active 防并发；interrupt 用它定位） */
  activeTurns: Map<string, string>;
  /** interrupt 等待者：turn/completed 到达时 resolve */
  interruptWaiters: Map<string, () => void>;
  /** ensureChatSession 串行化（防双击并发起拉两个进程） */
  sessionInflight: Map<string, Promise<{ session: CodexAppServer; codexThreadId: string }>>;
  /** 等待完成的对话轮（空轮检测 + 静默重试） */
  pendingTurns: Map<string, PendingTurn>;
}

const globalForSession = globalThis as unknown as { __fenshenSessionState?: SessionState };
const state: SessionState = globalForSession.__fenshenSessionState ?? {
  activeTurns: new Map(),
  interruptWaiters: new Map(),
  sessionInflight: new Map(),
  pendingTurns: new Map(),
};
globalForSession.__fenshenSessionState = state;
// dev 热重载下旧 state 对象可能缺新字段，兜底补齐
state.pendingTurns ??= new Map();

function emit(egoId: string, event: FenshenStreamEvent) {
  publishFenshenEvent(egoId, event);
  store.appendEgoEvent(egoId, event).catch((cause) => {
    log.warn('event append failed', {
      egoId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
}

/**
 * 空轮重试判定（纯函数）：completed 且零 delta 且未补过枪 → retry；
 * interrupted 优先于一切（用户打断的空轮不重试）；无 pending（非对话轮，
 * 如蒸馏完成通知走到这里）按正常完成处理。
 */
export function emptyTurnAction(
  pending: PendingTurn | undefined,
  turnStatus: string | undefined,
): 'retry' | 'complete' | 'interrupted' {
  if (turnStatus === 'interrupted') return 'interrupted';
  if (pending && !pending.gotDelta && !pending.retried) return 'retry';
  return 'complete';
}

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 对话线程 CODEX_HOME 的 config.toml：provider 指本地 shim，不挂任何 MCP */
async function writeChatCodexConfig(codexHome: string): Promise<void> {
  const provider = resolveTeachProvider();
  const shim = await ensureShimServer();
  const toml = `# 自动生成 by fenshen-session-service（每分身 CODEX_HOME，勿手改）
model = "${tomlEscape(provider.model)}"
model_provider = "teach_shim"
approval_policy = "never"
project_doc_max_bytes = 0

[model_providers.teach_shim]
name = "teach responses->chat shim (${tomlEscape(provider.id)})"
base_url = "${tomlEscape(shim.baseUrl)}"
env_key = "TEACH_SHIM_KEY"
wire_api = "responses"
`;
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, 'config.toml'), toml, 'utf8');
}

// ---------- codex 会话生命周期 ----------

function onChatNotification(egoId: string, notification: CodexNotification) {
  const { method, params } = notification;
  const p = (params ?? {}) as Record<string, unknown>;

  if (method === 'item/agentMessage/delta') {
    const delta = typeof p.delta === 'string' ? p.delta : '';
    if (delta) {
      const pending = state.pendingTurns.get(egoId);
      if (pending) pending.gotDelta = true;
      emit(egoId, { type: 'text-delta', text: delta });
    }
    return;
  }
  if (method === 'turn/started') {
    const turn = p.turn as { id?: string } | undefined;
    if (turn?.id) state.activeTurns.set(egoId, turn.id);
    return;
  }
  if (method === 'turn/completed') {
    const turn = p.turn as { status?: string } | undefined;
    state.activeTurns.delete(egoId);
    const pending = state.pendingTurns.get(egoId);
    // 空轮静默重试：上游偶发瞬断会返回零 delta 的 completed（冒烟实测首轮
    // 偶发）；同线程原样补一枪，SSE 不断流、用户无感。
    if (emptyTurnAction(pending, turn?.status) === 'retry') {
      const session = getCodexSession(chatKey(egoId));
      if (session && pending) {
        pending.retried = true;
        log.warn('empty chat turn, silent retry', { egoId });
        session
          .request('turn/start', {
            threadId: pending.codexThreadId,
            input: [{ type: 'text', text: pending.text }],
          })
          .then((result) => {
            const r = result as { turn?: { id?: string }; id?: string };
            const retryTurnId = r.turn?.id || r.id;
            if (retryTurnId) state.activeTurns.set(egoId, retryTurnId);
          })
          .catch((cause: unknown) => {
            log.warn('empty-turn retry failed', {
              egoId,
              error: cause instanceof Error ? cause.message : String(cause),
            });
            state.pendingTurns.delete(egoId);
            emit(egoId, { type: 'turn-complete' });
          });
        return;
      }
    }
    state.pendingTurns.delete(egoId);
    emit(egoId, turn?.status === 'interrupted' ? { type: 'interrupted' } : { type: 'turn-complete' });
    store.touchEgo(egoId).catch(() => {});
    const waiter = state.interruptWaiters.get(egoId);
    if (waiter) {
      state.interruptWaiters.delete(egoId);
      waiter();
    }
  }
}

/** 确保对话线程的 codex 会话可用（重刷物化文件 → 进程 → codex 线程）。
 *  物化每次都做：用户可能换了一节课再聊，分身要听到的是当前这节课。 */
async function ensureChatSession(
  ego: store.FenshenEgoRow,
  scope: MaterializeScope = {},
): Promise<{ session: CodexAppServer; codexThreadId: string }> {
  const key = chatKey(ego.id);
  const existing = getCodexSession(key);
  if (existing && ego.chatThreadId) {
    await materializeLessonContext(egoPaths(ego.id).workDir, scope);
    return { session: existing, codexThreadId: ego.chatThreadId };
  }
  const inflight = state.sessionInflight.get(key);
  if (inflight) return inflight;

  const starting = (async (): Promise<{ session: CodexAppServer; codexThreadId: string }> => {
    const paths = egoPaths(ego.id);
    await mkdir(paths.workDir, { recursive: true });
    await materializeLessonContext(paths.workDir, scope);
    // 蒸馏产物镜像到固定挂载点 work/skill/（重蒸馏修订后这里跟着刷新）
    if (ego.skillPath) {
      await cp(path.join(paths.workDir, ego.skillPath), paths.chatSkillDir, {
        recursive: true,
      }).catch((cause) => {
        log.warn('skill mirror failed', {
          egoId: ego.id,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      });
    }
    await writeChatCodexConfig(paths.chatHome);

    const session = new CodexAppServer(key, paths.chatHome);
    session.setNotificationHandler((n) => onChatNotification(ego.id, n));
    await session.start();
    registerCodexSession(session);

    const provider = resolveTeachProvider();
    const params = {
      model: provider.model,
      modelProvider: 'teach_shim',
      cwd: paths.workDir,
      approvalPolicy: 'never',
      // 对话线程只读：agent 用内置文件能力读 lesson/ learner/ skill/
      sandbox: 'read-only',
      baseInstructions: buildFenshenPersonaPrompt(ego.name),
    };
    let codexThreadId = ego.chatThreadId;
    if (codexThreadId) {
      await session.request('thread/resume', { ...params, threadId: codexThreadId });
      log.info('chat thread resumed', { egoId: ego.id, chatThreadId: codexThreadId });
    } else {
      const result = (await session.request('thread/start', params)) as {
        thread?: { id?: string };
        id?: string;
      };
      codexThreadId = result.thread?.id || result.id || null;
      if (!codexThreadId) throw new Error('thread/start 未返回 thread id');
      await store.setChatThreadId(ego.id, codexThreadId);
      log.info('chat thread started', { egoId: ego.id, chatThreadId: codexThreadId });
    }
    return { session, codexThreadId };
  })();

  state.sessionInflight.set(key, starting);
  try {
    return await starting;
  } finally {
    state.sessionInflight.delete(key);
  }
}

/**
 * 发学生消息：确保会话 → turn/start。resolve 时机 = codex 收下 turn
 * （事件随后经总线流出）；同步错误抛给路由。分身未 ready 时 409。
 */
export async function sendFenshenMessage(
  egoId: string,
  text: string,
  scope: MaterializeScope = {},
): Promise<void> {
  const ego = await store.getEgo(egoId);
  if (!ego) throw new store.FenshenServiceError('ego-not-found', '分身不存在', 404);
  if (ego.status !== 'ready' || !ego.skillPath) {
    throw new store.FenshenServiceError('ego-not-ready', '分身还在学习中，就绪后再来聊', 409);
  }
  if (state.activeTurns.has(egoId)) {
    throw new store.FenshenServiceError('turn-active', '分身正在讲，先打断或等讲完', 409);
  }

  const { session, codexThreadId } = await ensureChatSession(ego, scope);
  const result = (await session.request('turn/start', {
    threadId: codexThreadId,
    input: [{ type: 'text', text }],
  })) as { turn?: { id?: string }; id?: string };
  const turnId = result.turn?.id || result.id;
  if (turnId) state.activeTurns.set(egoId, turnId);
  state.pendingTurns.set(egoId, { text, codexThreadId, gotDelta: false, retried: false });
  await store.touchEgo(egoId);
  // 用户消息落事件日志（只落盘不广播）：回放恢复对话记录用
  store.appendEgoEvent(egoId, { type: 'user-message', text }).catch(() => undefined);
  log.info('chat turn started', { egoId, turnId, chars: text.length });
}

/**
 * 打断当前 turn；附带消息时，等 interrupted 落地后同线程续讲
 * （上下文保留，teach 线 spike 已验证）。无活跃 turn 时附带消息直接发。
 */
export async function interruptFenshenChat(
  egoId: string,
  text?: string,
  scope: MaterializeScope = {},
): Promise<void> {
  const ego = await store.getEgo(egoId);
  if (!ego) throw new store.FenshenServiceError('ego-not-found', '分身不存在', 404);

  const session = getCodexSession(chatKey(egoId));
  const turnId = state.activeTurns.get(egoId);
  if (session && turnId && ego.chatThreadId) {
    const interrupted = new Promise<void>((resolve) => {
      state.interruptWaiters.set(egoId, resolve);
      setTimeout(() => {
        if (state.interruptWaiters.delete(egoId)) resolve(); // 兜底 15s
      }, 15_000).unref?.();
    });
    await session.request('turn/interrupt', { threadId: ego.chatThreadId, turnId });
    await interrupted;
  }

  if (text?.trim()) {
    await sendFenshenMessage(egoId, text.trim(), scope);
  }
}
