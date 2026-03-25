import type { Citation } from '@/types/dify';
import type {
  Segment,
  TutorCacheEnvelopeV1,
  TutorAPIResponse,
  TutorChatMessage,
  TutorMessageImage,
} from './tutor-types';

export function toTranscriptSignature(segments: Segment[]): string {
  if (!Array.isArray(segments) || segments.length === 0) return 'empty';
  const first = segments[0];
  const last = segments[segments.length - 1];
  const textLength = segments.reduce((sum, seg) => sum + (seg.text?.length || 0), 0);
  return `${segments.length}:${first.startMs}:${last.endMs}:${textLength}`;
}

export function normalizeSupportContextText(raw: string, maxChars = 3500): string {
  const normalized = (raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

export function buildTutorRequestSegments(params: {
  baseSegments: Segment[];
  supportContextText: string;
  focusTimestamp: number;
  prepend?: boolean;
}): Segment[] {
  const normalizedSupport = normalizeSupportContextText(params.supportContextText);
  if (!normalizedSupport) return params.baseSegments;

  const focusTimestamp = Number.isFinite(params.focusTimestamp)
    ? Math.max(0, Math.floor(params.focusTimestamp))
    : 0;

  const supportSegment: Segment = {
    id: '__support_context__',
    text: `【增强资料】\n${normalizedSupport}\n\n【使用规则】\n- 回答引用资料时必须标注 [资料N]\n- 若资料无证据，请明确说明"资料中未找到相关证据"`,
    startMs: focusTimestamp,
    endMs: focusTimestamp + 1,
  };

  return params.prepend
    ? [supportSegment, ...params.baseSegments]
    : [...params.baseSegments, supportSegment];
}

export function unpackTutorCachePayload(raw: string): {
  envelope: TutorCacheEnvelopeV1 | null;
  response: TutorAPIResponse | null;
} {
  try {
    const parsed = JSON.parse(raw) as TutorCacheEnvelopeV1 | TutorAPIResponse;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      parsed.version === 1 &&
      'response' in parsed
    ) {
      return {
        envelope: parsed as TutorCacheEnvelopeV1,
        response: (parsed as TutorCacheEnvelopeV1).response,
      };
    }
    return {
      envelope: null,
      response: parsed as TutorAPIResponse,
    };
  } catch {
    return {
      envelope: null,
      response: null,
    };
  }
}

export function normalizeCitations(raw: unknown): Citation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed = raw.filter(Boolean) as Citation[];
  return parsed.length > 0 ? parsed : undefined;
}

export function normalizeChatHistory(raw: unknown): TutorChatMessage[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item): TutorChatMessage => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: typeof item.content === 'string' ? item.content : '',
      citations: normalizeCitations(item.citations),
      images: Array.isArray(item.images)
        ? item.images.filter(Boolean).map((image, index) => ({
            id: typeof image?.id === 'string' ? image.id : `restored-image-${index}`,
            name: typeof image?.name === 'string' ? image.name : '图片',
            previewUrl: typeof image?.previewUrl === 'string' ? image.previewUrl : '',
          })).filter((image: { previewUrl: string }) => image.previewUrl)
        : undefined,
    }))
    .filter((item) => item.content.length > 0 || (item.images?.length ?? 0) > 0);
}

export function toTutorMessageImages(images: Array<{ id: string; name: string; previewUrl: string }>): TutorMessageImage[] {
  return images.filter((image) => image.previewUrl).map((image) => ({
    id: image.id,
    name: image.name,
    previewUrl: image.previewUrl,
  }));
}

export function formatTutorErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error || '未知错误');
  if (/请求过于频繁|稍后再试|rate limit|too many/i.test(rawMessage)) {
    const retryAfterMatch = rawMessage.match(/(\d+)\s*秒/);
    const retryHint = retryAfterMatch ? `，大约 ${retryAfterMatch[1]} 秒后再试` : '，稍等十几秒再试一次';
    return `现在问得有点快了${retryHint}。`;
  }
  return rawMessage;
}
