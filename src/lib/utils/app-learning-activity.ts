import type { AppExecutionResult } from '@/lib/ai-native/types';
import { COPY } from '@/lib/ui/copy';

function buildPodcastActivityDetail(result: AppExecutionResult): string | null {
  if (result.render?.mode !== 'audio' && result.raw?.appKey !== 'audio-overview') return null;
  const payload = (result.render?.payload || {}) as {
    audioUrl?: string;
    lines?: unknown[];
    sections?: unknown[];
  };
  if (payload.audioUrl?.trim()) return COPY.apps.podcast.activityAudioReady;
  if ((payload.lines?.length || 0) > 0 || (payload.sections?.length || 0) > 0) {
    return COPY.apps.podcast.activityScriptReady;
  }
  return '';
}

export function buildAppResultActivityDetail(
  result: AppExecutionResult | null,
  fallback: (cardCount: number) => string,
): string {
  if (!result) return '';
  const podcastDetail = buildPodcastActivityDetail(result);
  if (podcastDetail !== null) return podcastDetail;
  const renderDescription = result.render?.description?.trim();
  if (renderDescription) return renderDescription.slice(0, 220);
  const firstCard = result.cards[0];
  if (firstCard) return `${firstCard.title}：${firstCard.body}`.slice(0, 220);
  return fallback(result.cards.length);
}
