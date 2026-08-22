/**
 * mockTeachStream — 后端就绪前的本地 mock 事件流。
 *
 * 把 public/demo/board-script-agent.json（pages/segments/actions 结构）转换
 * 成 teach-events 契约的事件流按时间吐出，保证 /teach 页完整可演示：
 * - narration 段：text-delta 按字流出，cue（charIndex→actionIndex）到位时
 *   插入对应 tool-call（"说完就写"的嘴手一体靠脚本 cue 复现）
 * - checkpoint 段：提问讲完 + ask tool-call 后 turn-complete，挂起等学生作答；
 *   answer() 先把「你的答案：…」write 上板（学生作答上墙演示），再给解析，
 *   然后续播剩余脚本
 * - 普通提问 ask()：canned 解答（引用提问会把 quote 织进回答）
 *
 * interrupt 语义：abort() 打断当前流出（generators 检查 aborted 标志）。
 * 后端就绪后本文件不再被引用（teach-client.ts 一行 flag 切换）。
 */

import type { BoardAction, BoardCue, BoardScript } from '@/lib/ai-native/plugins/board-script';
import { boardActionToToolCall } from './teach-events';
import type { TeachEvent } from './teach-events';

export interface MockPace {
  /** 每个 text-delta 间隔 ms（默认 36；?pace= 可覆盖，截图/录屏用） */
  deltaMs?: number;
  /** 每个 text-delta 携带的字符数 */
  charsPerDelta?: number;
  /** tool-call 之间的间隔 ms */
  toolDelayMs?: number;
}

interface NarrationUnit {
  kind: 'narration';
  text: string;
  actions: BoardAction[];
  cues: BoardCue[];
}
interface CheckpointUnit {
  kind: 'checkpoint';
  spoken: string;
  question: string;
  answer: string;
}
type MockUnit = NarrationUnit | CheckpointUnit | { kind: 'flip' };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** BoardScript → 线性单元流（页边界插 flip 标记） */
export function flattenScript(script: BoardScript): MockUnit[] {
  const units: MockUnit[] = [];
  script.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) units.push({ kind: 'flip' });
    for (const segment of page.segments) {
      if (segment.type === 'checkpoint') {
        units.push({
          kind: 'checkpoint',
          spoken: segment.narrationDisplay ?? segment.narration,
          question: segment.question.text,
          answer: segment.answerDisplay ?? segment.answer,
        });
      } else {
        units.push({
          kind: 'narration',
          text: segment.narrationDisplay ?? segment.narration,
          actions: segment.actions,
          cues: segment.cues ?? [],
        });
      }
    }
  });
  return units;
}

export class MockTeachSession {
  readonly title: string;
  private readonly units: MockUnit[];
  private readonly deltaMs: number;
  private readonly charsPerDelta: number;
  private readonly toolDelayMs: number;
  private cursor = 0;
  private toolSeq = 0;
  private aborted = false;
  /** checkpoint 挂起中：下一条学生消息按"作答"处理（答案上墙演示） */
  pendingCheckpoint: CheckpointUnit | null = null;

  constructor(script: BoardScript, pace: MockPace = {}) {
    this.title = script.title;
    this.units = flattenScript(script);
    this.deltaMs = pace.deltaMs ?? 36;
    this.charsPerDelta = pace.charsPerDelta ?? 2;
    this.toolDelayMs = pace.toolDelayMs ?? 240;
  }

  /** interrupt：当前流出尽快停（生成器每个 yield 前检查） */
  abort(): void {
    this.aborted = true;
  }

  /** 快照/恢复（历史线程续播用） */
  getCursor(): number {
    return this.cursor;
  }
  restore(cursor: number, pendingCheckpoint: boolean): void {
    this.cursor = Math.max(0, Math.min(cursor, this.units.length));
    this.pendingCheckpoint = pendingCheckpoint ? this.findCheckpointBefore(cursor) : null;
  }

  isDone(): boolean {
    return this.cursor >= this.units.length && !this.pendingCheckpoint;
  }

  private findCheckpointBefore(cursor: number): CheckpointUnit | null {
    for (let index = cursor - 1; index >= 0; index -= 1) {
      const unit = this.units[index];
      if (unit.kind === 'checkpoint') return unit;
    }
    return null;
  }

  private nextToolId(): string {
    this.toolSeq += 1;
    return `mock-tc-${this.toolSeq}`;
  }

  private async *emitText(text: string): AsyncGenerator<TeachEvent> {
    for (let at = 0; at < text.length; at += this.charsPerDelta) {
      if (this.aborted) return;
      yield { type: 'text-delta', text: text.slice(at, at + this.charsPerDelta) };
      await sleep(this.deltaMs);
    }
  }

  private async *emitAction(action: BoardAction): AsyncGenerator<TeachEvent> {
    if (this.aborted) return;
    // pause：不产生可见 chip，但让流真的停一下（上限 1.2s，演示不等满 5s）
    if (action.type === 'pause') {
      await sleep(Math.min(action.ms, 1200));
      return;
    }
    const id = this.nextToolId();
    yield boardActionToToolCall(action, id);
    // 生成流速节奏：write 按字数拖住后续事件（模拟 agent 边写边讲，
    // 避免 chat 文本远快于板面书写接力）；上限 3s 防长公式卡流
    if (action.type === 'write') {
      await sleep(Math.min(action.text.length * 90, 3000));
    } else {
      await sleep(this.toolDelayMs);
    }
    if (this.aborted) return;
    yield { type: 'tool-result', id, result: { ok: true } };
  }

  /** narration 单元：text-delta 主流 + cue 到位插 tool-call，收尾补发无 cue 动作 */
  private async *emitNarration(unit: NarrationUnit): AsyncGenerator<TeachEvent> {
    const emitted = new Set<number>();
    // cue 按 charIndex 排序扫描（数据本身按动作序，防御性排序）
    const cues = [...unit.cues].sort((a, b) => a.charIndex - b.charIndex);
    for (let at = 0; at < unit.text.length; at += this.charsPerDelta) {
      if (this.aborted) return;
      yield { type: 'text-delta', text: unit.text.slice(at, at + this.charsPerDelta) };
      const reached = at + this.charsPerDelta;
      for (const cue of cues) {
        if (cue.charIndex <= reached && !emitted.has(cue.actionIndex) && unit.actions[cue.actionIndex]) {
          emitted.add(cue.actionIndex);
          yield* this.emitAction(unit.actions[cue.actionIndex]);
        }
      }
      await sleep(this.deltaMs);
    }
    for (let index = 0; index < unit.actions.length; index += 1) {
      if (emitted.has(index)) continue;
      yield* this.emitAction(unit.actions[index]);
    }
  }

  /** 开课 / 续播：从 cursor 播到下一个 checkpoint（挂起）或脚本结束 */
  async *run(): AsyncGenerator<TeachEvent> {
    this.aborted = false;
    while (this.cursor < this.units.length) {
      if (this.aborted) {
        yield { type: 'interrupted' };
        return;
      }
      const unit = this.units[this.cursor];
      this.cursor += 1;
      if (unit.kind === 'flip') {
        const id = this.nextToolId();
        yield { type: 'tool-call', id, name: 'flip_page', args: {} };
        await sleep(this.toolDelayMs);
        yield { type: 'tool-result', id, result: { ok: true } };
      } else if (unit.kind === 'narration') {
        yield* this.emitNarration(unit);
      } else {
        // checkpoint：提问讲完 → 题目写上板 → ask 挂 chip，然后挂起等学生作答
        yield* this.emitText(unit.spoken);
        yield* this.emitAction({ type: 'write', text: unit.question, role: 'step' });
        const id = this.nextToolId();
        yield { type: 'tool-call', id, name: 'ask', args: { question: unit.question } };
        yield { type: 'tool-result', id, result: { ok: true } };
        this.pendingCheckpoint = unit;
        yield { type: 'turn-complete' };
        return;
      }
    }
    const id = this.nextToolId();
    yield { type: 'tool-call', id, name: 'finish', args: {} };
    yield { type: 'tool-result', id, result: { ok: true } };
    yield { type: 'turn-complete' };
  }

  /**
   * 学生作答（checkpoint 挂起中）：「你的答案：…」write 上板（作答上墙演示），
   * 口述解析，然后续播剩余脚本。
   */
  async *answer(text: string): AsyncGenerator<TeachEvent> {
    this.aborted = false;
    const checkpoint = this.pendingCheckpoint;
    this.pendingCheckpoint = null;
    const short = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    yield* this.emitAction({ type: 'write', text: `你的答案：${short}`, role: 'step' });
    if (checkpoint) {
      yield* this.emitText(`好，看看你答的。${checkpoint.answer}`);
    } else {
      yield* this.emitText('好，看看你答的。思路对，我们接着往下走。');
    }
    yield* this.run();
  }

  /** 普通提问：canned 解答（引用提问把 quote 织进回答；后端接入后由 agent 真实解答） */
  async *ask(question: string, quote?: string): AsyncGenerator<TeachEvent> {
    this.aborted = false;
    const short = question.length > 30 ? `${question.slice(0, 30)}…` : question;
    const head = quote ? `你划的「${quote}」——` : `「${short}」——`;
    yield* this.emitText(
      `${head}它正好接着黑板上刚写的那一步。先把已知条件按一般式对好，再套公式，每一步都能在板书上找到对应的位置。课讲完后你可以划线再问我，我们对着板书一步步过。`,
    );
    yield { type: 'turn-complete' };
  }
}
