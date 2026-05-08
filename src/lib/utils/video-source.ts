import type { ImportedVideoSource } from '@/types';

function extractBvid(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get('bvid');
    if (fromQuery && /^BV[0-9A-Za-z]+$/.test(fromQuery)) return fromQuery;
  } catch {
    /* fall through */
  }
  return value.match(/BV[0-9A-Za-z]+/)?.[0];
}

function extractCid(value: string | undefined): number | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const raw = url.searchParams.get('cid');
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function resolveBilibiliVideoIdentifiers(source: Pick<ImportedVideoSource,
  'bvid' | 'cid' | 'embedUrl' | 'resolvedUrl' | 'originalUrl' | 'playableUrl'
>): { bvid?: string; cid?: number } {
  const candidates = [source.embedUrl, source.resolvedUrl, source.originalUrl, source.playableUrl];
  return {
    bvid: source.bvid || candidates.map(extractBvid).find(Boolean),
    cid: source.cid || candidates.map(extractCid).find(Boolean),
  };
}
