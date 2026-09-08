/**
 * engine-runner —— 把 stream-fn 的增量 text_delta 边解析边执行（spike runner.ts
 * 的产品化重写；spike 是整轮生成完再执行，这里闭合 action 立即进引擎）。
 *
 * 数据流：LLM text_delta → vendor 解析器（parseStructuredChunk 增量解析，含
 * [FIX vs upstream] 的顶层数组关闭判定）→ 闭合 item 进串行队列 → vendor
 * ActionEngine 执行（speech 走 AudioPacer 估时 pacing 维持 blocking 契约）。
 *
 * 事件出口（hooks，由 teach-engine-service 接到 teach-codex 事件总线）：
 * - 口播 text 增量 → onTextDelta（解析器吐出的可见文本切片）
 * - 闭合 action 执行前 → onToolCall；落板完成后 → onToolResult（{ok:true, board}）
 * - 越表/未知动作 → 跳过执行，计 unknownActions（onUnknownAction 钩子）
 *
 * 未闭合兜底：模型输出截断（顶层数组没收尾）时 finalize() 走 vendor
 * finalizeParser 的恢复路径——能救回多少救多少，绝不把裸 JSON 残片当口播。
 *
 * 解析器 ordered/textChunks 的配对约定（vendor stateless-generate.ts Step 5/6）：
 * 每个 ordered text 条目恰好消费一个 textChunk（已完成 item 的全量/剩余量），
 * 消费剩下的 textChunks 是"尾部未闭合 text item"的增量——累积进 pendingText，
 * 等它闭合（出现下一个 ordered 条目）或 finalize 时整体落成一次 speech。
 */
import type { Action } from '../vendor/openmaic/dsl';
import type { ActionEngine } from '../vendor/openmaic/action/engine';
import {
  createParserState,
  parseStructuredChunk,
  finalizeParser,
  type ParseResult,
  type ParsedAction,
} from '../vendor/openmaic/orchestration/stateless-generate';
import type { AudioPacer } from './audio-pacer';
import { actionToToolCallEvent, ensureElementId, isActionEnabled } from './action-map';

export interface EngineRunnerHooks {
  onTextDelta(text: string): void;
  onToolCall(call: { id: string; name: string; args: Record<string, unknown> }): void;
  onToolResult(id: string, result: Record<string, unknown>): void;
  onUnknownAction?(name: string): void;
}

export interface EngineRunnerDeps {
  engine: ActionEngine;
  pacer: AudioPacer;
  hooks: EngineRunnerHooks;
  /** 打断信号：贯到 engine.execute（play_video 等长动作）+ 本 runner 的队列 */
  signal?: AbortSignal;
  /** 落板确认 digest（对齐旧 BoardEnv {ok:true, board} 形状） */
  boardDigest: () => string;
}

type QueueItem = { kind: 'speech'; text: string } | { kind: 'action'; parsed: ParsedAction };

export interface TurnSummary {
  /** 顶层数组正常闭合（false = 模型输出截断，走了未闭合兜底） */
  closed: boolean;
  unknownActions: string[];
  executedActions: number;
  speechSegments: number;
}

export class EngineRunner {
  private readonly parser = createParserState();
  private queue: QueueItem[] = [];
  private pumping = false;
  private aborted = false;
  private pendingText = '';
  private speechCounter = 0;
  private elementCounter = 0;
  readonly unknownActions: string[] = [];
  private executedActions = 0;
  private speechSegments = 0;
  /** 顶层数组在流式期间自然闭合（finalizeParser 兜底会把 isDone 置 true，不算数） */
  private closedNaturally = false;

  constructor(private readonly deps: EngineRunnerDeps) {}

  /** 喂入一个 LLM 增量（service 从 pi message_update 的 text_delta 转发）。 */
  feedTextDelta(delta: string): void {
    if (this.aborted || !delta) return;
    const r = parseStructuredChunk(delta, this.parser);
    if (r.isDone) this.closedNaturally = true;
    this.apply(r);
    this.kick();
  }

  /**
   * 一轮结束：flush 解析器（截断兜底）+ 落 pendingText + 排空执行队列。
   * resolve 时机 = 板上最后一个动作执行完（turn-complete 在此之前发会露怯）。
   */
  async finalize(): Promise<TurnSummary> {
    if (!this.parser.isDone && !this.aborted) {
      this.apply(finalizeParser(this.parser));
    }
    if (this.pendingText && !this.aborted) {
      this.enqueueSpeech(this.pendingText);
      this.pendingText = '';
    }
    this.kick();
    await this.waitForDrain();
    return {
      closed: this.closedNaturally,
      unknownActions: [...this.unknownActions],
      executedActions: this.executedActions,
      speechSegments: this.speechSegments,
    };
  }

  /** 打断：清队列 + 放行当前 speech（pacer.abort），在飞的 wb_* 动作自然收尾。 */
  abort(): void {
    this.aborted = true;
    this.queue = [];
    this.pendingText = '';
    this.deps.pacer.abort();
  }

  get isAborted(): boolean {
    return this.aborted;
  }

  // ---------- 内部 ----------

  private apply(r: ParseResult): void {
    let chunkPtr = 0;
    for (const entry of r.ordered) {
      if (entry.type === 'text') {
        const chunk = r.textChunks[chunkPtr++] ?? '';
        if (chunk) this.deps.hooks.onTextDelta(chunk);
        if (this.pendingText) {
          this.enqueueSpeech(this.pendingText + chunk);
          this.pendingText = '';
        } else if (chunk) {
          this.enqueueSpeech(chunk);
        }
      } else {
        if (this.pendingText) {
          this.enqueueSpeech(this.pendingText);
          this.pendingText = '';
        }
        const action = r.actions[entry.index];
        if (action) this.queue.push({ kind: 'action', parsed: action });
      }
    }
    const rest = r.textChunks.slice(chunkPtr).join('');
    if (rest) {
      this.pendingText += rest;
      this.deps.hooks.onTextDelta(rest);
    }
  }

  private enqueueSpeech(text: string): void {
    if (!text.trim()) return;
    this.queue.push({ kind: 'speech', text });
  }

  private kick(): void {
    if (this.pumping) return;
    this.pumping = true;
    void this.pump().finally(() => {
      this.pumping = false;
    });
  }

  private async waitForDrain(): Promise<void> {
    while (this.pumping || this.queue.length > 0) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  private async pump(): Promise<void> {
    while (!this.aborted && this.queue.length > 0) {
      const item = this.queue.shift()!;
      if (item.kind === 'speech') {
        this.speechSegments++;
        this.deps.pacer.expectSpeech(item.text);
        await this.deps.engine.execute(
          { id: `speech_${++this.speechCounter}_${Date.now().toString(36)}`, type: 'speech', text: item.text } as unknown as Action,
          { signal: this.deps.signal },
        );
      } else {
        await this.executeAction(item.parsed);
      }
    }
  }

  private async executeAction(parsed: ParsedAction): Promise<void> {
    const name = parsed.actionName;
    if (!isActionEnabled(name)) {
      this.unknownActions.push(name);
      this.deps.hooks.onUnknownAction?.(name);
      return;
    }
    const args = ensureElementId(name, parsed.params, () => `a_${++this.elementCounter}`);
    const call = actionToToolCallEvent({ ...parsed, params: args }, `tc_${crypto.randomUUID()}`);
    this.deps.hooks.onToolCall(call);
    this.executedActions++;
    await this.deps.engine.execute(
      { id: (args.elementId as string) ?? call.id, type: name, ...args } as unknown as Action,
      { signal: this.deps.signal },
    );
    if (this.aborted) return;
    this.deps.hooks.onToolResult(call.id, { ok: true, board: this.deps.boardDigest() });
  }
}
