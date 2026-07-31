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
// 课堂脉络同时是课后复习材料，不能为了课中首屏简短而把较早节点从数据里删掉。
// 这里保留一节长课的完整路径；发给模型的工作记忆另行收窄，避免输入随录课时长膨胀。
const MAX_FLOW_MOMENTS = 240;
const MAX_KEEP_SIGNALS = 80;
const MAX_PROMPT_RECENT_MOMENTS = 8;
const MAX_PROMPT_KEEP_SIGNALS = 12;
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
  /** Only transcript segments not consumed by the previous successful update. */
  newSegments: TranscriptSegment[];
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
  const validSegments = input.newSegments.filter(
    (segment) => typeof segment.text === 'string' && segment.text.trim().length > 0,
  );
  if (validSegments.length === 0) {
    return input.priorFlow ?? createEmptyClassroomFlow(input.elapsedMs, input.lessonTitle);
  }

  const transcript = formatTranscript(validSegments).slice(-MAX_TRANSCRIPT_CHARS);
  const priorFlow = input.priorFlow ?? createEmptyClassroomFlow(input.elapsedMs, input.lessonTitle);
  const promptPriorFlow: ClassroomFlowState = {
    ...priorFlow,
    recent: priorFlow.recent.slice(-MAX_PROMPT_RECENT_MOMENTS),
    keep: priorFlow.keep.slice(-MAX_PROMPT_KEEP_SIGNALS),
  };
  const priorBlock = `\n这是已经发布的课堂脉络的近期工作记忆。只提交本轮增量，不要重写未变化内容：\n${JSON.stringify(promptPriorFlow)}`;
  const materialBlock = input.importedHints?.length
    ? `\n学生在这节课附近放入过这些材料，可用于识别专名，但不要据此补写课堂没有讲的内容：${input.importedHints.slice(0, 12).join('、')}`
    : '';

  const systemPrompt = `你正在和一个学生一起听课。你的任务不是写课后总结，也不是画思维导图，而是让学生在扫一眼屏幕时知道：老师现在在做什么、刚才如何走到这里、什么值得课后回来。

请直接理解课堂，而不是套固定教学模板。老师可能在定义概念、推导公式、讲案例、讨论、答疑、复习，也可能暂时跑题。你可以修正上一轮的判断；没有足够证据时宁可留空，不要把闲聊包装成知识点。

你本轮只会收到“上次成功更新后新增的转录”。输出增量 JSON：
{
  "title": "可选；只有本轮证据足以修正标题时才输出",
  "now": {
    "id": "稳定且简短的 id",
    "title": "老师此刻讲到的内容",
    "summary": "一句帮助学生跟上的说明",
    "teachingMove": "可选：用自然中文短语说明老师此刻在定义、推导、举例、比较、讨论或总结什么；不得输出 listening_detail 之类枚举名或英文标识",
    "anchorMs": 课堂中大致开始位置
  },
  "recentUpserts": [
    {"id":"...","title":"刚才完成的一步","summary":"可选的一句关系说明","teachingMove":"可选的自然中文短语","anchorMs":0}
  ],
  "recentRemoveIds": ["只有确认应移除时才写 id"],
  "keepUpserts": [
    {"id":"...","kind":"definition|formula|example|question|contrast|conclusion|other","text":"值得课后回来的一点","reason":"可选：为什么值得留下","anchorMs":0}
  ],
  "keepRemoveIds": ["只有本轮已经解决或推翻旧保留点时才写 id"],
  "updatedAtMs": ${Math.max(0, input.elapsedMs)}
}

省略表示“不变”，空数组表示“本轮没有增量”。now 只有老师当前讲解确实推进时才更新；同一语义必须复用已有稳定 id。不要重复上轮 recent / keep，也不要为了填满字段制造内容。文字要自然、具体，避免“这一部分很重要”之类空话。仅输出 JSON。`;

  const userPrompt = `${input.lessonTitle ? `课程标题：${input.lessonTitle}\n` : ''}课堂已进行 ${Math.floor(input.elapsedMs / 1000)} 秒。${materialBlock}${priorBlock}

本轮新增的带时间位置实时转录：
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
    return mergeClassroomFlowDelta(
      priorFlow,
      JSON.parse(response.content),
      input.elapsedMs,
      input.lessonTitle,
    );
  } catch (error) {
    log.warn('[classroom-flow] generation failed; client will retry the unconsumed delta', {
      message: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    throw error;
  }
}

export function mergeClassroomFlowDelta(
  priorFlow: ClassroomFlowState,
  raw: unknown,
  elapsedMs: number,
  lessonTitle = '',
): ClassroomFlowState {
  if (!raw || typeof raw !== 'object') return priorFlow;
  const value = raw as Record<string, unknown>;
  const hasNowPatch = Object.prototype.hasOwnProperty.call(value, 'now');
  const patchedNow = hasNowPatch
    ? value.now === null
      ? null
      : sanitizeMoment(value.now, elapsedMs, 'now') ?? priorFlow.now
    : priorFlow.now;

  const recent = new Map(priorFlow.recent.map((item) => [item.id, item]));
  if (patchedNow && priorFlow.now && patchedNow.id !== priorFlow.now.id) {
    recent.set(priorFlow.now.id, priorFlow.now);
  }
  for (const id of sanitizeIdList(value.recentRemoveIds)) recent.delete(id);
  if (Array.isArray(value.recentUpserts)) {
    value.recentUpserts.forEach((item, index) => {
      const next = sanitizeMoment(item, elapsedMs, `recent-${index}`);
      if (next) recent.set(next.id, next);
    });
  }
  if (patchedNow) recent.delete(patchedNow.id);

  const keep = new Map(priorFlow.keep.map((item) => [item.id, item]));
  for (const id of sanitizeIdList(value.keepRemoveIds)) keep.delete(id);
  if (Array.isArray(value.keepUpserts)) {
    value.keepUpserts.forEach((item, index) => {
      const next = sanitizeSignal(item, elapsedMs, `keep-${index}`);
      if (next) keep.set(next.id, next);
    });
  }

  return {
    title: cleanText(value.title, 42) || priorFlow.title || lessonTitle || patchedNow?.title || '',
    now: patchedNow,
    recent: [...recent.values()].sort((a, b) => a.anchorMs - b.anchorMs).slice(-MAX_FLOW_MOMENTS),
    keep: [...keep.values()].sort((a, b) => a.anchorMs - b.anchorMs).slice(-MAX_KEEP_SIGNALS),
    updatedAtMs: clampMs(value.updatedAtMs, elapsedMs, elapsedMs),
  };
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
        .slice(-MAX_FLOW_MOMENTS)
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
    teachingMove: sanitizeTeachingMove(value.teachingMove),
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

function sanitizeTeachingMove(value: unknown): string | undefined {
  const text = cleanText(value, 48);
  if (!text) return undefined;
  // 模型偶尔会把内部 schema / enum（如 listening_detail）原样返回。
  // 这类开发者标识没有用户价值，宁可不显示，也不在前端翻译一套假标签。
  if (/^[a-z][a-z0-9_-]*$/i.test(text)) return undefined;
  return text;
}

function cleanId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const id = value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return id || fallback;
}

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const id = cleanId(item, '');
    return id ? [id] : [];
  });
}

function clampMs(value: unknown, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(0, fallback);
  return Math.max(0, Math.min(Math.floor(value), Math.max(0, max)));
}
