export interface TranslateRateLimitedPayload {
  translations: Record<string, string>;
  rateLimited: true;
}

export function buildTranslateRateLimitedPayload(): TranslateRateLimitedPayload {
  return { translations: {}, rateLimited: true };
}
