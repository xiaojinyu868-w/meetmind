/**
 * 收藏夹课堂页的纯模型（浏览器与服务端都能跑，零 IO）。
 *
 * 讲完就考：应用矩阵的输入契约是「一节课的转录」（`input.transcript`），收藏夹没有时间轴——
 * 这里把材料包变成一份**伪转录**：每一段正文一个 segment，时间轴按朗读估时（讲课语速 ≈ 270 字/分，220ms/字）顺序铺开，
 * 于是测验 / 闪卡照常出题、照常回锚，只是「回到原话」映射成「回到知乎原文」而不是跳时间点。
 * 这是 2026-09-12 的过渡做法；真正的来源无关输入（`LearningSource[]`）留给 ai-native 主干的下一步。
 */

import type { TranscriptSegment } from '@/types';
import type { LearningAssessmentDraft } from '@/types/learning-event';
import type { LiveMaterialPack } from '@/lib/services/teach-live/live-materials';

export const ZHIHU_LESSON_APP_KEYS = ['quiz', 'flashcards'] as const;
export type ZhihuLessonAppKey = (typeof ZHIHU_LESSON_APP_KEYS)[number];

const MS_PER_CHAR = 220;
const MIN_SEGMENT_MS = 1_500;
const GAP_MS = 400;

export interface MaterialSourceSpan {
  ref: string;
  title: string;
  url: string;
  author: string | null;
  startMs: number;
  endMs: number;
}

export interface MaterialsTranscript {
  transcript: TranscriptSegment[];
  spans: MaterialSourceSpan[];
  durationMs: number;
}

function paragraphsOf(excerpt: string): string[] {
  return excerpt
    .replace(/\r\n?/g, '\n')
    .replace(/\n?……（节选，全文见原链接）\s*$/, '') // 节选标记是给老师看的，不进题面
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+\n/g, '\n').trim())
    .filter((p) => p.length > 0);
}

export function materialsToTranscript(pack: LiveMaterialPack): MaterialsTranscript {
  const transcript: TranscriptSegment[] = [];
  const spans: MaterialSourceSpan[] = [];
  let cursor = 0;
  for (const item of pack.items) {
    const spanStart = cursor;
    // 首段带上标题与作者，让出题时能把题面落到「材料 N《标题》」这个来源上
    const head = `[${item.ref}]《${item.title}》${item.author ? `（${item.author}）` : ''}`;
    const paragraphs = [head, ...paragraphsOf(item.excerpt)];
    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i];
      const durationMs = Math.max(MIN_SEGMENT_MS, text.length * MS_PER_CHAR);
      transcript.push({
        id: `${item.ref}-${i}`,
        text,
        startMs: cursor,
        endMs: cursor + durationMs,
        confidence: 1,
        isFinal: true,
        sourceItemId: item.sourceId,
      });
      cursor += durationMs + GAP_MS;
    }
    spans.push({ ref: item.ref, title: item.title, url: item.url, author: item.author, startMs: spanStart, endMs: cursor });
  }
  return { transcript, spans, durationMs: cursor };
}

export function sourceForTime(spans: MaterialSourceSpan[], startMs: number): MaterialSourceSpan | null {
  return spans.find((span) => startMs >= span.startMs && startMs < span.endMs) ?? null;
}

const GOAL_INTENT: Record<ZhihuLessonAppKey, string> = {
  quiz: '用这位学生自己收藏的知乎材料出一套测验，检验 TA 是否真的理解材料讲的东西；题面落到具体材料，解析引用材料说法。',
  flashcards: '把这位学生收藏的知乎材料里最该记住、最容易混的点做成闪卡，正面是提示不是标题。',
};

/** /api/apps/execute 的请求体；learner 由调用方按本机切片补（buildLocalLearnerContext 是浏览器端） */
export function buildExecutePayload(params: { appKey: ZhihuLessonAppKey; threadId: string; pack: LiveMaterialPack; transcript: TranscriptSegment[]; learner?: unknown }) {
  const { appKey, threadId, pack, transcript, learner } = params;
  return {
    appKey,
    goal: { intent: GOAL_INTENT[appKey], expectedOutput: 'mixed' as const, appKey },
    input: {
      sessionId: `zhihu-lesson:${threadId}`,
      dataSource: 'unknown' as const,
      transcript,
      anchors: [],
      metadata: {
        title: pack.title,
        contextType: 'zhihu-favlist',
        materialsCount: pack.items.length,
      },
    },
    memory: {
      summary: `学生自己在知乎收藏的 ${pack.items.length} 篇材料（收藏夹「${pack.title}」）：${pack.items.map((i) => `[${i.ref}]${i.title}`).join('；')}`,
      keyDifficulties: [],
    },
    ...(learner ? { learner } : {}),
  };
}

/** m:ss 或 m:ss-m:ss；后面紧跟中文时把那个空格一起吃掉（「0:07 明确指出」→「材料 1《…》明确指出」） */
const TIME_REF_RE = /(?<![\d:])(\d{1,2}):([0-5]\d)(?:\s*[-–~至到]\s*(\d{1,2}):([0-5]\d))?(?![\d:])(?: (?=[\u4e00-\u9fff（「]))?/g;

/**
 * 应用矩阵的 prompt 是课堂口吻（"引用原话写时间点"），喂伪转录后解析里会出现「0:07-0:21 明确指出…」这种假时间。
 * 在渲染前把它换成真来源：「材料 1《过拟合到底是什么？》明确指出…」。只改字符串，不碰 citations / actions 里的数字
 * （那些仍用于点开对应知乎原文）。这是对"来源没有时间轴"的渲染层修正；prompt 层的来源无关化留给 ai-native 主干。
 */
export function relabelTimeReferences<T>(value: T, spans: MaterialSourceSpan[]): T {
  const label = (m: number, s: number): string | null => {
    const span = sourceForTime(spans, (m * 60 + s) * 1000);
    if (!span) return null;
    const title = span.title.length > 18 ? `${span.title.slice(0, 17)}…` : span.title;
    return `材料 ${span.ref.replace(/^A/, '')}《${title}》`;
  };
  const fix = (text: string): string =>
    text.replace(TIME_REF_RE, (whole, m1: string, s1: string) => label(Number(m1), Number(s1)) ?? whole);
  const walk = (node: unknown, key?: string): unknown => {
    if (typeof node === 'string') return key === 'snippet' || key === 'id' || key === 'url' ? node : fix(node);
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = k === 'payload' || k === 'citations' ? v : walk(v, k);
      return out;
    }
    return node;
  };
  return walk(value) as T;
}

const WEAK_OUTCOMES = new Set(['wrong', 'missed', 'blind-spot', 'aware-gap', 'productive-struggle', 'uncovered']);

/** 考后「哪没稳」：按结果挑概念，去重、保持首次出现顺序、最多 max 个 */
export function weakConceptsFromAssessment(draft: LearningAssessmentDraft | null | undefined, max = 3): string[] {
  if (!draft) return [];
  const out: string[] = [];
  for (const item of draft.items) {
    if (!WEAK_OUTCOMES.has(item.outcome)) continue;
    const concept = item.concept.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (concept.length < 2 || out.includes(concept)) continue;
    out.push(concept);
    if (out.length >= max) break;
  }
  return out;
}
