'use client';

/**
 * board-timing — 节奏诊断打点通道（2026-08 讲解节奏打磨用）。
 *
 * 播放器/画布在关键节点广播 `board:timing` CustomEvent，诊断脚本
 * （scripts/board-rhythm-audit.ts）用 Playwright 收集后做逐段节奏分析：
 * 段时长估算 vs 实际、动作触发→完成延迟、段末闸门等待、降级发生点。
 * 生产零开销（不订阅就是一次无人接收的 dispatch）。
 */

export type BoardTimingType =
  | 'segment-start' // 段起播（含估算时长/字数/是否有 cue）
  | 'segment-end' // 段音频念完（进入闸门或推进）
  | 'gate-wait' // 段末闸门开始等书写 drain
  | 'gate-release' // 闸门放行（含等待时长）
  | 'write-done' // 一个 write 写完（key）
  | 'clock-fallback' // 声音链降级（audio→speechSynthesis）
  | 'ink-hold' // v23 反向背压：嘴到新动作 cue 时笔有积压，音频在词边界 hold 住
  | 'ink-hold-release' // 背压放行：笔已追上（含等待时长）
  | 'ink-hold-forced'; // 背压超时强制放行（残余漂移交段末闸门）

export interface BoardTimingDetail {
  page: number;
  segment?: number;
  key?: string;
  estimatedMs?: number;
  actualMs?: number;
  chars?: number;
  waitedMs?: number;
  via?: string;
}

export function emitBoardTiming(type: BoardTimingType, detail: BoardTimingDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('board:timing', { detail: { type, ...detail } }));
}

export function subscribeBoardTiming(
  handler: (payload: BoardTimingDetail & { type: BoardTimingType }) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<BoardTimingDetail & { type: BoardTimingType }>).detail);
  };
  window.addEventListener('board:timing', listener);
  return () => window.removeEventListener('board:timing', listener);
}
