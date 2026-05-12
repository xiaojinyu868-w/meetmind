export type InlineAppKey = 'quiz' | 'flashcards' | 'cheatsheet' | 'mindmap' | 'study-report';

const INLINE_APP_KEYS = new Set<InlineAppKey>([
  'quiz',
  'flashcards',
  'cheatsheet',
  'mindmap',
  'study-report',
]);

const OPEN_APP_MARKER = /<open_app:\s*([a-z0-9_-]+)\s*\/?\s*>/gi;

export function isInlineAppKey(value: string | null | undefined): value is InlineAppKey {
  return Boolean(value && INLINE_APP_KEYS.has(value as InlineAppKey));
}

export function extractOpenAppMarker(content: string): { key: InlineAppKey | null; cleaned: string } {
  let firstKey: InlineAppKey | null = null;
  const cleaned = content.replace(OPEN_APP_MARKER, (_match, rawKey) => {
    const key = typeof rawKey === 'string' ? rawKey.toLowerCase().trim() : '';
    if (!firstKey && isInlineAppKey(key)) firstKey = key;
    return '';
  });

  return {
    key: firstKey,
    cleaned: cleaned
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}
