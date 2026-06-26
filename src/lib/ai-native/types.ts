import type { Anchor, TranscriptSegment } from '@/types';

export type DataSourceType = 'live' | 'video' | 'demo' | 'unknown';

export interface InputLayerContext {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  metadata?: {
    subject?: string;
    teacher?: string;
    studentId?: string;
    studentName?: string;
    locale?: string;
    [key: string]: unknown;
  };
}

export interface MemoryLayerSnapshot {
  summary?: string;
  notes?: string[];
  keyDifficulties?: string[];
  /** Auto-discovered terminology hint (from term-discovery pipeline). Injected into AI prompts. */
  terminologyHint?: string;
  timeline?: {
    durationMs: number;
    segmentCount: number;
    unresolvedAnchorCount: number;
  };
  custom?: Record<string, unknown>;
}

export interface ApplicationGoal {
  intent: string;
  constraints?: string[];
  expectedOutput?: 'chat' | 'cards' | 'tasks' | 'mixed';
  appKey?: string;
}

export interface AppExecutionContext {
  input: InputLayerContext;
  memory: MemoryLayerSnapshot;
  goal: ApplicationGoal;
  model?: string;
}

export type CardPriority = 'high' | 'medium' | 'low';
export type AppCardType = 'insight' | 'task' | 'question' | 'timeline' | 'flashcard' | 'quiz' | 'mindmap';

export interface AppCardCitation {
  startMs: number;
  endMs: number;
  snippet?: string;
}

export interface AppCardAction {
  id: string;
  label: string;
  kind: 'seek' | 'ask' | 'mark_done' | 'open';
  payload?: Record<string, unknown>;
}

export interface AppCard {
  id: string;
  type: AppCardType;
  title: string;
  body: string;
  priority?: CardPriority;
  citations?: AppCardCitation[];
  actions?: AppCardAction[];
  meta?: Record<string, unknown>;
}

export interface AppTask {
  id: string;
  label: string;
  reason?: string;
  estimatedMinutes?: number;
  relatedTimestamp?: number;
}

export type AppRenderMode =
  | 'document'
  | 'table'
  | 'script'
  | 'audio'
  | 'image'
  | 'slides'
  | 'mindmap'
  | 'flashcards'
  | 'quiz'
  | 'blocks'
  | 'custom';

export interface AppRenderSpec {
  mode: AppRenderMode;
  title?: string;
  description?: string;
  payload: unknown;
}

export interface AppExecutionResult {
  pluginId: string;
  version: string;
  model?: string;
  cards: AppCard[];
  tasks: AppTask[];
  trace: string[];
  render?: AppRenderSpec;
  raw?: Record<string, unknown>;
}

export interface AppPluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  capabilities: string[];
  enabledByDefault?: boolean;
}

export interface SearchTranscriptParams {
  transcript: TranscriptSegment[];
  query: string;
  limit?: number;
}

export interface AppPluginTools {
  searchTranscript(params: SearchTranscriptParams): TranscriptSegment[];
  summarizeSegments(segments: TranscriptSegment[], maxChars?: number): string;
  now(): string;
}

export interface AppPlugin {
  manifest: AppPluginManifest;
  canHandle(context: AppExecutionContext): boolean;
  run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult>;
}

export interface AppExecuteRequest {
  appKey?: string;
  pluginId?: string;
  model?: string;
  goal: ApplicationGoal | string;
  input: {
    sessionId?: string;
    dataSource?: DataSourceType;
    transcript: TranscriptSegment[];
    anchors?: Anchor[];
    metadata?: InputLayerContext['metadata'];
  };
  memory?: Partial<MemoryLayerSnapshot>;
}

// ─────────────────────────────────────────────────────────────────────────
// Context Pack (PRD v1.1 §2)
//
// 应用矩阵的统一上下文契约。三层心智（class / unit / exam）共用一套结构，
// 本期始终为 'class'。是给主分支裂变能力（v3.0 SharedAgent）的合并接口：
// 主分支只需要构造 ContextPack 就能复用应用矩阵，不直接调 plugin 或拼 prompt。
//
// 关键约束：
//   1. lessons[] = 场景上下文（会被分发）
//   2. personalAnnotations[] = 个人上下文-局部型（不分发）
//      用户自用渲染时注入；分发渲染时为 undefined（自动剥离）
//   3. exam = 考试层独有字段，本期 undefined
//
// 注入逻辑见 src/lib/ai-native/context-pack.ts 的 renderTranscriptWithAnnotations()
// ─────────────────────────────────────────────────────────────────────────

/** 三层心智：课堂 / 单元 / 考试。本期所有应用 tier='class'。 */
export type ContextTier = 'class' | 'unit' | 'exam';

/** 单节课的场景上下文。N 个 lesson 组成 unit/exam 的上下文集合。 */
export interface LessonContext {
  sessionId: string;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summary?: string;
  keyDifficulties?: string[];
  /** 课程显示名（如 "微观经济学 第七讲"） */
  title?: string;
  /** 上课时间戳；用于 unit/exam 多课排序 */
  occurredAt?: number;
  /** 自动发现的术语提示，注入 prompt 头部 */
  terminologyHint?: string;
  /** 课程元信息（学科、老师、学生等） */
  metadata?: InputLayerContext['metadata'];
}

/**
 * 个人上下文-局部型：用户在某节课的标记/困惑。
 *
 * - 数据层独立存（绑定 sessionId + targetMs）
 * - Prompt 层由 renderTranscriptWithAnnotations 内联到转录文本
 * - 分发渲染时 personalAnnotations 不传入 → 自动剥离
 *
 * kind 语义：
 *   - 'confusion'：弱标记（用户单按"困惑"按钮，无文字）
 *   - 'note'：强标记（用户写了文字说明）
 *   - 'star'：星标重点
 */
export interface PersonalAnnotation {
  sessionId: string;
  targetMs: number;
  kind: 'confusion' | 'note' | 'star';
  /** 强标记带文字；弱标记/星标可空 */
  text?: string;
}

/** 应用矩阵的统一上下文契约。 */
export interface ContextPack {
  /** 三层心智。本期始终为 'class'。 */
  tier: ContextTier;
  /** 场景上下文：会被分发的内容（转录 + anchors + 摘要等）。 */
  lessons: LessonContext[];
  /** 个人上下文-局部型：用户标记/困惑。**不会被分发**——分发渲染时此字段不传。 */
  personalAnnotations?: PersonalAnnotation[];
  /** 考试层独有字段（真题 + 大纲），本期始终 undefined。 */
  exam?: {
    name?: string;
    targetDate?: number;
    pastPapers?: Array<{ title: string; content: string }>;
    syllabus?: string;
  };
}
