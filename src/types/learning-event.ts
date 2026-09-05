/**
 * 学习记忆事件契约（P0 事件化）。
 *
 * 事件表（prisma `LearningEvent`）是学习者画像的唯一写入口：
 * 写入方只发事件，蒸馏与合并由服务端 learning-event-service 完成，
 * `learnerProfileJson` 只是物化视图。事件全量留史，可回放重建画像。
 *
 * 约束：本文件纯类型，零运行时依赖（见 types/DOMAIN.md）。
 */

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
  | 'activity';

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

export type LearningEventPayload = LearningConversationPayload | LearningActivityPayload;

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
}
