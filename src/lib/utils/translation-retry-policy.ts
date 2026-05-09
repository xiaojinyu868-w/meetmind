export function getTranslationRetryDelayMs(status: number | null): number {
  if (status === 429) return 60_000;
  if (status === null) return 8_000;
  if (status >= 500) return 12_000;
  return 30_000;
}

export function shouldSkipTranslationTerm(
  term: string,
  failedUntilByTerm: Record<string, number>,
  now: number = Date.now(),
): boolean {
  const failedUntil = failedUntilByTerm[term];
  return typeof failedUntil === 'number' && failedUntil > now;
}
