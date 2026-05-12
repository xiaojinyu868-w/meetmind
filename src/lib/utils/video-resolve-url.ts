export type LegacyVideoResolveResult =
  | { ok: true; resolvedUrl: string; playableUrl: string }
  | { ok: false; error: string };

export function resolveLegacyVideoUrl(rawUrl: string | null | undefined): LegacyVideoResolveResult {
  const value = rawUrl?.trim();
  if (!value) return { ok: false, error: 'missing url' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: 'invalid url' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'unsupported url protocol' };
  }

  return {
    ok: true,
    resolvedUrl: parsed.toString(),
    playableUrl: parsed.toString(),
  };
}
