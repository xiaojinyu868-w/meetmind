import { chat } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';
import type { TranscriptSegment } from '@/types';
import type {
  ClassroomFlowState,
  ClassroomMoment,
  ClassroomSignal,
  ClassroomSignalKind,
} from '@/types/classroom-flow';

const log = createLogger('classroom-flow');

const MAX_TRANSCRIPT_CHARS = 8_000;
const MAX_RECENT_MOMENTS = 4;
const MAX_KEEP_SIGNALS = 4;
const SIGNAL_KINDS = new Set<ClassroomSignalKind>([
  'definition',
  'formula',
  'example',
  'question',
  'contrast',
  'conclusion',
  'other',
]);

export interface GenerateClassroomFlowInput {
  segments: TranscriptSegment[];
  elapsedMs: number;
  lessonTitle?: string;
  priorFlow?: ClassroomFlowState;
  importedHints?: string[];
}

export function createEmptyClassroomFlow(
  elapsedMs: number,
  lessonTitle = '',
): ClassroomFlowState {
  return {
    title: lessonTitle,
    now: null,
    recent: [],
    keep: [],
    updatedAtMs: Math.max(0, elapsedMs),
  };
}

export async function generateClassroomFlow(
  input: GenerateClassroomFlowInput,
): Promise<ClassroomFlowState> {
  const validSegments = input.segments.filter(
    (segment) => typeof segment.text === 'string' && segment.text.trim().length > 0,
  );
  if (validSegments.length === 0) {
    return input.priorFlow ?? createEmptyClassroomFlow(input.elapsedMs, input.lessonTitle);
  }

  const transcript = formatTranscript(validSegments).slice(-MAX_TRANSCRIPT_CHARS);
  const priorBlock = input.priorFlow?.now
    ? `\n你上一次对课堂的理解如下。它只是可修正的工作记忆，不是必须保留的答案：\n${JSON.stringify(input.priorFlow)}`
    : '';
  const materialBlock = input.importedHints?.length
    ? `\n学生在这节课附近放入过这些材料，可用于识别专名，但不要据此补写课堂没有讲的内容：${input.importedHints.slice(0, 12).join('、')}`
    : '';

  const systemPrompt = `你正在和一个学生一起听课。你的任务不是写课后总结，也不是画思维导图，而是让学生在扫一眼屏幕时知道：老师现在在做什么、刚才如何走到这里、什么值得课后回来。

请直接理解课堂，而不是套固定教学模板。老师可能在定义概念、推导公式、讲案例、讨论、答疑、复习，也可能暂时跑题。你可以修正上一轮的判断；没有足够证据时宁可留空，不要把闲聊包装成知识点。

输出给前端的 JSON：
{
  "title": "这段课堂最自然的短标题",
  "now": {
    "id": "稳定且简短的 id",
    "title": "老师此刻讲到的内容",
    "summary": "一句帮助学生跟上的说明",
    "teachingMove": "可选：老师此刻在定义、推导、举例、比较、讨论或总结什么",
    "anchorMs": 课堂中大致开始位置
  },
  "recent": [
    {"id":"...","title":"刚才完成的一步","summary":"可选的一句关系说明","teachingMove":"可选","anchorMs":0}
  ],
  "keep": [
    {"id":"...","kind":"definition|formula|example|question|contrast|conclusion|other","text":"值得课后回来的一点","reason":"可选：为什么值得留下","anchorMs":0}
  ],
  "updatedAtMs": ${Math.max(0, input.elapsedMs)}
}

字段是渲染契约，不是内容配额：没有价值的数组可以为空，不要为了填满界面制造内容。recent 只保留能解释当前进展的近期步骤；keep 只留下真正重要或尚未解决的内容。文字要自然、具体，避免“这一部分很重要”之类空话。仅输出 JSON。`;

  const userPrompt = `${input.lessonTitle ? `课程标题：${input.lessonTitle}\n` : ''}课堂已进行 ${Math.floor(input.elapsedMs / 1000)} 秒。${materialBlock}${priorBlock}

带时间位置的实时转录：
${transcript}`;

  try {
    const response = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      undefined,
      { temperature: 0.45, maxTokens: 1_400, responseFormat: 'json_object' },
    );
    return sanitizeClassroomFlow(JSON.parse(response.content), input.elapsedMs, input.lessonTitle);
  } catch (error) {
    log.warn('[classroom-flow] generation failed; keeping the last useful state', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return input.priorFlow ?? createEmptyClassroomFlow(input.elapsedMs, input.lessonTitle);
  }
}

export function sanitizeClassroomFlow(
  raw: unknown,
  elapsedMs: number,
  lessonTitle = '',
): ClassroomFlowState {
  if (!raw || typeof raw !== 'object') {
    return createEmptyClassroomFlow(elapsedMs, lessonTitle);
  }

  const value = raw as Record<string, unknown>;
  const now = sanitizeMoment(value.now, elapsedMs, 'now');
  const recent = Array.isArray(value.recent)
    ? value.recent
        .map((item, index) => sanitizeMoment(item, elapsedMs, `recent-${index}`))
        .filter((item): item is ClassroomMoment => item !== null)
        .sort((a, b) => a.anchorMs - b.anchorMs)
        .slice(-MAX_RECENT_MOMENTS)
    : [];
  const keep = Array.isArray(value.keep)
    ? value.keep
        .map((item, index) => sanitizeSignal(item, elapsedMs, `keep-${index}`))
        .filter((item): item is ClassroomSignal => item !== null)
        .slice(0, MAX_KEEP_SIGNALS)
    : [];
  const title = cleanText(value.title, 42) || lessonTitle || now?.title || '';

  return {
    title,
    now,
    recent: now ? recent.filter((item) => item.id !== now.id) : recent,
    keep,
    updatedAtMs: clampMs(value.updatedAtMs, elapsedMs, elapsedMs),
  };
}

function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => `[${formatTime(segment.startMs)}] ${segment.text.trim()}`)
    .join('\n');
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function sanitizeMoment(
  raw: unknown,
  elapsedMs: number,
  fallbackId: string,
): ClassroomMoment | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const title = cleanText(value.title, 54);
  if (!title) return null;
  return {
    id: cleanId(value.id, fallbackId),
    title,
    summary: cleanText(value.summary, 120) || undefined,
    teachingMove: cleanText(value.teachingMove, 48) || undefined,
    anchorMs: clampMs(value.anchorMs, elapsedMs, 0),
  };
}

function sanitizeSignal(
  raw: unknown,
  elapsedMs: number,
  fallbackId: string,
): ClassroomSignal | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const text = cleanText(value.text, 96);
  if (!text) return null;
  const kind = typeof value.kind === 'string' && SIGNAL_KINDS.has(value.kind as ClassroomSignalKind)
    ? value.kind as ClassroomSignalKind
    : 'other';
  return {
    id: cleanId(value.id, fallbackId),
    kind,
    text,
    reason: cleanText(value.reason, 96) || undefined,
    anchorMs: clampMs(value.anchorMs, elapsedMs, 0),
  };
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const id = value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return id || fallback;
}

function clampMs(value: unknown, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(0, fallback);
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, max)));
}
