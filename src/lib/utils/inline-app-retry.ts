export const INLINE_APP_MAX_ATTEMPTS = 3;
export const INLINE_APP_RETRY_DELAYS_MS = [800, 1600] as const;

export function shouldRetryInlineAppExecute({
  status,
  attempt,
  maxAttempts = INLINE_APP_MAX_ATTEMPTS,
}: {
  /** null 表示 fetch 本身失败，没有拿到 HTTP 状态码 */
  status: number | null;
  /** 当前是第几次尝试，从 1 开始 */
  attempt: number;
  maxAttempts?: number;
}): boolean {
  if (attempt >= maxAttempts) return false;
  if (status === null) return true;
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function getInlineAppRetryDelayMs(attempt: number): number {
  return INLINE_APP_RETRY_DELAYS_MS[Math.max(0, attempt - 1)] ?? INLINE_APP_RETRY_DELAYS_MS[INLINE_APP_RETRY_DELAYS_MS.length - 1];
}
