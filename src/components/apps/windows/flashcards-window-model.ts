import type { AppExecutionResult } from '@/lib/ai-native/types';

export interface FlashcardItem {
  id: string;
  title?: string;
  front: string;
  back: string;
  hint?: string;
  evidence?: {
    startMs: number;
    snippet?: string;
  };
}

export function normalizeFlashcards(result: AppExecutionResult | null): FlashcardItem[] {
  if (!result) return [];
  const payload = result.render?.payload as { cards?: Array<Record<string, unknown>> } | undefined;
  const cardsFromPayload = Array.isArray(payload?.cards)
    ? payload.cards
        .map((item, index) => {
          const id = typeof item.id === 'string' ? item.id : `payload-card-${index + 1}`;
          const sourceCard = result.cards.find((card) => card.id === id);
          const citation = sourceCard?.citations?.[0];
          return {
            id,
            title: typeof item.title === 'string' ? item.title : undefined,
            front: typeof item.front === 'string' ? item.front : '',
            back: typeof item.back === 'string' ? item.back : '',
            hint: typeof item.hint === 'string' ? item.hint : undefined,
            evidence: citation ? { startMs: citation.startMs, snippet: citation.snippet } : undefined,
          };
        })
        .filter((item) => item.front && item.back)
    : [];

  if (cardsFromPayload.length > 0) return cardsFromPayload;

  return result.cards
    .filter((card) => card.meta?.cardKind === 'flashcard')
    .map((card) => ({
      id: card.id,
      title: card.title || undefined,
      front: typeof card.meta?.front === 'string' ? card.meta.front : card.body,
      back: typeof card.meta?.back === 'string' ? card.meta.back : '',
      hint: typeof card.meta?.hint === 'string' ? card.meta.hint : undefined,
      evidence: card.citations?.[0]
        ? { startMs: card.citations[0].startMs, snippet: card.citations[0].snippet }
        : undefined,
    }))
    .filter((item) => item.front && item.back);
}

export function getFlashcardsFallbackMessage(result: AppExecutionResult | null): string | null {
  const payload = result?.render?.payload as { message?: unknown } | undefined;
  return typeof payload?.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : null;
}

export function formatFlashcardEvidenceTime(startMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(startMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
