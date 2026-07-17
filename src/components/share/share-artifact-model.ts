import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import type { SharedAgentSnapshot } from '@/lib/services/share-agent-service';
import type { TranscriptSegment } from '@/types';

export type ShareableArtifactAppKey = Extract<
  WorkshopAppKey,
  'cheatsheet' | 'mindmap' | 'quiz' | 'infographic'
>;

const SHAREABLE_ARTIFACT_KEYS = new Set<WorkshopAppKey>([
  'cheatsheet',
  'mindmap',
  'quiz',
  'infographic',
]);

const PLACEHOLDER_COURSE_TITLES = new Set(['课堂录音', '未命名课堂', '新课堂']);

export function isShareableArtifactAppKey(value: WorkshopAppKey): value is ShareableArtifactAppKey {
  return SHAREABLE_ARTIFACT_KEYS.has(value);
}

function buildTranscriptDigest(segments: TranscriptSegment[]) {
  if (segments.length === 0) {
    return { totalSec: 0, segments: [] as Array<{ startSec: number; endSec: number; text: string }> };
  }

  const lastSegment = segments.at(-1);
  const totalSec = Math.ceil((lastSegment?.endMs ?? 0) / 1000);
  const maxSegments = 30;
  const picked = segments.length <= maxSegments
    ? segments
    : Array.from({ length: maxSegments }, (_, index) => (
        segments[Math.floor(index * (segments.length / maxSegments))]
      ));

  return {
    totalSec,
    segments: picked
      .filter((segment) => segment.text.trim().length > 0)
      .map((segment) => ({
        startSec: Math.floor((segment.startMs ?? 0) / 1000),
        endSec: Math.ceil((segment.endMs ?? 0) / 1000),
        text: segment.text.trim().slice(0, 800),
      })),
  };
}

function buildArtifactSummary(result: AppExecutionResult): string {
  if (result.render?.title) return result.render.title;
  if (result.render?.description) return result.render.description.slice(0, 120);
  const firstCard = result.cards.at(0);
  return firstCard?.title ?? firstCard?.body?.slice(0, 80) ?? '';
}

function sanitizeNickname(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || /^\d{6,}$/.test(trimmed)) return undefined;
  if (trimmed.length >= 18 && /^[a-z0-9]+$/i.test(trimmed)) return undefined;
  if (trimmed.includes('@')) return trimmed.split('@')[0] || undefined;
  return trimmed;
}

function resolveTitle(courseTitle: string | undefined, artifactSummary: string): string {
  const normalized = courseTitle?.trim();
  if (normalized && !PLACEHOLDER_COURSE_TITLES.has(normalized)) return normalized;
  return artifactSummary || '一节课';
}

export function buildSharedArtifactSnapshot({
  appKey,
  result,
  transcript,
  courseTitle,
  subject,
  summary,
  nickname,
}: {
  appKey: ShareableArtifactAppKey;
  result: AppExecutionResult;
  transcript: TranscriptSegment[];
  courseTitle?: string;
  subject?: string;
  summary?: string;
  nickname?: string | null;
}): SharedAgentSnapshot {
  const artifactSummary = buildArtifactSummary(result);
  const payload = result.render?.payload;

  return {
    title: resolveTitle(courseTitle, artifactSummary),
    subject,
    artifactKind: appKey,
    sharerNickname: sanitizeNickname(nickname),
    transcriptDigest: buildTranscriptDigest(transcript),
    conversationContext: summary?.trim() || undefined,
    artifact: payload && typeof payload === 'object'
      ? { summary: artifactSummary || undefined, payload }
      : artifactSummary
        ? { summary: artifactSummary }
        : undefined,
  };
}
