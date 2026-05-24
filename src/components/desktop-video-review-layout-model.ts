export function toReviewCurrentTimeSec(currentTimeMs: number): number {
  if (!Number.isFinite(currentTimeMs) || currentTimeMs <= 0) return 0;
  return Math.floor(currentTimeMs / 1000);
}
