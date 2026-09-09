/**
 * 学习记忆事件契约（P0 事件化）。
 *
 * 事件表（prisma `LearningEvent`）是学习者画像的唯一写入口：
 * 写入方只发事件，蒸馏与合并由服务端 learning-event-service 完成，
 * `learnerProfileJson` 只是物化视图。事件全量留史，可回放重建画像。
 *
 * 约束：本文件纯类型，零运行时依赖（见 types/DOMAIN.md）。
 */

import type { LearningMemoryKind, LearningThreadEntry } from './user';

/** 事件类型注册表。新增类型必须先在这里登记，再在 learning-event-service 里实现处理。 */
export type LearningEventType =
  /** 用户在互动中表现出的困惑（证据约束，由蒸馏模型最终判断是否形成长期理解） */
  | 'confusion'
  /** 用户独立答对 / 讲清楚了一个知识点 */
  | 'mastery'
  /** 用户答错或给出了错误理解 */
  | 'error'
  /** 用户明确表达的学习方式偏好 */
  | 'preference'
  /** 可核验的学习进展（完成 checkpoint / 通过测验等） */
  | 'progress'
  /** 客观学习活动（课后理解完成、应用产物等），只进最近学习现场，不升级为长期理解 */
  | 'activity'
  /**
   * 应用内的结构化检验结果（测验作答 / 闪卡打分 / 讲给同桌听评估）：按「概念 × 结果 × 课堂证据」
   * 逐项留史。这是应用矩阵回流到共享记忆的原始材料——物化成「掌握轨迹」（按概念聚合、保留
   * 时间序列而非覆盖）在读侧（应用消费记忆）一起设计；事件先全量留史，可回放重建。
   */
  | 'assessment'
  /**
   * 用户本人维护画像（2026-09-09）：改 / 忘掉 / 添加 / 确认一条长期理解，设置或结束学习线索。
   * 画像是用户自己的东西，编辑走事件而不是直接 PATCH 物化视图——同一条串行队列里合并，
   * 不会和服务端蒸馏互相覆盖；事件留史，谁改过什么可回放。
   */
  | 'curation';

/**
 * 对话类事件（confusion/mastery/error/preference/progress）的载荷。
 * 服务端据此蒸馏（learning-memory-distillation-service）并合并进长期学习理解。
 */
export interface LearningConversationPayload {
  /** 载荷版本，破坏性变更时 +1，回放/迁移按版本解释 */
  v: 1;
  userText: string;
  assistantText: string;
}

/** activity 事件的载荷：一条客观学习活动，合并进 `recentLearningActivities`。 */
export interface LearningActivityPayload {
  v: 1;
  kind: 'conversation' | 'lesson' | 'app' | 'capture';
  title: string;
  detail?: string;
  sessionId?: string;
  appKey?: string;
}

/**
 * 单条检验结果。outcome 沿用各应用自己的判定词表，不在这里抹平——
 * 测验：correct / wrong；闪卡：got / missed；讲给同桌听：mastery / productive-struggle / aware-gap / blind-spot / uncovered。
 * 物化层再决定它们如何映射到「稳 / 不稳」。
 */
export type LearningAssessmentOutcome =
  | 'correct'
  | 'wrong'
  | 'got'
  | 'missed'
  | 'mastery'
  | 'productive-struggle'
  | 'aware-gap'
  | 'blind-spot'
  | 'uncovered';

export interface LearningAssessmentItem {
  /** 被检验的概念 / 知识点（测验用题面、闪卡用正面、讲给同桌听用目标点） */
  concept: string;
  outcome: LearningAssessmentOutcome;
  /** 课堂证据（毫秒），有则回锚到原话 */
  evidence?: { startMs: number; endMs?: number };
}

/** assessment 事件的载荷：一次应用交互的完整结果。 */
export interface LearningAssessmentPayload {
  v: 1;
  /** WorkshopAppKey（quiz / flashcards / teach-back …） */
  appKey: string;
  sessionId?: string;
  /** 课堂标题快照，便于回放时不查库就能读懂 */
  lessonTitle?: string;
  items: LearningAssessmentItem[];
}

/** 应用窗口交给 hook 的草稿：只有 appKey + items，sessionId / lessonTitle / v 由 hook 补齐。 */
export type LearningAssessmentDraft = Pick<LearningAssessmentPayload, 'appKey' | 'items'>;

/** curation 事件的载荷：用户对自己画像的一次编辑。 */
export interface LearningCurationPayload {
  v: 1;
  op: 'add' | 'update' | 'remove' | 'confirm' | 'set-thread';
  /** add：新增一条（source 固定为 user） */
  memory?: { kind: LearningMemoryKind; title: string; detail?: string };
  /** update / remove / confirm：目标条目 */
  memoryId?: string;
  /** update：改标题 / 类型 / 停用 */
  patch?: { kind?: LearningMemoryKind; title?: string; detail?: string; status?: 'active' | 'paused' };
  /** set-thread：null = 结束当前线索 */
  thread?: LearningThreadEntry | null;
}

export type LearningEventPayload = LearningConversationPayload | LearningActivityPayload | LearningAssessmentPayload | LearningCurationPayload;

/** Optional original evidence for the new Context adapter; never a mastery verdict. */
export interface LearningObservationContent {
  type: string;
  content: string;
  locator?: string;
}

/** `POST /api/memory/events` 的请求体（zod 校验在 route / service 层，这里只给契约）。 */
export interface LearningEventInput {
  /** 来源应用：global-ask | classroom | wechat | teach... */
  appId: string;
  type: LearningEventType;
  payload: LearningEventPayload;
  /** 业务对象ID（conversationId / captureId...），用于溯源 */
  sourceId?: string;
  /** 幂等键：撞 unique 静默返回已有事件。客户端约定 `global-understanding:${sourceId}` */
  idempotencyKey?: string;
  /** 事件发生时间（ISO 8601）；缺省由服务端取当前时间 */
  occurredAt?: string;
  /** Full observation for Context; legacy processing continues to use payload. */
  observation?: LearningObservationContent;
}
