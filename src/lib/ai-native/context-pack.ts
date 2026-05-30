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
 * 取 pack.lessons[0] 作为单 lesson 上下文。多 lesson 场景（unit/exam）暂未实现，
 * 直接抛错——本期 tier 始终为 'class'，不会触发。
 */
export function buildExecutionContextFromPack(
  pack: ContextPack,
  goal: AppExecutionContext['goal'],
  model?: string
): AppExecutionContext {
  if (pack.lessons.length === 0) {
    throw new Error('[context-pack] cannot build execution context from empty pack');
  }
  if (pack.lessons.length > 1) {
    throw new Error(
      `[context-pack] multi-lesson pack (tier=${pack.tier}, lessons=${pack.lessons.length}) ` +
        'is not yet supported by AppExecutionContext. Only single-lesson (class tier) is implemented.'
    );
  }

  const lesson = pack.lessons[0];
  return {
    input: {
      sessionId: lesson.sessionId,
      dataSource: 'live',
      transcript: lesson.transcript,
      anchors: lesson.anchors,
      metadata: lesson.metadata,
    },
    memory: {
      summary: lesson.summary,
      keyDifficulties: lesson.keyDifficulties,
      terminologyHint: lesson.terminologyHint,
    },
    goal,
    model,
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
// Renderer（PR-2 完整化）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 把转录段落 + 个人标记合并渲染成 prompt 用的纯文本块。
 *
 * 当前 PR-1 范围：占位实现——仅渲染原始转录，标记暂不内联。
 * PR-2 将补：
 *   - 按时间合并标记到最近段落后
 *   - 标记格式 `[t=MM:SS ⟪困惑⟫]` / `[t=MM:SS ⟪用户备注：xxx⟫]` / `[t=MM:SS ⟪重点⟫]`
 *   - 单课软上限 20 条，超过按时间临近度合并
 *   - personalAnnotations 为 undefined 时 → 退化为纯转录（分发剥离）
 *   - 完整单元测试
 *
 * 调用约定：
 *   const promptText = renderTranscriptWithAnnotations(pack);
 *   // pack.personalAnnotations 传入 → 注入；为 undefined → 不注入
 */
export function renderTranscriptWithAnnotations(pack: ContextPack): string {
  // PR-1 占位：仅 join 转录，标记融入留 PR-2 实现
  const lesson = pack.lessons[0];
  if (!lesson) return '';

  return lesson.transcript
    .map((seg) => {
      const tStart = formatMs(seg.startMs);
      return `[t=${tStart}] ${seg.text}`;
    })
    .join('\n');
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
  if (pack.lessons.length === 0) {
    return { ok: false, reason: 'pack.lessons cannot be empty' };
  }
  if (pack.tier === 'class' && pack.lessons.length !== 1) {
    return {
      ok: false,
      reason: `class tier requires exactly 1 lesson, got ${pack.lessons.length}`,
    };
  }
  if (pack.tier === 'exam' && !pack.exam) {
    return { ok: false, reason: 'exam tier requires pack.exam' };
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
