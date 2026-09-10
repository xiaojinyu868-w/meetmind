/**
 * podcast-player-model — 播放条与逐字稿跟随的纯函数（可单测）。
 *
 * - 进度条拖动：指针位置 → 时间（夹在 0..duration）；
 * - 键盘 ←→ 5 秒；
 * - 逐字稿按比例对齐：第 i 句 ≈ i / N 的时间点（脚本没有逐句时间戳，这是诚实的近似）；
 * - 章节同理按序号比例跳播。
 */

export const SEEK_STEP_SEC = 5;
export const RATES = [1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof RATES)[number];

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 指针在进度条上的位置 → 时间 */
export function timeAtPointer(clientX: number, rect: { left: number; width: number }, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || rect.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * duration;
}

export function stepTime(current: number, deltaSec: number, duration: number): number {
  const max = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(0, current + deltaSec));
}

export function nextRate(current: PlaybackRate): PlaybackRate {
  return RATES[(RATES.indexOf(current) + 1) % RATES.length];
}

/** 当前时间落在第几句（按比例；N 句均分整段） */
export function lineIndexForTime(time: number, duration: number, lineCount: number): number {
  if (lineCount <= 0 || !Number.isFinite(duration) || duration <= 0) return -1;
  return Math.min(lineCount - 1, Math.max(0, Math.floor((time / duration) * lineCount)));
}

/** 跳到第 i 句的开头时间 */
export function timeForLine(lineIndex: number, duration: number, lineCount: number): number {
  if (lineCount <= 0 || !Number.isFinite(duration) || duration <= 0) return 0;
  return (Math.max(0, lineIndex) / lineCount) * duration;
}

/**
 * 自动跟随的判定：用户主动滚动（wheel / touch）后停止跟随；
 * 当前句重新回到可视区中段（距离视口中心 < 阈值）时可自动恢复。
 */
export function shouldResumeFollow(activeLineOffsetTop: number, scrollTop: number, viewportHeight: number, tolerance = 40): boolean {
  const center = scrollTop + viewportHeight / 2;
  return Math.abs(activeLineOffsetTop - center) < tolerance;
}
