/**
 * 翻页关键帧检测器（纯逻辑，可单测）。
 *
 * 设计（调研结论，见 roadmap/v4.0）：
 *   - 以 1fps 喂入缩略帧 pHash，检测器只在「画面稳定后」产出关键帧——
 *     PPT 动画渐变、老师翻页中途、镜头抖动都不会误触发。
 *   - 翻回旧页（老师回退幻灯片）不产生重复关键帧（历史哈希去重）。
 *   - 与转录共用墙钟：调用方用录音时间轴的 timestampMs 喂入，
 *     产出的关键帧天然带 [MM:SS] 锚点。
 *
 * 判定流程：
 *   相邻两帧距离 > transitionThreshold → 视为「画面切换」，进入稳定观察期
 *   同一画面持续 ≥ minStableMs → 结算：
 *     与历史关键帧距离 ≤ dedupeThreshold → 'revisit'（不产出新帧）
 *     否则 → 'keep'（产出新关键帧）
 */

import { hammingDistance } from './phash';

export type KeyframeVerdict = 'keep' | 'drop' | 'revisit';

export interface KeyframeDetectorOptions {
  /** 相邻帧汉明距离超过此值判定为画面切换（默认 12/64） */
  transitionThreshold?: number;
  /** 与历史关键帧距离小于等于此值判定为翻回旧页（默认 6/64） */
  dedupeThreshold?: number;
  /** 画面需稳定多少毫秒才结算关键帧（默认 2500ms） */
  minStableMs?: number;
  /** 历史关键帧哈希容量（默认 128，一课 40-80 页足够） */
  historySize?: number;
}

export class KeyframeDetector {
  private readonly transitionThreshold: number;
  private readonly dedupeThreshold: number;
  private readonly minStableMs: number;
  private readonly historySize: number;

  /** 上一帧哈希（逐帧比对用） */
  private lastHash: bigint | null = null;
  /** 当前稳定画面的起始时间与代表哈希 */
  private stableSinceMs = 0;
  private stableHash: bigint | null = null;
  /** 当前稳定画面是否已结算过 */
  private settled = true;
  /** 已接受的关键帧哈希（去重历史） */
  private acceptedHashes: bigint[] = [];

  constructor(options: KeyframeDetectorOptions = {}) {
    this.transitionThreshold = options.transitionThreshold ?? 12;
    this.dedupeThreshold = options.dedupeThreshold ?? 6;
    this.minStableMs = options.minStableMs ?? 2500;
    this.historySize = options.historySize ?? 128;
  }

  /** 已接受的关键帧数量（不含 revisit） */
  get acceptedCount(): number {
    return this.acceptedHashes.length;
  }

  /**
   * 喂入一帧。timestampMs 应来自录音时间轴（与转录段同轴）。
   * 返回 'keep' 时调用方应抓取原分辨率帧并记录 timestampMs。
   */
  feed(hash: bigint, timestampMs: number): KeyframeVerdict {
    if (this.lastHash === null) {
      // 首帧：直接开始观察，不立即结算（避免开场黑屏/启动画面成为关键帧）
      this.lastHash = hash;
      this.stableHash = hash;
      this.stableSinceMs = timestampMs;
      this.settled = false;
      return 'drop';
    }

    const changed = hammingDistance(hash, this.lastHash) > this.transitionThreshold;
    this.lastHash = hash;

    if (changed) {
      this.stableHash = hash;
      this.stableSinceMs = timestampMs;
      this.settled = false;
      return 'drop';
    }

    if (this.settled || this.stableHash === null) return 'drop';
    if (timestampMs - this.stableSinceMs < this.minStableMs) return 'drop';

    // 画面已稳定足够久，结算
    return this.settle();
  }

  /** 录课结束时调用：最后一页若仍在观察期内且从未结算，强制结算一次 */
  flush(): KeyframeVerdict {
    if (this.settled || this.stableHash === null) return 'drop';
    return this.settle();
  }

  private settle(): KeyframeVerdict {
    this.settled = true;
    const current = this.stableHash as bigint;
    const isRevisit = this.acceptedHashes.some(
      (accepted) => hammingDistance(accepted, current) <= this.dedupeThreshold,
    );
    if (isRevisit) return 'revisit';

    this.acceptedHashes.push(current);
    if (this.acceptedHashes.length > this.historySize) {
      this.acceptedHashes.shift();
    }
    return 'keep';
  }
}
