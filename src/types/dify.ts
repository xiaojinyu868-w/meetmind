/**
 * Dify 集成类型定义
 * 
 * 用于前后端交互的 JSON Schema
 */

// ==================== 请求类型 ====================

/**
 * 扩展的 Tutor API 请求
 * 在原有字段基础上新增可选字段
 */
export interface ExtendedTutorRequest {
  // ===== 原有字段（保持不变）=====
  timestamp: number;
  segments: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
  }>;
  model?: string;
  studentQuestion?: string;

  // ===== 新增字段（可选，向后兼容）=====
  /** 启用引导问题功能 */
  enable_guidance?: boolean;
  /** 启用联网检索功能 */
  enable_web?: boolean;
  /** 学生选择的引导选项 ID */
  selected_option_id?: string;
  /** Dify 会话 ID（多轮对话） */
  conversation_id?: string;
}

// ==================== 响应类型 ====================

/**
 * 引导问题选项
 */
export interface GuidanceOption {
  /** 选项 ID */
  id: string;
  /** 选项文本 */
  text: string;
  /** 选项分类（用于后续分流） */
  category: 'concept' | 'procedure' | 'calculation' | 'comprehension' | 'application';
}

/**
 * 引导问题
 */
export interface GuidanceQuestion {
  /** 问题 ID */
  id: string;
  /** 问题文本 */
  question: string;
  /** 问题类型（目前只支持单选） */
  type: 'single_choice';
  /** 选项列表（2-4 个） */
  options: GuidanceOption[];
  /** 提示文案（可选） */
  hint?: string;
}

/**
 * 引用来源
 */
export interface Citation {
  /** 引用 ID */
  id: string;
  /** 标题 */
  title: string;
  /** URL */
  url: string;
  /** 摘要片段 */
  snippet: string;
  /** 来源类型 */
  source_type: 'web' | 'knowledge_base' | 'transcript';
}

/**
 * 扩展的 Tutor API 响应
 * 在原有字段基础上新增可选字段
 */
export interface ExtendedTutorResponse {
  // ===== 原有字段（保持不变）=====
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
  actionItems: Array<{
    id: string;
    type: 'replay' | 'exercise' | 'review';
    title: string;
    description: string;
    estimatedMinutes: number;
    completed: boolean;
  }>;
  rawContent: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };

  // ===== 新增字段（可选，向后兼容）=====
  /** 引导问题（enable_guidance=true 时返回） */
  guidance_question?: GuidanceQuestion;
  /** 针对选项的补充解释 */
  option_followup?: string;
  /** 引用来源（enable_web=true 时返回） */
  citations?: Citation[];
  /** Dify 会话 ID */
  conversation_id?: string;
}

// ==================== JSON Schema（供文档/验证使用）====================

/**
 * GuidanceQuestion JSON Schema
 * 
 * ```json
 * {
 *   "$schema": "http://json-schema.org/draft-07/schema#",
 *   "type": "object",
 *   "required": ["id", "question", "type", "options"],
 *   "properties": {
 *     "id": { "type": "string" },
 *     "question": { "type": "string" },
 *     "type": { "enum": ["single_choice"] },
 *     "options": {
 *       "type": "array",
 *       "minItems": 2,
 *       "maxItems": 4,
 *       "items": {
 *         "type": "object",
 *         "required": ["id", "text", "category"],
 *         "properties": {
 *           "id": { "type": "string" },
 *           "text": { "type": "string" },
 *           "category": {
 *             "enum": ["concept", "procedure", "calculation", "comprehension", "application"]
 *           }
 *         }
 *       }
 *     },
 *     "hint": { "type": "string" }
 *   }
 * }
 * ```
 */
export const GUIDANCE_QUESTION_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['id', 'question', 'type', 'options'],
  properties: {
    id: { type: 'string' },
    question: { type: 'string' },
    type: { enum: ['single_choice'] },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        required: ['id', 'text', 'category'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          category: {
            enum: ['concept', 'procedure', 'calculation', 'comprehension', 'application'],
          },
        },
      },
    },
    hint: { type: 'string' },
  },
} as const;

/**
 * Citation JSON Schema
 */
export const CITATION_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['id', 'title', 'url', 'snippet', 'source_type'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    url: { type: 'string', format: 'uri' },
    snippet: { type: 'string' },
    source_type: { enum: ['web', 'knowledge_base', 'transcript'] },
  },
} as const;
