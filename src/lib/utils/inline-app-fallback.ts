import type { TranscriptSegment } from '@/types';

export type InlineFallbackAppKey = 'quiz' | 'flashcards' | 'cheatsheet' | 'mindmap' | 'study-report';

type ThinSegment = Pick<TranscriptSegment, 'id' | 'text' | 'startMs' | 'endMs'>;

function cleanText(value: string | undefined): string {
  return (value || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickSegments(segments: ThinSegment[], limit = 6): ThinSegment[] {
  return segments
    .filter((segment) => cleanText(segment.text).length >= 8)
    .slice(-limit);
}

function topicFrom(text: string, fallback: string): string {
  const cleaned = cleanText(text)
    .replace(/^(老师|同学|这里|这个|那个)(说|讲到|提到)?/, '')
    .trim();
  return cleaned.slice(0, 28) || fallback;
}

function buildFlashcards(segments: ThinSegment[]) {
  const picked = pickSegments(segments, 5);
  if (picked.length === 0) return null;
  return {
    cards: picked.map((segment, index) => {
      const text = cleanText(segment.text);
      const topic = topicFrom(text, `重点 ${index + 1}`);
      return {
        id: `fallback-flashcard-${index + 1}`,
        title: `闪卡 ${index + 1}`,
        front: `这段课里“${topic}”最关键的意思是什么？`,
        back: text.slice(0, 160),
        hint: '先用自己的话复述，再对照老师原话。',
      };
    }),
  };
}

function buildCheatsheet(segments: ThinSegment[]) {
  const picked = pickSegments(segments, 6);
  if (picked.length === 0) return null;
  const half = Math.max(1, Math.ceil(picked.length / 2));
  return {
    title: '课堂速查卡',
    overview: '先扫核心概念，再看易错提醒。',
    sections: [
      {
        key: 'definition',
        label: '核心概念',
        items: picked.slice(0, half).map((segment, index) => ({
          term: topicFrom(segment.text, `概念 ${index + 1}`).slice(0, 12),
          body: cleanText(segment.text).slice(0, 90),
        })),
      },
      {
        key: 'pitfall',
        label: '容易漏掉',
        items: picked.slice(half).map((segment, index) => ({
          term: `提醒 ${index + 1}`,
          body: cleanText(segment.text).slice(0, 90),
        })),
      },
    ].filter((section) => section.items.length > 0),
  };
}

function buildMindmap(segments: ThinSegment[]) {
  const picked = pickSegments(segments, 5);
  if (picked.length === 0) return null;
  return {
    root: '课堂知识结构',
    children: picked.map((segment, index) => ({
      title: topicFrom(segment.text, `分支 ${index + 1}`).slice(0, 18),
      children: [{ title: cleanText(segment.text).slice(0, 36) }],
    })),
  };
}

export function buildInlineAppFallbackPayload(
  appKey: InlineFallbackAppKey,
  segments: ThinSegment[],
): unknown | null {
  if (!Array.isArray(segments) || pickSegments(segments, 1).length === 0) return null;
  if (appKey === 'flashcards' || appKey === 'quiz') return buildFlashcards(segments);
  if (appKey === 'cheatsheet' || appKey === 'study-report') return buildCheatsheet(segments);
  if (appKey === 'mindmap') return buildMindmap(segments);
  return null;
}
