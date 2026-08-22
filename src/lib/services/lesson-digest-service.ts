import type { TranscriptSegment } from '@/types';
import { parseJsonResponse } from '@/lib/utils/json-utils';
import { chat, DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('lesson-digest-service');

/**
 * lesson-digest — 飞书妙记式结构化课堂总结
 *
 * 把一节课的转录 segments + 课中拍的照片（带 capturedAtMs 锚点）
 * 整理成按时间自然分段的总结，每段：小标题 + 摘要 + 可选图片 + 时间戳。
 *
 * 和 cheatsheet.plugin.ts 的区别：
 *   - cheatsheet 按"知识类型"分区（定义/公式/易错点）
 *   - lesson-digest 按"时间自然分段"，每段可携带一张图片
 *   - lesson-digest 不是 AppPlugin（不破坏"7类ready应用"不变量）
 *
 * 输出契约（固定，供 LessonDigestCard 直接消费）：
 *   { title, overview, sections: [{ heading, text, imageId?, startMs, endMs }], extras: [{ text, imageId? }] }
 */

export interface DigestImageRef {
  /** 图片在 SourceIngestItem 中的 id */
  imageId: string;
  /** 相对录音 session 的毫秒偏移（课中拍照才有，沉淀态补拍为 null） */
  capturedAtMs: number | null;
  /** 图片标题（来自 parseImageFile） */
  title?: string;
  /** OCR 识别出的文字内容（来自 parseImageFile → /api/sources/ingest-image） */
  ocrText?: string;
}

export interface DigestSection {
  heading: string;
  text: string;
  /** 命中该时间段的照片 id（可选） */
  imageId?: string;
  /** 该段对应的录音时间范围 */
  startMs: number;
  endMs: number;
}

export interface DigestExtra {
  /** 课后补充区的文字说明 */
  text: string;
  /** 课后补充照片 id（可选） */
  imageId?: string;
}

export interface LessonDigest {
  title: string;
  overview: string;
  sections: DigestSection[];
  extras: DigestExtra[];
}

export interface DigestLLMOutput {
  title?: string;
  overview?: string;
  sections?: Array<{
    heading?: string;
    text?: string;
    imageIndex?: number;
    startMs?: number | string;
    endMs?: number | string;
  }>;
  extras?: Array<{
    text?: string;
    imageIndex?: number;
  }>;
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
    }
    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      const hour = match[3] ? Number(match[1]) : 0;
      const minute = match[3] ? Number(match[2]) : Number(match[1]);
      const second = match[3] ? Number(match[3]) : Number(match[2]);
      if ([hour, minute, second].every((n) => Number.isFinite(n) && n >= 0)) {
        return (hour * 3600 + minute * 60 + second) * 1000;
      }
    }
  }
  return fallback;
}

function cleanText(value: string): string {
  return value.replace(/[\u00A0\u2000-\u200F\u202F\u205F\u3000]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 把图片按 capturedAtMs 分配到最接近的 transcript 段落。
 * 没有 capturedAtMs 的图片返回 null（放入 extras）。
 */
function findImageForSegment(
  images: DigestImageRef[],
  segmentStartMs: number,
  segmentEndMs: number,
): DigestImageRef | null {
  if (images.length === 0) return null;
  // 优先找落在该段时间范围内的图片
  for (const img of images) {
    // capturedAtMs 缺失或 <= 0 视为无锚点（课外随手拍），不参与课中段落匹配
    if (img.capturedAtMs === null || img.capturedAtMs === undefined || img.capturedAtMs <= 0) continue;
    if (img.capturedAtMs >= segmentStartMs && img.capturedAtMs <= segmentEndMs) {
      return img;
    }
  }
  return null;
}

function buildTranscriptContext(segments: TranscriptSegment[]): string {
  const lines: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = cleanText(seg.text || '');
    if (!text) continue;
    const startSec = Math.floor(seg.startMs / 1000);
    const endSec = Math.floor(seg.endMs / 1000);
    const m1 = Math.floor(startSec / 60);
    const s1 = startSec % 60;
    const m2 = Math.floor(endSec / 60);
    const s2 = endSec % 60;
    lines.push(`[${String(m1).padStart(2,'0')}:${String(s1).padStart(2,'0')}-${String(m2).padStart(2,'0')}:${String(s2).padStart(2,'0')}] ${text}`);
  }
  return lines.join('\n');
}

function buildImageContext(images: DigestImageRef[]): string {
  if (images.length === 0) return '';
  const lines: string[] = ['\n\n课中拍的照片（按时间顺序，含OCR识别文字）：'];
  images.forEach((img, i) => {
    const time = img.capturedAtMs !== null && img.capturedAtMs !== undefined
      ? `${String(Math.floor(img.capturedAtMs / 60000)).padStart(2,'0')}:${String(Math.floor((img.capturedAtMs / 1000) % 60)).padStart(2,'0')}`
      : '课后补充';
    const title = img.title || '未命名';
    const ocr = img.ocrText ? `\n    OCR文字: ${img.ocrText.slice(0, 500)}` : '';
    lines.push(`  照片${i + 1}: ${title} [拍摄于 ${time}]${ocr}`);
  });
  return lines.join('\n');
}

async function generateDigestWithLLM(
  segments: TranscriptSegment[],
  images: DigestImageRef[],
  lessonTitle?: string,
): Promise<DigestLLMOutput | null> {
  const transcriptCtx = buildTranscriptContext(segments);
  const imageCtx = buildImageContext(images);
  const titleHint = lessonTitle ? `\n当前课程：${lessonTitle}` : '';

  const systemPrompt = `你是这位学生的课堂笔记助手。你要把这节课的转录原文整理成一份结构化笔记，参考飞书妙记的形态。

要求：
1. 按时间自然分段（不是按知识类型分区），每段一个小标题 + 几句摘要
2. 如果某段时间学生拍过照片，把图片信息融入摘要文字（比如"老师在板书上写了公式 θ=θ-η∇L(θ)"），不是简单挂附件
3. 摘要是你重新组织的干净文字，不是转录原文复制粘贴——过滤口头禅、修正明显 ASR 错误
4. 没有照片的段落照常分段
5. 没有时间锚点的照片（课后补充）放进 extras 区，不参与分段
6. 每段时间戳指向课堂证据（毫秒）

输出 JSON：
{
  "title": "一句话标题（≤16字）",
  "overview": "这节课讲了什么（≤60字）",
  "sections": [
    { "heading": "小标题", "text": "摘要文字（50-150字）", "imageIndex": 0, "startMs": 0, "endMs": 120000 }
  ],
  "extras": [
    { "text": "课后补充说明", "imageIndex": 1 }
  ]
}

imageIndex 对应照片列表的序号（从0开始）。如果该段没有照片，不写 imageIndex 字段。

仅输出 JSON，不要多说一个字。`;

  const userMsg = `课堂转录原文：${titleHint}\n\n${transcriptCtx}${imageCtx}`;

  try {
    const response = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      DEFAULT_MODEL_ID,
      { temperature: 0.3, maxTokens: 4000, responseFormat: 'json_object' },
    );
    return parseJsonResponse<DigestLLMOutput>(response.content);
  } catch (err) {
    log.warn('[lesson-digest] LLM error:', err);
    return null;
  }
}

function buildFallbackDigest(
  segments: TranscriptSegment[],
  images: DigestImageRef[],
): LessonDigest {
  // 按 5 分钟粗分段
  const CHUNK_MS = 5 * 60 * 1000;
  const sections: DigestSection[] = [];
  let chunkStart = 0;
  let chunkEnd = CHUNK_MS;

  while (chunkStart < (segments[segments.length - 1]?.endMs || 0)) {
    const chunkSegs = segments.filter((s) => s.startMs >= chunkStart && s.startMs < chunkEnd);
    if (chunkSegs.length > 0) {
      const text = chunkSegs.map((s) => cleanText(s.text)).filter(Boolean).join(' ').slice(0, 200);
      const img = findImageForSegment(images, chunkStart, chunkEnd);
      sections.push({
        heading: `第 ${Math.floor(chunkStart / 60000) + 1} 段`,
        text: text || '（这段没有文字内容）',
        imageId: img?.imageId,
        startMs: chunkStart,
        endMs: chunkEnd,
      });
    }
    chunkStart = chunkEnd;
    chunkEnd += CHUNK_MS;
  }

  const extraImages = images.filter((img) => img.capturedAtMs === null || img.capturedAtMs === undefined);
  const extras: DigestExtra[] = extraImages.map((img) => ({
    text: img.title || '课后补充照片',
    imageId: img.imageId,
  }));

  return {
    title: '课堂笔记',
    overview: '',
    sections: sections.length > 0 ? sections : [{
      heading: '课堂内容',
      text: '暂无可用转录内容。',
      startMs: 0,
      endMs: 0,
    }],
    extras,
  };
}

/**
 * 把模型 JSON 归一化为前端可直接渲染的 digest。
 * 用显式循环保留上一段 endMs，避免在 sections 初始化过程中
 * 反向引用 sections 本身导致 TDZ ReferenceError。
 */
export function normalizeLessonDigestOutput(
  llmOutput: DigestLLMOutput,
  segments: TranscriptSegment[],
  images: DigestImageRef[],
  lessonTitle?: string,
): LessonDigest {
  const title = cleanText(llmOutput.title || '') || lessonTitle || '课堂笔记';
  const overview = cleanText(llmOutput.overview || '');
  const sections: DigestSection[] = [];

  for (const [index, section] of (llmOutput.sections || []).entries()) {
    const fallbackStartMs = sections.at(-1)?.endMs || 0;
    const startMs = toTimestamp(section.startMs, fallbackStartMs);
    const endMs = toTimestamp(section.endMs, startMs + 60000);
    const imageIndex = typeof section.imageIndex === 'number' ? section.imageIndex : undefined;
    const image = imageIndex !== undefined
      ? images[imageIndex]
      : findImageForSegment(images, startMs, endMs);
    const text = cleanText(section.text || '');
    if (!text) continue;
    sections.push({
      heading: cleanText(section.heading || '') || `第 ${index + 1} 段`,
      text,
      imageId: image?.imageId,
      startMs,
      endMs,
    });
  }

  const extras: DigestExtra[] = (llmOutput.extras || []).map((extra) => {
    const imageIndex = typeof extra.imageIndex === 'number' ? extra.imageIndex : undefined;
    return {
      text: cleanText(extra.text || '课后补充'),
      imageId: imageIndex !== undefined ? images[imageIndex]?.imageId : undefined,
    };
  });

  const assignedImageIds = new Set(
    [...sections.map((section) => section.imageId), ...extras.map((extra) => extra.imageId)]
      .filter(Boolean) as string[],
  );
  for (const image of images) {
    if (image.capturedAtMs === null || image.capturedAtMs === undefined) continue;
    if (!assignedImageIds.has(image.imageId)) {
      extras.push({ text: image.title || '未分配的课中照片', imageId: image.imageId });
    }
  }

  return {
    title,
    overview,
    sections: sections.length > 0 ? sections : buildFallbackDigest(segments, images).sections,
    extras,
  };
}

/**
 * 生成 lesson-digest。
 *
 * @param segments 转录 segments（有 startMs/endMs/text）
 * @param images 课中拍的图片列表（有 capturedAtMs 锚点）
 * @param lessonTitle 课程标题（可选）
 */
export async function generateLessonDigest(
  segments: TranscriptSegment[],
  images: DigestImageRef[],
  lessonTitle?: string,
): Promise<LessonDigest> {
  if (segments.length === 0) {
    return {
      title: lessonTitle || '课堂笔记',
      overview: '这节课没有转录内容。',
      sections: [],
      extras: images.filter((img) => img.capturedAtMs === null).map((img) => ({
        text: img.title || '课后补充照片',
        imageId: img.imageId,
      })),
    };
  }

  const llmOutput = await generateDigestWithLLM(segments, images, lessonTitle);

  if (!llmOutput) {
    log.info('[lesson-digest] LLM failed, using fallback');
    return buildFallbackDigest(segments, images);
  }

  return normalizeLessonDigestOutput(llmOutput, segments, images, lessonTitle);
}
