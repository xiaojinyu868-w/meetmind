export interface FlashcardsTrialShareCard {
  front: string;
  back?: string;
}

export interface FlashcardsTrialShareStats {
  gotCount?: number;
  total?: number;
}

function compactShareText(value: string | undefined | null): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function truncateShareLine(value: string, maxLength: number): string {
  const compacted = compactShareText(value);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 1))}…`;
}

function resolveDateKey(date: Date): string {
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function buildFlashcardsTrialShareText(
  cards: ReadonlyArray<FlashcardsTrialShareCard>,
  stats: FlashcardsTrialShareStats = {},
): string {
  const total = Math.max(0, stats.total ?? cards.length);
  const visibleQuestions = cards
    .map((card) => truncateShareLine(card.front, 56))
    .filter(Boolean)
    .slice(0, 3)
    .map((front, index) => `${index + 1}. ${front}`);
  const accuracy =
    typeof stats.gotCount === 'number' && total > 0
      ? `正确率：${Math.round((Math.max(0, stats.gotCount) / total) * 100)}%`
      : '';

  return [
    `我刚试听了一节课，MeetMind 自动整理了 ${total} 张闪卡：`,
    '',
    ...visibleQuestions,
    accuracy ? `\n${accuracy}` : '',
    '',
    '— MeetMind',
  ].filter((part) => part !== '').join('\n');
}

export function buildFlashcardsTrialShareFileName(date = new Date()): string {
  return `MeetMind-试听课闪卡-${resolveDateKey(date)}.png`;
}
