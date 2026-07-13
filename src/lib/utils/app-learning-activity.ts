import type { AppExecutionResult } from '@/lib/ai-native/types';

export function buildAppResultActivityDetail(
  result: AppExecutionResult | null,
  fallback: (cardCount: number) => string,
): string {
  if (!result) return '';
  const renderDescription = result.render?.description?.trim();
  if (renderDescription) return renderDescription.slice(0, 220);
  const firstCard = result.cards[0];
  if (firstCard) return `${firstCard.title}：${firstCard.body}`.slice(0, 220);
  return fallback(result.cards.length);
}
