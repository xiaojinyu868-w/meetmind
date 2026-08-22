import { detectLinkProvider } from '@/lib/context-reach/link-provider';
import type {
  SourceContentState,
  SourceIngressChannel,
  SourceProvenance,
} from '@/types/page-types';

const TRACKING_QUERY_KEYS = new Set([
  'from',
  'from_source',
  'share_source',
  'share_token',
  'spm',
  'timestamp',
  'scene',
  'subscene',
  'ascene',
  'clicktime',
  'enterid',
  'sessionid',
  'chksm',
]);

export function canonicalizeSourceUrl(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return undefined;
  }
}

function clampCompleteness(value?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

export function inferContentState(params: {
  explicit?: SourceContentState;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  isExtracting?: boolean;
  failed?: boolean;
}): SourceContentState {
  if (params.explicit) return params.explicit;
  if (params.failed) return 'failed';
  if (params.isExtracting) return 'extracting';
  const textLength = params.normalizedText?.trim().length ?? 0;
  if (textLength >= 200) return 'complete';
  if (textLength > 0) return 'partial';
  if (params.sourceUrl) return 'link-only';
  return 'received';
}

export function buildSourceProvenance(params: {
  ingressChannel: SourceIngressChannel;
  sourceUrl?: string | null;
  normalizedText?: string | null;
  platformId?: string;
  platformLabel?: string;
  publisher?: string;
  author?: string;
  publishedAt?: string;
  extractionMethod?: string;
  contentState?: SourceContentState;
  completeness?: number;
  isExtracting?: boolean;
  failed?: boolean;
}): SourceProvenance {
  const canonicalUrl = canonicalizeSourceUrl(params.sourceUrl);
  const detected = canonicalUrl ? detectLinkProvider(canonicalUrl) : null;
  const completeness = clampCompleteness(params.completeness);
  return {
    ingressChannel: params.ingressChannel,
    platformId: params.platformId || detected?.id || undefined,
    platformLabel: params.platformLabel || (detected?.id !== 'web' ? detected?.label : undefined),
    publisher: params.publisher,
    author: params.author,
    originalUrl: params.sourceUrl?.trim() || undefined,
    canonicalUrl,
    publishedAt: params.publishedAt,
    extractionMethod: params.extractionMethod,
    // 显式传入的 contentState 必须优先生效（params 上的键名是 contentState，不是 explicit）
    contentState: inferContentState({ ...params, explicit: params.contentState }),
    completeness,
  };
}

export function readSourceProvenance(metadata?: Record<string, unknown> | null): SourceProvenance | undefined {
  const raw = metadata?.provenance;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const ingressChannel = value.ingressChannel;
  const contentState = value.contentState;
  if (typeof ingressChannel !== 'string' || typeof contentState !== 'string') return undefined;
  return {
    ingressChannel: ingressChannel as SourceIngressChannel,
    contentState: contentState as SourceContentState,
    platformId: typeof value.platformId === 'string' ? value.platformId : undefined,
    platformLabel: typeof value.platformLabel === 'string' ? value.platformLabel : undefined,
    publisher: typeof value.publisher === 'string' ? value.publisher : undefined,
    author: typeof value.author === 'string' ? value.author : undefined,
    originalUrl: typeof value.originalUrl === 'string' ? value.originalUrl : undefined,
    canonicalUrl: typeof value.canonicalUrl === 'string' ? value.canonicalUrl : undefined,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
    extractionMethod: typeof value.extractionMethod === 'string' ? value.extractionMethod : undefined,
    completeness: typeof value.completeness === 'number' ? clampCompleteness(value.completeness) : undefined,
  };
}

export function getProvenanceSourceLabel(provenance?: SourceProvenance): string | undefined {
  if (!provenance) return undefined;
  const creator = provenance.publisher || provenance.author;
  if (provenance.platformLabel && creator && provenance.platformLabel !== creator) {
    return `${provenance.platformLabel} · ${creator}`;
  }
  return creator || provenance.platformLabel;
}
