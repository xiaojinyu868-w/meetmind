/** Server-only rollout and upstream settings. Never serialize credentials to clients. */
export function getContextConfig() {
  const url = process.env.CONTEXT_HINDSIGHT_URL?.trim().replace(/\/+$/, '') || '';
  if (url && !/^https?:\/\//i.test(url)) throw new Error('invalid_context_backend_url');
  return {
    enabled: process.env.CONTEXT_ENABLED === 'true',
    backendUrl: url,
    backendKey: process.env.CONTEXT_HINDSIGHT_API_KEY?.trim() || '',
    timeoutMs: 8_000,
    readTimeoutMs: 3_000,
    dispatchIntervalMs: 5_000,
    maxContentChars: 40_000,
    maxRequestBytes: 192_000,
    maxContextTokens: 8_000,
    defaultContextTokens: 1_800,
  };
}
