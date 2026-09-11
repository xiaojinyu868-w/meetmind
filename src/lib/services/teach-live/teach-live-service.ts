/**
 * teach-live-service —— AI 家教「上课」线第三代引擎（live stage）的编排服务。
 *
 * 与前两代的根本差别：模型直出「标签流」（口播 / 板书块 / 动作交错），服务端只做
 * 三件事——增量解析（live-markup-parser）、事件扇出（复用 teach-codex 的 event-bus +
 * thread-store 落盘）、慢操作异步化（生图）。没有工具 loop、没有子进程、没有
 * 板书环境模拟：板面状态由前端按事件重建，节奏由前端按语音演出。一轮 = 一次
 * streamText。
 *
 * 对外契约（路由层按此接线，与前两条线同形）：
 *   preflightTeachLive(): { ok: true } | { ok: false; error }
 *   sendTeachLiveMessage(threadId, text): Promise<void>      // 404 thread-not-found / 409 turn-active
 *   interruptTeachLiveThread(threadId, text?): Promise<void> // abort 后附 text 则同线程续讲
 *
 * 事件出口：block-open / block-delta / block-close / cue（src/types/teach-live.ts）+
 * 口播正文 text-delta + turn-complete / interrupted / error / image-ready。
 * 所有可变状态挂 globalThis（Next dev 每路由独立编译 entry 的老教训）。
 */

import { createLogger } from '@/lib/logger';
import { liveCostCny, resolveTeachLiveProvider, teachProviderApiKey, TeachConfig, type TeachProviderConfig } from '@/lib/config/teach.config';
import { buildTeachLivePrompt } from '@/lib/prompts/teach-live-prompt';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type LanguageModel } from 'ai';
import { LIVE_SPEECH_KINDS, type LiveBlockKind, type LiveEvent } from '@/types/teach-live';
import { publishTeachEvent, type TeachStreamEvent } from '../teach-codex/event-bus';
import * as store from '../teach-codex/thread-store';
import { LiveMarkupParser } from './live-markup-parser';
import { compactMarkupForHistory, eventsToHistory, trimHistory, type ChatTurnMessage } from './live-history';
import { generateLiveImage, scheduleMissingLiveImages } from './live-image';
import { InlineMathStream } from './inline-math-stream';

const log = createLogger('teach-live');

export class TeachLiveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface LiveSession {
  threadId: string;
  topic: string;
  systemPrompt: string;
  history: ChatTurnMessage[];
  turnActive: boolean;
  abortController: AbortController | null;
  turnPromise: Promise<void> | null;
  /** 标题跟随：首个带 title 的 scene 改课程名（仅当 title 仍等于 topic） */
  titleFollows: boolean;
  /** 线程内块 id 计数（跨轮唯一） */
  blockCounter: number;
}

interface RegistryState {
  sessions: Map<string, LiveSession>;
  inflight: Map<string, Promise<LiveSession>>;
}

const globalForLive = globalThis as unknown as { __teachLiveState?: RegistryState };
const state: RegistryState = globalForLive.__teachLiveState ?? { sessions: new Map(), inflight: new Map() };
globalForLive.__teachLiveState = state;

function emit(threadId: string, event: TeachStreamEvent): void {
  publishTeachEvent(threadId, event);
  void store.appendThreadEvent(threadId, event).catch((cause) => {
    log.warn('event append failed', { threadId, error: cause instanceof Error ? cause.message : String(cause) });
  });
}

export function preflightTeachLive(): { ok: true } | { ok: false; error: string } {
  const provider = resolveTeachLiveProvider();
  if (!teachProviderApiKey(provider)) {
    return { ok: false, error: `舞台引擎未配置 ${provider.apiKeyEnv}（provider=${provider.id}）` };
  }
  return { ok: true };
}

/** 测试缝：替换模型（单测注入 MockLanguageModel）；生产永远走 provider 注册表 */
let modelFactory: ((provider: TeachProviderConfig) => LanguageModel) | null = null;
export function setTeachLiveModelFactoryForTests(factory: ((provider: TeachProviderConfig) => LanguageModel) | null): void {
  modelFactory = factory;
}

function languageModelFor(provider: TeachProviderConfig): LanguageModel {
  if (modelFactory) return modelFactory(provider);
  const openai = createOpenAI({ baseURL: provider.baseUrl, apiKey: teachProviderApiKey(provider) ?? '' });
  return openai.chat(provider.model);
}

function providerOptionsFor(provider: TeachProviderConfig): Record<string, Record<string, unknown>> | undefined {
  const effort = provider.upstreamParams?.reasoning_effort;
  return typeof effort === 'string' ? { openai: { reasoningEffort: effort } } : undefined;
}

async function ensureSession(row: store.TeachThreadRow): Promise<LiveSession> {
  const existing = state.sessions.get(row.id);
  if (existing) return existing;
  const inflight = state.inflight.get(row.id);
  if (inflight) return inflight;

  const starting = (async (): Promise<LiveSession> => {
    const events = await store.readThreadEvents(row.id);
    const history = eventsToHistory(events);
    // 重启自愈：历史里缺图的 image 块补生成
    scheduleMissingLiveImages(row.id, events);
    let blockCounter = 0;
    for (const ev of events) {
      if (ev.type === 'block-open') {
        const n = Number(/^lb_(\d+)$/.exec(ev.id)?.[1] ?? 0);
        if (n > blockCounter) blockCounter = n;
      }
    }
    const session: LiveSession = {
      threadId: row.id,
      topic: row.topic,
      systemPrompt: buildTeachLivePrompt(row.topic, store.learnerFactsFromRow(row)),
      history,
      turnActive: false,
      abortController: null,
      turnPromise: null,
      titleFollows: row.title === row.topic,
      blockCounter,
    };
    state.sessions.set(row.id, session);
    log.info('live session created', { threadId: row.id, historyMessages: history.length });
    return session;
  })();

  state.inflight.set(row.id, starting);
  try {
    return await starting;
  } finally {
    state.inflight.delete(row.id);
  }
}

async function followTitle(session: LiveSession, title: string): Promise<void> {
  if (!session.titleFollows) return;
  session.titleFollows = false;
  const clean = title.trim();
  if (!clean) return;
  const thread = await store.getThread(session.threadId).catch(() => null);
  if (!thread || thread.title !== thread.topic) return;
  await store.renameThread(session.threadId, clean).catch(() => undefined);
}

/** 口播 / 要点 / 公式里的 {{ }} 在服务端算好（TTS、字幕、记录、历史看到的都是数字） */
const INLINE_MATH_KINDS: ReadonlySet<LiveBlockKind> = new Set(['say', 'ask', 'note', 'math']);

interface TurnBuffers {
  openKinds: Map<string, LiveBlockKind>;
  imagePrompts: Map<string, string>;
  inlineMath: Map<string, InlineMathStream>;
}

/** 解析器事件 → 总线事件（口播正文改走 text-delta；image 块闭合即开始生图） */
function forwardLiveEvent(session: LiveSession, ev: LiveEvent, buffers: TurnBuffers): void {
  const threadId = session.threadId;
  const { openKinds, imagePrompts, inlineMath } = buffers;
  const emitBody = (id: string, kind: LiveBlockKind | undefined, text: string) => {
    if (!text) return;
    if (kind && LIVE_SPEECH_KINDS.has(kind)) emit(threadId, { type: 'text-delta', text });
    else emit(threadId, { type: 'block-delta', id, text });
  };
  switch (ev.type) {
    case 'block-open':
      openKinds.set(ev.id, ev.kind);
      if (ev.kind === 'image') imagePrompts.set(ev.id, ev.attrs.prompt ?? '');
      if (INLINE_MATH_KINDS.has(ev.kind)) inlineMath.set(ev.id, new InlineMathStream());
      emit(threadId, ev);
      return;
    case 'block-delta': {
      const kind = openKinds.get(ev.id);
      if (kind === 'image') {
        imagePrompts.set(ev.id, (imagePrompts.get(ev.id) ?? '') + ev.text);
        emit(threadId, ev);
        return;
      }
      const math = inlineMath.get(ev.id);
      emitBody(ev.id, kind, math ? math.push(ev.text) : ev.text);
      return;
    }
    case 'block-close': {
      const kind = openKinds.get(ev.id);
      const math = inlineMath.get(ev.id);
      if (math) {
        emitBody(ev.id, kind, math.flush());
        inlineMath.delete(ev.id);
      }
      emit(threadId, ev);
      openKinds.delete(ev.id);
      if (kind === 'image') {
        const prompt = imagePrompts.get(ev.id) ?? '';
        imagePrompts.delete(ev.id);
        void generateLiveImage(threadId, ev.id, prompt);
      }
      return;
    }
    case 'cue':
      emit(threadId, ev);
      if (ev.name === 'scene' && ev.args.title) void followTitle(session, ev.args.title);
      return;
  }
}

function runTurn(session: LiveSession, text: string, boardNote?: string): void {
  const threadId = session.threadId;
  const provider = resolveTeachLiveProvider();
  session.turnActive = true;
  const abortController = new AbortController();
  session.abortController = abortController;
  // 板上情况（前端报告的 draw 脚本错误等）只进模型上下文，不进课堂记录
  session.history.push({ role: 'user', content: boardNote ? `${text}\n\n（板上情况，学生看不到这段：${boardNote}）` : text });

  const parser = new LiveMarkupParser(() => `lb_${++session.blockCounter}`);
  const buffers: TurnBuffers = { openKinds: new Map(), imagePrompts: new Map(), inlineMath: new Map() };
  let raw = '';
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;

  const done = (async () => {
    try {
      const result = streamText({
        model: languageModelFor(provider),
        system: session.systemPrompt,
        messages: trimHistory(session.history),
        abortSignal: abortController.signal,
        maxOutputTokens: TeachConfig.liveMaxOutputTokens,
        temperature: TeachConfig.liveTemperature,
        providerOptions: providerOptionsFor(provider) as Parameters<typeof streamText>[0]['providerOptions'],
      });
      for await (const delta of result.textStream) {
        if (abortController.signal.aborted) break;
        if (!delta) continue;
        if (firstTokenAt === null) firstTokenAt = Date.now();
        raw += delta;
        for (const ev of parser.push(delta)) forwardLiveEvent(session, ev, buffers);
      }
      for (const ev of parser.finish()) forwardLiveEvent(session, ev, buffers);
      // 被打断也尽量拿 usage（上游已计费）；拿不到就不发
      const usage = await Promise.race([
        Promise.resolve(result.usage).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (usage && (usage.inputTokens || usage.outputTokens)) {
        const inputTokens = usage.inputTokens ?? 0;
        const outputTokens = usage.outputTokens ?? 0;
        emit(threadId, {
          type: 'usage',
          inputTokens,
          outputTokens,
          costCny: liveCostCny(inputTokens, outputTokens),
          ms: Date.now() - startedAt,
          model: provider.model,
        });
      }
      log.info('live turn finished', {
        threadId,
        ttftMs: firstTokenAt ? firstTokenAt - startedAt : null,
        totalMs: Date.now() - startedAt,
        chars: raw.length,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        interrupted: abortController.signal.aborted,
      });
      emit(threadId, abortController.signal.aborted ? { type: 'interrupted' } : { type: 'turn-complete' });
    } catch (err) {
      for (const ev of parser.finish()) forwardLiveEvent(session, ev, buffers);
      if (abortController.signal.aborted) {
        emit(threadId, { type: 'interrupted' });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        log.error('live turn failed', { threadId, error: message });
        emit(threadId, { type: 'error', message: `老师这句没说出来（${message.slice(0, 120)}）` });
      }
    } finally {
      const compact = compactMarkupForHistory(raw).trim();
      if (compact) {
        session.history.push({
          role: 'assistant',
          content: abortController.signal.aborted ? `${compact}\n<!-- 被学生打断 -->` : compact,
        });
      } else {
        // 没说出任何东西：把这条 user 收回，避免历史里出现连续 user
        session.history.pop();
      }
      session.turnActive = false;
      session.abortController = null;
      session.turnPromise = null;
      store.touchThread(threadId).catch(() => {});
    }
  })();
  session.turnPromise = done;
}

export async function sendTeachLiveMessage(threadId: string, text: string, boardNote?: string): Promise<void> {
  const row = await store.getThread(threadId);
  if (!row) throw new TeachLiveError('thread-not-found', '课程不存在', 404);
  const existing = state.sessions.get(threadId);
  if (existing?.turnActive) throw new TeachLiveError('turn-active', '老师正在讲，先打断或等讲完', 409);

  const session = await ensureSession(row);
  await store.touchThread(threadId);
  void store.appendThreadEvent(threadId, { type: 'student-message', text }).catch(() => undefined);
  runTurn(session, text, boardNote?.trim().slice(0, 600) || undefined);
  log.info('live turn started', { threadId, chars: text.length, boardNote: Boolean(boardNote) });
}

export async function interruptTeachLiveThread(threadId: string, text?: string, boardNote?: string): Promise<void> {
  const row = await store.getThread(threadId);
  if (!row) throw new TeachLiveError('thread-not-found', '课程不存在', 404);
  const session = state.sessions.get(threadId);
  if (session?.turnActive) {
    session.abortController?.abort();
    if (session.turnPromise) {
      await Promise.race([
        session.turnPromise,
        new Promise<void>((resolve) => {
          setTimeout(resolve, 15_000).unref?.();
        }),
      ]);
    }
  }
  if (text?.trim()) await sendTeachLiveMessage(threadId, text.trim(), boardNote);
}
