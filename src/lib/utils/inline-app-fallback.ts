import type { TranscriptSegment } from '@/types';
import type { AppExecutionResult, AppRenderMode } from '@/lib/ai-native/types';

export type InlineFallbackAppKey = 'quiz' | 'flashcards' | 'cheatsheet' | 'mindmap';

type ThinSegment = Pick<TranscriptSegment, 'id' | 'text' | 'startMs' | 'endMs'>;

const FLASHCARDS_FALLBACK_MESSAGE = '这节课暂时没能整理出可靠闪卡，稍后可以再生成一次。';

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
    .replace(/^(老师|同学|这里|这个|那个)(说到|讲到|提到)?/, '')
    .trim();
  return cleaned.slice(0, 28) || fallback;
}

function buildFlashcards(segments: ThinSegment[]) {
  const picked = pickSegments(segments, 1);
  if (picked.length === 0) return null;
  return { message: FLASHCARDS_FALLBACK_MESSAGE };
}

function buildQuiz(segments: ThinSegment[]) {
  const picked = pickSegments(segments, 5);
  if (picked.length === 0) return null;
  return {
    questions: picked.map((segment, index) => {
      const text = cleanText(segment.text);
      const topic = topicFrom(text, `重点 ${index + 1}`);
      const correct = text.slice(0, 96);
      return {
        id: `fallback-quiz-${index + 1}`,
        title: `题目 ${index + 1}`,
        stem: `关于“${topic}”，下面哪句最贴近刚才课堂内容？`,
        options: [
          `A. ${correct}`,
          'B. 这部分内容和本节课主题无关',
          'C. 只需要背结论，不需要理解条件',
          'D. 课堂里没有提到这个点',
        ],
        answer: 'A',
        explanation: correct,
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
    overview: '先扫核心概念，再看容易漏掉的提醒。',
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
  if (appKey === 'flashcards') return buildFlashcards(segments);
  if (appKey === 'quiz') return buildQuiz(segments);
  if (appKey === 'cheatsheet') return buildCheatsheet(segments);
  if (appKey === 'mindmap') return buildMindmap(segments);
  return null;
}

const FALLBACK_RESULT_META: Record<InlineFallbackAppKey, { pluginId: string; mode: AppRenderMode; title: string; description: string }> = {
  quiz: { pluginId: 'quiz-arena', mode: 'quiz', title: '课堂测验', description: '先作答，再核对答案和证据。' },
  flashcards: { pluginId: 'flashcards-lab', mode: 'flashcards', title: '课堂闪卡', description: FLASHCARDS_FALLBACK_MESSAGE },
  cheatsheet: { pluginId: 'cheatsheet-gen', mode: 'document', title: '课堂速查卡', description: '核心概念和易错点速览。' },
  mindmap: { pluginId: 'mindmap-outline', mode: 'mindmap', title: '课堂知识结构', description: '把课堂内容整理成结构图。' },
};

export function buildInlineAppFallbackResult(
  appKey: InlineFallbackAppKey,
  segments: ThinSegment[],
): AppExecutionResult | null {
  const payload = buildInlineAppFallbackPayload(appKey, segments);
  if (!payload) return null;
  const meta = FALLBACK_RESULT_META[appKey];
  return {
    pluginId: meta.pluginId,
    version: 'inline-fallback-v2',
    cards: [],
    tasks: [],
    trace: ['inline_fallback=client'],
    render: {
      mode: meta.mode,
      title: meta.title,
      description: meta.description,
      payload,
    },
    raw: {
      generatedAt: new Date().toISOString(),
    },
  };
}
