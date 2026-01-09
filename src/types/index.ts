/**
 * MeetMind 统一类型定义
 */

// ==================== 基础类型 ====================

export type AnchorType = 'confusion' | 'important' | 'question';
export type SegmentType = 'lecture' | 'qa' | 'exercise';
export type SessionStatus = 'recording' | 'paused' | 'completed';
export type UserRole = 'student' | 'parent' | 'teacher';

// ==================== 核心实体 ====================

/**
 * 断点/锚点 - 学生标记的困惑点
 */
export interface Anchor {
  id: string;
  sessionId: string;
  studentId: string;
  timestamp: number;  // 课堂时间戳（毫秒）
  type: AnchorType;
  cancelled: boolean;
  resolved: boolean;
  createdAt: string;
  note?: string;
}

/**
 * 断点（兼容旧接口）
 * @deprecated 使用 Anchor 代替
 */
export interface Breakpoint {
  id: string;
  lessonId: string;
  studentId: string;
  timestamp: number;
  type: AnchorType;
  resolved: boolean;
  createdAt: string;
}

/**
 * 转录片段
 */
export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
  speakerId?: string;
  isFinal?: boolean;
}

/**
 * 时间轴片段（包含断点关联）
 */
export interface TimelineSegment extends TranscriptSegment {
  anchors: Anchor[];
  type: SegmentType;
}

/**
 * 主题/章节
 */
export interface Topic {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  segmentIds: string[];
}

/**
 * 课堂会话
 */
export interface Session {
  id: string;
  studentId: string;
  subject: string;
  teacher: string;
  date: string;
  status: SessionStatus;
  audioUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 课堂时间轴
 */
export interface ClassTimeline {
  id: string;
  lessonId: string;
  date: string;
  subject: string;
  teacher: string;
  duration: number;  // 总时长（毫秒）
  segments: TimelineSegment[];
  anchors: Anchor[];
  audioUrl?: string;
}

// ==================== AI 相关 ====================

/**
 * AI 模型提供商
 */
export type ModelProvider = 'qwen' | 'gemini' | 'openai';

/**
 * 模型配置
 */
export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  maxTokens: number;
  recommended?: boolean;
}

/**
 * 聊天消息
 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * LLM 响应
 */
export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * AI 家教响应
 */
export interface TutorResponse {
  explanation: {
    teacherSaid: string;
    citation: {
      text: string;
      timeRange: string;
      startMs: number;
      endMs: number;
    };
    possibleStuckPoints: string[];
    followUpQuestion: string;
  };
  actionItems: ActionItem[];
  rawContent: string;
  model: string;
  usage?: LLMResponse['usage'];
}

// ==================== 行动项 ====================

export type ActionItemType = 'replay' | 'exercise' | 'review';

/**
 * 行动项
 */
export interface ActionItem {
  id: string;
  type: ActionItemType;
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
  relatedTimestamp?: number;
}

// ==================== 家长端 ====================

/**
 * 困惑点摘要
 */
export interface ConfusionPoint {
  id: string;
  subject: string;
  time: string;
  timestamp: number;
  summary: string;
  teacherQuote: string;
  audioClipUrl?: string;
}

/**
 * 家长日报
 */
export interface ParentDailyReport {
  date: string;
  studentName: string;
  totalLessons: number;
  totalBreakpoints: number;
  unresolvedBreakpoints: number;
  confusionPoints: ConfusionPoint[];
  actionScript: string;
  estimatedMinutes: number;
  completionStatus: Array<{
    taskId: string;
    title: string;
    completed: boolean;
  }>;
}

// ==================== 教师端 ====================

/**
 * 困惑热区
 */
export interface ConfusionHotspot {
  startMs: number;
  endMs: number;
  count: number;
  anchors: Anchor[];
}

/**
 * 教师日报
 */
export interface TeacherDailyReport {
  date: string;
  className: string;
  subject: string;
  totalStudents: number;
  studentsWithConfusion: number;
  hotspots: ConfusionHotspot[];
  aiReflection: string;
  suggestions: string[];
}

// ==================== 搜索相关 ====================

/**
 * 搜索结果
 */
export interface SearchResult {
  id: string;
  content: string;
  score: number;
  source: string;
  metadata?: {
    timestamp?: number;
    sourceId?: string;
    type?: string;
  };
}

// ==================== AI 精选片段 (Highlight Reels) ====================

/**
 * 主题生成模式
 */
export type TopicGenerationMode = 'smart' | 'fast';

/**
 * 重要程度
 */
export type ImportanceLevel = 'high' | 'medium' | 'low';

/**
 * 精选片段时间范围
 */
export interface HighlightSegment {
  start: number;           // 开始时间（毫秒）
  end: number;             // 结束时间（毫秒）
  text: string;            // 原文内容
  startSegmentIdx?: number;
  endSegmentIdx?: number;
  startCharOffset?: number;
  endCharOffset?: number;
  confidence?: number;     // 匹配置信度 (0-1)
}

/**
 * 精选片段引用
 */
export interface HighlightQuote {
  timestamp: string;       // [MM:SS-MM:SS] 格式
  text: string;            // 原文引用
}

/**
 * AI 精选片段（Highlight Reel）
 */
export interface HighlightTopic {
  id: string;
  sessionId: string;
  title: string;           // 标题（最多10词）
  description?: string;    // 内容摘要
  importance: ImportanceLevel;
  duration: number;        // 片段时长（毫秒）
  segments: HighlightSegment[];
  keywords?: string[];
  quote?: HighlightQuote;
  createdAt: string;
  updatedAt: string;
}

/**
 * 主题候选项（用于 Fast 模式的中间结果）
 */
export interface TopicCandidate {
  key: string;
  title: string;
  quote: HighlightQuote;
}

// ==================== 结构化摘要 (Summary) ====================

/**
 * 摘要要点
 */
export interface SummaryTakeaway {
  label: string;           // 标题（最多10词）
  insight: string;         // 洞察（1-2句）
  timestamps: string[];    // 时间戳（1-2个）
}

/**
 * 课堂结构化摘要
 */
export interface ClassSummary {
  id: string;
  sessionId: string;
  overview: string;        // 课堂概要
  takeaways: SummaryTakeaway[];  // 主要知识点
  keyDifficulties: string[];     // 重点难点
  structure: string[];           // 课堂结构
  createdAt: string;
  updatedAt: string;
}

// ==================== 个人笔记系统 ====================

/**
 * 笔记来源类型
 */
export type NoteSource = 'chat' | 'takeaways' | 'transcript' | 'custom';

/**
 * 笔记元数据
 */
export interface NoteMetadata {
  transcript?: {
    start: number;         // 开始时间（毫秒）
    end?: number;          // 结束时间（毫秒）
    segmentIndex?: number;
    topicId?: string;
  };
  chat?: {
    messageId: string;
    role: 'user' | 'assistant';
    timestamp?: string;
  };
  selectedText?: string;   // 选中的原文
  selectionContext?: string;
  timestampLabel?: string;
  extra?: Record<string, unknown>;
}

/**
 * 个人笔记
 */
export interface Note {
  id: string;
  sessionId: string;
  studentId: string;
  source: NoteSource;
  sourceId?: string;       // 来源 ID（如消息 ID、片段 ID）
  text: string;            // 笔记内容
  metadata?: NoteMetadata;
  createdAt: string;
  updatedAt: string;
}

/**
 * 带会话信息的笔记（用于跨课程笔记管理）
 */
export interface NoteWithSession extends Note {
  session: {
    sessionId: string;
    subject?: string;
    topic?: string;
    date: string;
  } | null;
}

// ==================== 工具函数 ====================

/**
 * Anchor 转 Breakpoint（兼容旧代码）
 */
export function anchorToBreakpoint(anchor: Anchor): Breakpoint {
  return {
    id: anchor.id,
    lessonId: anchor.sessionId,
    studentId: anchor.studentId,
    timestamp: anchor.timestamp,
    type: anchor.type,
    resolved: anchor.resolved,
    createdAt: anchor.createdAt,
  };
}

/**
 * Breakpoint 转 Anchor
 */
export function breakpointToAnchor(bp: Breakpoint): Anchor {
  return {
    id: bp.id,
    sessionId: bp.lessonId,
    studentId: bp.studentId,
    timestamp: bp.timestamp,
    type: bp.type,
    cancelled: false,
    resolved: bp.resolved,
    createdAt: bp.createdAt,
  };
}
