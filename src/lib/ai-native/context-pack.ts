/**
 * Context Pack — 应用矩阵的统一上下文契约（PRD v1.1 §2）
 *
 * 本文件提供：
 *   1. ContextPack ↔ AppExecutionContext 的双向适配（向后兼容）
 *   2. renderTranscriptWithAnnotations() —— 标记融入转录的纯函数（PR-2 完整实现）
 *
 * 设计原则：
 *   - 类型定义在 types.ts，运行时逻辑在这里
 *   - PR-1 范围：纯结构化，零行为变化。adapter 让现有 plugin 不改一行也能从 pack 读
 *   - PR-2 范围：renderTranscriptWithAnnotations 完整化 + 单元测试
 */

import type {
  AppExecutionContext,
  ContextPack,
  ContextTier,
  LessonContext,
  PersonalAnnotation,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// Adapters
// ─────────────────────────────────────────────────────────────────────────

/**
 * 把 AppExecutionContext（旧契约）转成 ContextPack（新契约）。
 *
 * 用于让现有 plugin 在不重写的前提下，逐步迁移到 pack 模式：
 *   - 旧调用：plugin.run(ctx, tools)
 *   - 新调用：plugin.run(packToExecutionContext(pack), tools)
 *
 * 旧 AppExecutionContext 只承载单 lesson，所以输出 pack.lessons 长度恒为 1，
 * tier 恒为 'class'。
 */
export function buildPackFromExecutionContext(
  ctx: AppExecutionContext,
  options?: { personalAnnotations?: PersonalAnnotation[] }
): ContextPack {
  const lesson: LessonContext = {
    sessionId: ctx.input.sessionId,
    transcript: ctx.input.transcript,
    anchors: ctx.input.anchors,
    summary: ctx.memory.summary,
    keyDifficulties: ctx.memory.keyDifficulties,
    terminologyHint: ctx.memory.terminologyHint,
    metadata: ctx.input.metadata,
  };

  return {
    tier: 'class',
    lessons: [lesson],
    personalAnnotations: options?.personalAnnotations,
  };
}

/**
 * 把 ContextPack（新契约）转回 AppExecutionContext（旧契约），用于喂给现有 plugin。
 *
 * 单 lesson 保持原引用；多 lesson 按发生时间排序并展平成一条只供插件消费的时间轴，
 * 同时为每段写入 sourceItemId/sourceTitle，并在 metadata.lessonSources 保存 offset。
 * 下游引用必须用这份映射还原到“哪节课 + 课内时间”，不得把聚合时间冒充单课时间。
 */
export function buildExecutionContextFromPack(
  pack: ContextPack,
  goal: AppExecutionContext['goal'],
  model?: string
): AppExecutionContext {
  if (pack.lessons.length === 0) {
    throw new Error('[context-pack] cannot build execution context from empty pack');
  }
  const orderedLessons = [...pack.lessons].sort((a, b) => (
    (a.occurredAt ?? 0) - (b.occurredAt ?? 0)
  ));
  const lessonSources: Array<{
    sessionId: string;
    title: string;
    offsetMs: number;
    durationMs: number;
  }> = [];
  const transcript: LessonContext['transcript'] = [];
  const anchors: LessonContext['anchors'] = [];
  let offsetMs = 0;

  for (const [lessonIndex, lesson] of orderedLessons.entries()) {
    const durationMs = lesson.transcript.reduce((max, segment) => Math.max(max, segment.endMs), 0);
    const title = lesson.title?.trim() || `第 ${lessonIndex + 1} 节课`;
    lessonSources.push({ sessionId: lesson.sessionId, title, offsetMs, durationMs });
    lesson.transcript.forEach((segment) => {
      transcript.push({
        ...segment,
        id: `${lesson.sessionId}:${segment.id}`,
        startMs: segment.startMs + offsetMs,
        endMs: segment.endMs + offsetMs,
        sourceItemId: lesson.sessionId,
        sourceTitle: title,
      });
    });
    lesson.anchors.forEach((anchor) => {
      anchors.push({
        ...anchor,
        id: `${lesson.sessionId}:${anchor.id}`,
        timestamp: anchor.timestamp + offsetMs,
      });
    });
    // 每节课之间留 1 秒空隙，防止边界时间恰好重合；真实课内时间由 lessonSources 还原。
    offsetMs += Math.max(1, durationMs) + 1_000;
  }

  const lesson = orderedLessons[0];
  const summaries = orderedLessons.map((item) => item.summary?.trim()).filter(Boolean);
  const difficulties = orderedLessons.flatMap((item) => item.keyDifficulties || []);
  const terminology = orderedLessons.map((item) => item.terminologyHint?.trim()).filter(Boolean);
  return {
    input: {
      sessionId: pack.tier === 'class' ? lesson.sessionId : `${pack.tier}:${orderedLessons.map((item) => item.sessionId).join(',')}`,
      dataSource: 'live',
      transcript: pack.lessons.length === 1 ? lesson.transcript : transcript,
      anchors: pack.lessons.length === 1 ? lesson.anchors : anchors,
      metadata: {
        ...lesson.metadata,
        contextTier: pack.tier,
        lessonSources,
        exam: pack.exam,
      },
    },
    memory: {
      summary: summaries.join('\n') || lesson.summary,
      keyDifficulties: difficulties.length > 0 ? Array.from(new Set(difficulties)) : lesson.keyDifficulties,
      terminologyHint: terminology.join('\n') || lesson.terminologyHint,
      custom: {
        lessonSources,
        exam: pack.exam,
      },
    },
    goal,
    model,
    contextTier: pack.tier,
  };
}

/**
 * 从单个 session 的原料直接构造 ContextPack（最常见的 class tier 入口）。
 *
 * 给 WorkshopYellowPage 等 UI 层调用，避免它们手动拼 ContextPack。
 */
export function buildPackFromSingleSession(args: {
  sessionId: string;
  transcript: LessonContext['transcript'];
  anchors: LessonContext['anchors'];
  summary?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  title?: string;
  occurredAt?: number;
  metadata?: LessonContext['metadata'];
  personalAnnotations?: PersonalAnnotation[];
}): ContextPack {
  const {
    personalAnnotations,
    sessionId,
    transcript,
    anchors,
    summary,
    keyDifficulties,
    terminologyHint,
    title,
    occurredAt,
    metadata,
  } = args;

  return {
    tier: 'class',
    lessons: [
      {
        sessionId,
        transcript,
        anchors,
        summary,
        keyDifficulties,
        terminologyHint,
        title,
        occurredAt,
        metadata,
      },
    ],
    personalAnnotations,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Renderer（PRD v1.1 §2.2）
//
// 把转录段落 + 个人标记合并渲染成 prompt 用的纯文本块。
//
// 核心约束：
//   - 当 pack.personalAnnotations 为 undefined 或空数组 → 退化为纯转录
//     （分发剥离：主分支分发场景上下文时不传该字段）
//   - 标记按 targetMs 归属到"包含或最早出现于此之前"的转录段落，附加在该段后
//   - 单课软上限 ANNOTATION_SOFT_LIMIT 条，超过时按 kind 优先级（note > star >
//     confusion）取前 N 条，再按时间排序输出
//   - 注入格式 `[t=MM:SS ⟪...⟫]`，与转录行 `[t=MM:SS] ...` 视觉上明显区分
// ─────────────────────────────────────────────────────────────────────────

/** 单课内最多保留多少条个人标记，防止 prompt 膨胀 + LLM 失焦。 */
export const ANNOTATION_SOFT_LIMIT = 20;

/** 标记 kind 在超限时的保留优先级（数字越小越优先）。 */
const ANNOTATION_PRIORITY: Record<PersonalAnnotation['kind'], number> = {
  note: 0,     // 用户写过文字的标记，付出成本最高，最该保留
  star: 1,     // 用户主动星标重点
  confusion: 2 // 单按困惑按钮，最廉价
};

/**
 * 把单条标记格式化为 prompt 文本片段。
 *
 * 格式约定（与 §2.2.2 对齐）：
 *   - confusion：`[t=MM:SS ⟪困惑⟫]`
 *   - star：`[t=MM:SS ⟪重点⟫]` 或 `[t=MM:SS ⟪重点：text⟫]`
 *   - note：`[t=MM:SS ⟪用户备注：text⟫]` 或退化 `[t=MM:SS ⟪标记⟫]`
 */
export function formatAnnotation(ann: PersonalAnnotation): string {
  const t = formatMs(ann.targetMs);
  const text = (ann.text || '').trim();
  switch (ann.kind) {
    case 'confusion':
      return text ? `[t=${t} ⟪困惑：${text}⟫]` : `[t=${t} ⟪困惑⟫]`;
    case 'star':
      return text ? `[t=${t} ⟪重点：${text}⟫]` : `[t=${t} ⟪重点⟫]`;
    case 'note':
      return text ? `[t=${t} ⟪用户备注：${text}⟫]` : `[t=${t} ⟪标记⟫]`;
  }
}

/**
 * 在标记数超过软上限时，按 kind 优先级筛选保留集合，再按时间排序。
 *
 * 当前策略（PR-2）：直接按优先级取前 N。未来可以改为"按 kind 优先级 + 时间临近度
 * 合并"——例如 30 秒窗口内 ≥2 条压成一条。先简单实现，看真实数据再优化。
 */
export function pickAnnotationsForPrompt(
  annotations: PersonalAnnotation[],
  sessionId: string,
  softLimit: number = ANNOTATION_SOFT_LIMIT
): PersonalAnnotation[] {
  const filtered = annotations.filter((a) => a.sessionId === sessionId);
  if (filtered.length <= softLimit) {
    return [...filtered].sort((a, b) => a.targetMs - b.targetMs);
  }
  const sortedByPriority = [...filtered].sort((a, b) => {
    const p = ANNOTATION_PRIORITY[a.kind] - ANNOTATION_PRIORITY[b.kind];
    if (p !== 0) return p;
    return a.targetMs - b.targetMs;
  });
  return sortedByPriority.slice(0, softLimit).sort((a, b) => a.targetMs - b.targetMs);
}

/**
 * 找到标记归属的转录段落 index。
 *
 * 规则：取"startMs <= targetMs"的最后一个段落（即标记落在哪个段落正在播放时）。
 * 若 targetMs 早于第一个段落（用户在录音开头就标了），返回 -1，渲染时附加在最前。
 */
export function findOwningSegmentIndex(
  targetMs: number,
  segments: Array<{ startMs: number }>
): number {
  let idx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startMs <= targetMs) {
      idx = i;
    } else {
      break; // segments 按 startMs 升序，可提前退出
    }
  }
  return idx;
}

/**
 * 把转录段落 + 个人标记合并渲染成 prompt 用的纯文本块。
 *
 * 调用约定：
 *   const promptText = renderTranscriptWithAnnotations(pack);
 *   // pack.personalAnnotations 传入 → 内联标记
 *   // 为 undefined / 空数组 → 退化为纯转录（分发自动剥离）
 *
 * 多 lesson 场景（unit / exam）：每节课渲染为一个段落块，
 * 段落间用 `---` 分隔，块头标注 lesson title / occurredAt。
 */
export function renderTranscriptWithAnnotations(pack: ContextPack): string {
  if (pack.lessons.length === 0) return '';

  const lessonBlocks: string[] = [];
  for (const lesson of pack.lessons) {
    const block = renderSingleLesson(lesson, pack.personalAnnotations);
    if (lessonBlocks.length > 0 && pack.lessons.length > 1) {
      lessonBlocks.push('\n---\n');
    }
    if (pack.lessons.length > 1) {
      const header = lesson.title
        ? `# ${lesson.title}${lesson.occurredAt ? ` (${new Date(lesson.occurredAt).toISOString().slice(0, 10)})` : ''}`
        : `# session ${lesson.sessionId}`;
      lessonBlocks.push(header);
    }
    lessonBlocks.push(block);
  }

  return lessonBlocks.join('\n').trim();
}

function renderSingleLesson(
  lesson: LessonContext,
  allAnnotations: PersonalAnnotation[] | undefined
): string {
  const segments = lesson.transcript;

  // 无标记 / 标记为空 → 纯转录（分发剥离场景）
  if (!allAnnotations || allAnnotations.length === 0) {
    return segments.map((seg) => `[t=${formatMs(seg.startMs)}] ${seg.text}`).join('\n');
  }

  const lessonAnns = pickAnnotationsForPrompt(allAnnotations, lesson.sessionId);
  if (lessonAnns.length === 0) {
    return segments.map((seg) => `[t=${formatMs(seg.startMs)}] ${seg.text}`).join('\n');
  }

  // 按归属段落分桶；-1 表示在第一个段落之前
  const byOwnerIdx = new Map<number, PersonalAnnotation[]>();
  for (const ann of lessonAnns) {
    const idx = findOwningSegmentIndex(ann.targetMs, segments);
    const list = byOwnerIdx.get(idx) ?? [];
    list.push(ann);
    byOwnerIdx.set(idx, list);
  }

  const lines: string[] = [];

  // 录音开头就标的标记（在第一段之前）
  const beforeAll = byOwnerIdx.get(-1);
  if (beforeAll) {
    for (const ann of beforeAll) lines.push(formatAnnotation(ann));
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    lines.push(`[t=${formatMs(seg.startMs)}] ${seg.text}`);
    const anns = byOwnerIdx.get(i);
    if (anns) {
      for (const ann of anns) lines.push(formatAnnotation(ann));
    }
  }

  return lines.join('\n');
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

/** 检查 ContextPack 在某个 tier 下是否合法（lessons 数量 / exam 字段）。 */
export function validatePack(pack: ContextPack): { ok: boolean; reason?: string } {
  if (!pack || !Array.isArray(pack.lessons)) {
    return { ok: false, reason: 'pack.lessons must be an array' };
  }
  if (pack.lessons.length === 0) {
    return { ok: false, reason: 'pack.lessons cannot be empty' };
  }
  if (pack.tier === 'class' && pack.lessons.length !== 1) {
    return {
      ok: false,
      reason: `class tier requires exactly 1 lesson, got ${pack.lessons.length}`,
    };
  }
  if (pack.tier === 'unit' && pack.lessons.length < 2) {
    return { ok: false, reason: 'unit tier requires at least 2 lessons' };
  }
  if (pack.tier === 'exam' && !pack.exam) {
    return { ok: false, reason: 'exam tier requires pack.exam' };
  }
  for (const [lessonIndex, lesson] of pack.lessons.entries()) {
    if (!lesson || typeof lesson.sessionId !== 'string' || !lesson.sessionId.trim()) {
      return { ok: false, reason: `lesson ${lessonIndex + 1} requires sessionId` };
    }
    if (!Array.isArray(lesson.transcript) || !Array.isArray(lesson.anchors)) {
      return { ok: false, reason: `lesson ${lesson.sessionId} requires transcript and anchors arrays` };
    }
    const invalidSegment = lesson.transcript.find((segment) => (
      !segment
      || typeof segment.id !== 'string'
      || typeof segment.text !== 'string'
      || !Number.isFinite(segment.startMs)
      || !Number.isFinite(segment.endMs)
      || segment.startMs < 0
      || segment.endMs < segment.startMs
    ));
    if (invalidSegment) {
      return { ok: false, reason: `lesson ${lesson.sessionId} contains an invalid transcript segment` };
    }
  }
  return { ok: true };
}

/** 列出某个 tier 下应该展示哪些应用——给 WorkshopYellowPage 用。 */
export function isAppSupportedAtTier(
  appSupportedTiers: ContextTier[] | undefined,
  tier: ContextTier
): boolean {
  if (!appSupportedTiers || appSupportedTiers.length === 0) return true; // 兼容未标注的旧 catalog 项
  return appSupportedTiers.includes(tier);
}
