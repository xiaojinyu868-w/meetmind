/**
 * 三段式转写渲染状态机 (M2 T2.6)
 *
 * 飞书妙记 / Google Meet / Otter 的共同工艺：把 ASR 流式输出分为三个视觉层次
 *   - **interim**（灰色斜体，抖动中）   : partial 结果，随时替换
 *   - **stable**（黑色正文，已稳定）   : 已经 N 次未变动的片段，不再抖动但尚未 commit
 *   - **final** （commit，时间戳锚定） : ASR 给出 isFinal=true 时进入最终态，不回滚
 *
 * 为什么分三段：只用 interim/final 会在"锁定瞬间"跳变（灰色 → 黑色），
 * 用户感知到"抖"。stable 层给出"我们已经稳定下来，只是还没最后确认"的中间态，
 * 视觉过渡更平滑，也给前端留了"撤回/纠错"的锚点。
 *
 * 这个文件是纯逻辑（无 React 依赖），方便单测。React hook 再单独封装。
 */

export interface TranscriptSegment {
  id: string;
  text: string;
  beginMs: number;
  endMs: number;
  itemId?: string;
}

export type RenderStatus = 'interim' | 'stable' | 'final';

export interface RenderedSegment extends TranscriptSegment {
  status: RenderStatus;
}

export interface StateMachineConfig {
  /** interim 多少次未变化后升级为 stable。默认 3 */
  stabilizationCount?: number;
  /** interim 至少稳定多久才升级为 stable。默认 500ms */
  stabilizationMs?: number;
}

interface InternalState {
  /** 已最终化的段（commit） */
  finals: RenderedSegment[];
  /** 活跃 interim/stable 段，key = itemId */
  active: Map<string, {
    segment: RenderedSegment;
    unchangedCount: number; // 同一文本连续出现几次
    firstSeenAt: number;
  }>;
}

export class TranscriptRenderMachine {
  private state: InternalState;
  private readonly stabilizationCount: number;
  private readonly stabilizationMs: number;

  constructor(config?: StateMachineConfig) {
    this.stabilizationCount = config?.stabilizationCount ?? 3;
    this.stabilizationMs = config?.stabilizationMs ?? 500;
    this.state = { finals: [], active: new Map() };
  }

  /**
   * 上报一个 interim 消息（partial result）。
   * @returns 更新后的完整渲染列表
   */
  handleInterim(payload: {
    itemId: string;
    text: string;
    beginMs: number;
    endMs: number;
    now?: number;
  }): RenderedSegment[] {
    const now = payload.now ?? Date.now();
    const existing = this.state.active.get(payload.itemId);

    if (!existing) {
      this.state.active.set(payload.itemId, {
        segment: {
          id: payload.itemId,
          itemId: payload.itemId,
          text: payload.text,
          beginMs: payload.beginMs,
          endMs: payload.endMs,
          status: 'interim',
        },
        unchangedCount: 1,
        firstSeenAt: now,
      });
    } else {
      const textChanged = existing.segment.text !== payload.text;
      const next: RenderedSegment = {
        ...existing.segment,
        text: payload.text,
        beginMs: payload.beginMs,
        endMs: payload.endMs,
      };

      let unchangedCount = textChanged ? 1 : existing.unchangedCount + 1;
      let firstSeenAt = textChanged ? now : existing.firstSeenAt;

      const elapsed = now - firstSeenAt;
      const stable =
        unchangedCount >= this.stabilizationCount && elapsed >= this.stabilizationMs;
      next.status = stable ? 'stable' : 'interim';

      this.state.active.set(payload.itemId, {
        segment: next,
        unchangedCount,
        firstSeenAt,
      });
    }

    return this.snapshot();
  }

  /**
   * 上报 final 消息（ASR 确认的结果）。
   * 从 active 里移除对应 itemId，追加到 finals 末尾。
   */
  handleFinal(payload: {
    itemId?: string;
    segments: { id: string; text: string; beginMs: number; endMs: number }[];
  }): RenderedSegment[] {
    if (payload.itemId !== undefined) {
      this.state.active.delete(payload.itemId);
    }
    for (const seg of payload.segments) {
      this.state.finals.push({ ...seg, status: 'final' });
    }
    return this.snapshot();
  }

  /** 获取当前完整渲染列表（finals + active 按时间排序） */
  snapshot(): RenderedSegment[] {
    const activeList = Array.from(this.state.active.values()).map((v) => v.segment);
    const all = [...this.state.finals, ...activeList];
    return all.sort((a, b) => a.beginMs - b.beginMs);
  }

  /** 清空所有状态 */
  reset(): void {
    this.state = { finals: [], active: new Map() };
  }

  /** 移除指定 itemId 的 active（用于 ASR replaces 场景） */
  dropActive(itemId: string): RenderedSegment[] {
    this.state.active.delete(itemId);
    return this.snapshot();
  }
}
