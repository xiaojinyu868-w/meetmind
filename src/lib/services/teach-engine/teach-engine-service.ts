/**
 * teach-engine-service —— AI 家教「上课」线新引擎（pi loop + vendor OpenMAIC
 * 动作引擎 + 结构化动作直出）的编排服务，teach-session-service（codex 底座）的
 * 继任者。P1 只落后端：API 路由分发接线是下一阶段，本文件的对外签名即契约：
 *
 *   preflightTeachEngine(): { ok: true } | { ok: false; error: string }
 *   sendTeachEngineMessage(threadId, text): Promise<void>   // 409 防并发同旧服务
 *   interruptTeachEngineThread(threadId, text?): Promise<void>
 *
 * 结构：每线程一个 pi Agent（构造模式照 spike scenario.ts：显式 initialState
 * 压掉 coding 心智 + 全量 StreamFn 自控模型层）；LLM 增量 text_delta 直接喂
 * EngineRunner（vendor 解析器增量解析，闭合动作立即进 ActionEngine——边生成
 * 边执行）；口播估时 pacing 由 AudioPacer 维持引擎 blocking 契约。
 *
 * 事件出口复用 teach-codex 共享件：publish 走 event-bus.ts publishTeachEvent，
 * 落盘走 thread-store appendThreadEvent（data/teach-events/<threadId>.jsonl，
 * 与旧服务同一文件同一格式，重启恢复/复习线消费不变）。事件映射：
 *   口播 text 增量 → text-delta；闭合动作 → tool-call（name=新动作名）+
 *   落板确认 tool-result（{ok:true, board}）；一轮结束 → turn-complete；
 *   abort → interrupted；stream-fn fail → error。v1 无 image 动作，不发 image-ready。
 *
 * Next 重启恢复：首次发消息时从事件日志重建 pi 上下文（student-message → user、
 * text-delta 拼接 → assistant）+ 重放 wb_* tool-call（silent）重建 stage store。
 *
 * 注意：所有可变状态必须挂 globalThis——Next dev 下每个路由是独立编译 entry，
 * 模块级 Map 会被复制多份（旧服务头注的实测教训）。
 */

import { createLogger } from '@/lib/logger';
import {
  resolveTeachProvider,
  teachProviderApiKey,
  TeachConfig,
  type TeachProviderConfig,
} from '@/lib/config/teach.config';
import { buildTeachEngineInstructions } from '@/lib/prompts/teach-teacher-prompt';
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage, Message as PiMessage, Model } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { createOpenAI } from '@ai-sdk/openai';
import { publishTeachEvent, type TeachStreamEvent } from '../teach-codex/event-bus';
import * as store from '../teach-codex/thread-store';
import { createAiSdkStreamFn, type AiSdkStreamFnOptions } from './runtime/stream-fn';
import { loadTeachingSkills } from './runtime/skills';
import { createThreadStageStore, type ThreadStageStore } from './runtime/stage-store';
import { createBoardStores } from './runtime/board-stores';
import { AudioPacer } from './runtime/audio-pacer';
import { EngineRunner } from './runtime/engine-runner';
import { ActionEngine } from './vendor/openmaic/action/engine';
import { KNOWN_ACTIONS } from './runtime/action-map';

const log = createLogger('teach-engine');

export class TeachEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface EngineSession {
  agent: Agent;
  engine: ActionEngine;
  pacer: AudioPacer;
  stage: ThreadStageStore;
  runner: EngineRunner | null;
  turnActive: boolean;
  abortController: AbortController | null;
  turnPromise: Promise<void> | null;
  /** 本轮 stream-fn fail 的错误（pi message_update 的 error 事件捕获） */
  streamError: string | null;
  /** 标题跟随：首条 wb_draw_text 为课题标题则 renameThread，否则停留 topic */
  titleFollows: boolean;
}

interface RegistryState {
  sessions: Map<string, EngineSession>;
  /** ensureSession 串行化（防双击并发建两个 agent） */
  sessionInflight: Map<string, Promise<EngineSession>>;
}

const globalForEngine = globalThis as unknown as { __teachEngineState?: RegistryState };
const state: RegistryState = globalForEngine.__teachEngineState ?? {
  sessions: new Map(),
  sessionInflight: new Map(),
};
globalForEngine.__teachEngineState = state;

function emit(threadId: string, event: TeachStreamEvent): Promise<void> {
  publishTeachEvent(threadId, event);
  return store.appendThreadEvent(threadId, event).catch((cause) => {
    log.warn('event append failed', {
      threadId,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  });
}

/** 发消息前的同步预检（provider key 缺失时路由直接 500，不开 SSE） */
export function preflightTeachEngine(): { ok: true } | { ok: false; error: string } {
  const provider = resolveTeachProvider();
  if (!teachProviderApiKey(provider)) {
    return { ok: false, error: `教学引擎未配置 ${provider.apiKeyEnv}（provider=${provider.id}）` };
  }
  return { ok: true };
}

/** pi state 要求一个 Model 占位；真正的调用走 streamFn 桥（OpenMAIC 同款做法）。 */
function bridgeModel(): Model<never> {
  return {
    id: 'ai-sdk-bridge',
    name: 'AI SDK Bridge',
    api: 'openai-completions',
    provider: 'openai-compatible',
    baseUrl: '',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 8192,
  } as unknown as Model<never>;
}

/** teach.config provider → AI SDK LanguageModel（+ reasoning_effort 映射）。 */
function engineStreamFnOptions(provider: TeachProviderConfig): AiSdkStreamFnOptions {
  const apiKey = teachProviderApiKey(provider) ?? '';
  const openai = createOpenAI({ baseURL: provider.baseUrl, apiKey });
  const reasoningEffort = provider.upstreamParams?.reasoning_effort;
  return {
    languageModel: openai.chat(provider.model),
    maxOutputTokens: TeachConfig.engineMaxOutputTokens,
    providerOptions:
      typeof reasoningEffort === 'string' ? { openai: { reasoningEffort } } : undefined,
  };
}

/** 测试缝：替换 streamFn 工厂（仅单测 mock 用，生产永远是 createAiSdkStreamFn）。 */
let streamFnFactory: (opts: AiSdkStreamFnOptions) => StreamFn = createAiSdkStreamFn;
export function setTeachEngineStreamFnFactoryForTests(
  factory: ((opts: AiSdkStreamFnOptions) => StreamFn) | null,
): void {
  streamFnFactory = factory ?? createAiSdkStreamFn;
}

/** 板书 digest，对齐旧 BoardEnv {ok:true, board} 的 tool-result 形状。 */
function boardDigest(stage: ThreadStageStore): string {
  const els = stage.whiteboard.elements;
  if (els.length === 0) return '板书空';
  const lines = els.map((e) => {
    const label =
      e.type === 'text'
        ? String(e.content ?? '').replace(/<[^>]+>/g, '').slice(0, 24)
        : String(e.latex ?? e.shape ?? e.chartType ?? e.type);
    return `${e.id}(${e.type}): ${label}`;
  });
  return `板书 ${els.length} 个元素\n${lines.join('\n')}`;
}

const REPLAY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Next 重启恢复：事件日志 → pi 上下文 + stage store（wb_* 动作 silent 重放）。 */
async function rebuildFromEventLog(threadId: string, session: EngineSession): Promise<void> {
  const events = await store.readThreadEvents(threadId);
  if (events.length === 0) return;

  const messages: PiMessage[] = [];
  let assistantBuf = '';
  const flushAssistant = () => {
    if (!assistantBuf.trim()) {
      assistantBuf = '';
      return;
    }
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: assistantBuf }],
      api: 'unknown',
      provider: 'unknown',
      model: 'replay',
      usage: { ...REPLAY_USAGE },
      stopReason: 'stop',
      timestamp: 0,
    } as unknown as AssistantMessage);
    assistantBuf = '';
  };

  const known = new Set(KNOWN_ACTIONS);
  for (const ev of events) {
    if (ev.type === 'student-message') {
      flushAssistant();
      messages.push({ role: 'user', content: ev.text, timestamp: 0 });
    } else if (ev.type === 'text-delta') {
      assistantBuf += ev.text;
    } else if (ev.type === 'turn-complete' || ev.type === 'interrupted') {
      flushAssistant();
    } else if (ev.type === 'tool-call' && known.has(ev.name) && ev.name.startsWith('wb_')) {
      // 板上状态重放：silent（跳过动画/口播，只落状态）
      await session.engine
        .execute(
          { id: (ev.args.elementId as string) ?? ev.id, type: ev.name, ...ev.args } as never,
          { silent: true },
        )
        .catch(() => undefined);
    }
  }
  flushAssistant();
  session.agent.state.messages = messages;
  log.info('engine session rebuilt from event log', { threadId, messages: messages.length });
}

/** 标题跟随：prompt 约定首条 wb_draw_text 写正式课题标题。 */
async function followTitle(
  threadId: string,
  session: EngineSession,
  call: { name: string; args: Record<string, unknown> },
): Promise<void> {
  if (!session.titleFollows || call.name !== 'wb_draw_text') return;
  const content =
    typeof call.args.content === 'string' ? call.args.content.replace(/<[^>]+>/g, '').trim() : '';
  if (!content) return;
  const thread = await store.getThread(threadId).catch(() => null);
  if (!thread || thread.title !== thread.topic) {
    session.titleFollows = false;
    return;
  }
  await store.renameThread(threadId, content).catch(() => undefined);
  session.titleFollows = false;
  log.info('thread title follows first wb_draw_text', { threadId, title: content.slice(0, 30) });
}

async function ensureSession(row: store.TeachThreadRow): Promise<EngineSession> {
  const existing = state.sessions.get(row.id);
  if (existing) return existing;
  const inflight = state.sessionInflight.get(row.id);
  if (inflight) return inflight;

  const starting = (async (): Promise<EngineSession> => {
    const provider = resolveTeachProvider();
    const skills = await loadTeachingSkills(TeachConfig.skillsDir, {
      personaRoot: TeachConfig.personaSkillsRoot,
    });
    if (skills.diagnostics.length > 0) {
      log.warn('skills diagnostics', { threadId: row.id, diagnostics: skills.diagnostics });
    }

    const stage = createThreadStageStore(row.id, () => {});
    const stores = createBoardStores();
    const pacer = new AudioPacer();
    const engine = new ActionEngine(stage, pacer, null, stores);
    const agent = new Agent({
      initialState: {
        systemPrompt: buildTeachEngineInstructions(row.topic, skills.systemPromptBlock),
        model: bridgeModel(),
        thinkingLevel: 'off',
        tools: [skills.readTool],
      },
      streamFn: streamFnFactory(engineStreamFnOptions(provider)),
    });

    const session: EngineSession = {
      agent,
      engine,
      pacer,
      stage,
      runner: null,
      turnActive: false,
      abortController: null,
      turnPromise: null,
      streamError: null,
      titleFollows: true,
    };
    await rebuildFromEventLog(row.id, session);
    state.sessions.set(row.id, session);
    log.info('engine session created', {
      threadId: row.id,
      provider: provider.id,
      skills: skills.skills.length,
    });
    return session;
  })();

  state.sessionInflight.set(row.id, starting);
  try {
    return await starting;
  } finally {
    state.sessionInflight.delete(row.id);
  }
}

/** 一轮教学：pi loop 驱动 + EngineRunner 边生成边执行，事件全部走 emit。 */
function runTurn(session: EngineSession, threadId: string, text: string): void {
  session.turnActive = true;
  session.streamError = null;
  session.pacer.reset();
  const abortController = new AbortController();
  session.abortController = abortController;

  const runner = new EngineRunner({
    engine: session.engine,
    pacer: session.pacer,
    signal: abortController.signal,
    boardDigest: () => boardDigest(session.stage),
    hooks: {
      onTextDelta: (t) => void emit(threadId, { type: 'text-delta', text: t }),
      onToolCall: (call) => {
        void emit(threadId, { type: 'tool-call', id: call.id, name: call.name, args: call.args });
        void followTitle(threadId, session, call);
      },
      onToolResult: (id, result) => void emit(threadId, { type: 'tool-result', id, result }),
      onUnknownAction: (name) => log.warn('action not in enabled vocabulary, skipped', { threadId, name }),
    },
  });
  session.runner = runner;

  const unsubscribe = session.agent.subscribe((event: AgentEvent) => {
    if (event.type !== 'message_update') return;
    const e = event.assistantMessageEvent;
    if (e.type === 'text_delta') runner.feedTextDelta(e.delta);
    else if (e.type === 'error') {
      session.streamError =
        (e.error as AssistantMessage | undefined)?.errorMessage ?? e.reason ?? 'LLM stream error';
    }
  });

  const done = (async () => {
    try {
      await session.agent.prompt(text);
      if (abortController.signal.aborted) {
        runner.abort();
        await emit(threadId, { type: 'interrupted' });
        return;
      }
      const summary = await runner.finalize();
      if (!summary.closed) {
        log.warn('turn output truncated (unclosed top-level array)', { threadId });
      }
      if (abortController.signal.aborted) {
        await emit(threadId, { type: 'interrupted' });
      } else if (session.streamError) {
        await emit(threadId, { type: 'error', message: session.streamError });
      } else {
        await emit(threadId, { type: 'turn-complete' });
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        await emit(threadId, { type: 'interrupted' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        log.error('engine turn failed', { threadId, error: message });
        await emit(threadId, { type: 'error', message });
      }
    } finally {
      unsubscribe();
      session.turnActive = false;
      session.runner = null;
      session.abortController = null;
      session.turnPromise = null;
      store.touchThread(threadId).catch(() => {});
    }
  })();
  session.turnPromise = done;
}

/**
 * 发学生消息（或开课指令）：确保会话 → 异步开讲。
 * 409 防并发语义同旧 teach-session-service：一轮在讲时直接抛 turn-active。
 * resolve 时机 = 会话就绪、turn 已 kickoff（事件随后经总线流出）；同步错误抛给路由。
 */
export async function sendTeachEngineMessage(threadId: string, text: string): Promise<void> {
  const row = await store.getThread(threadId);
  if (!row) throw new TeachEngineError('thread-not-found', '课程不存在', 404);
  const existing = state.sessions.get(threadId);
  if (existing?.turnActive) {
    throw new TeachEngineError('turn-active', '老师正在讲，先打断或等讲完', 409);
  }

  const session = await ensureSession(row);
  await store.touchThread(threadId);
  // 学生消息落事件日志（只落盘不广播）：回放恢复对话记录用
  store.appendThreadEvent(threadId, { type: 'student-message', text }).catch(() => undefined);
  runTurn(session, threadId, text);
  log.info('engine turn started', { threadId, chars: text.length });
}

/**
 * 打断当前 turn；附带学生消息时，等 interrupted 落地后同线程续讲（上下文保留）。
 * signal 贯通：pi agent.abort() → stream-fn 的 abortSignal → streamText 断流；
 * runner.abort() → 清执行队列 + pacer 放行当前 speech。
 */
export async function interruptTeachEngineThread(threadId: string, text?: string): Promise<void> {
  const row = await store.getThread(threadId);
  if (!row) throw new TeachEngineError('thread-not-found', '课程不存在', 404);

  const session = state.sessions.get(threadId);
  if (session?.turnActive) {
    session.runner?.abort();
    session.abortController?.abort();
    session.agent.abort();
    if (session.turnPromise) {
      await Promise.race([
        session.turnPromise,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 15_000).unref?.();
        }),
      ]);
    }
  }

  if (text?.trim()) {
    await sendTeachEngineMessage(threadId, text.trim());
  }
}
