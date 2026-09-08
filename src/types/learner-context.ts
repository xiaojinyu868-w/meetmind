/**
 * LearnerContext — 「这个学习者」的读契约（renewal plan §6 的读侧）。
 *
 * 写侧是 LearningEvent（learning-event.ts：对话 / activity / assessment 三种载荷，带 v / appId / 幂等键），
 * 由外部 context 系统消费；读侧就是这里：每个 Application 在执行前声明「为完成这个任务我需要知道这个学习者的什么」
 * （LearnerContextRequest），拿回一个可直接进 prompt 的切片（LearnerContext）+ 可溯源的证据 id。
 *
 * 与既有两样东西的关系：
 *   - MemoryLayerSnapshot 是「这节课」的摘要 / 难点 / 术语——场景上下文，继续用；
 *   - learnerProfile 文本是「这个人」的画像散文，只有 Tutor prompt 读它——它会被这份结构化切片取代，迁移期并存。
 *
 * 供给方三种，形状相同（LearnerContext.source 标明），resolveLearnerContext 按顺序取：
 *   - remote：外部 context 系统（CONTEXT_SYSTEM_URL），由服务端按 learnerId 取；
 *   - server：本仓库服务端从 LearningEvent 表（assessment 事件）+ 用户画像（记忆 / 最近现场）聚成——登录用户换设备也在；
 *     这是外部系统合并前的参考实现，对外也以同一契约暴露在 POST /api/context/v1/learner-context；
 *   - local：访客 / 离线时，客户端从本机会话层结果（review-session-outcomes）、最近学习现场与长期理解拼出同一形状随请求带上。
 *   所以今天就有真实数据在这条槽里流，接上外部系统只是换供给方。
 *
 * 契约原则：只放事实与状态（还没稳 / 刚记住 / 已经稳了），不放推断出的学习风格；每条尽量带 evidenceIds。
 * 版本字段 v 与 LearningEvent 对齐，形状变更必须升 v 并保留旧分支。
 */

export const LEARNER_CONTEXT_VERSION = 1 as const;

export type LearnerContextNeed = 'mastery' | 'recent' | 'challenges' | 'topics' | 'preferences' | 'goals';

export interface LearnerContextRequest {
  v: typeof LEARNER_CONTEXT_VERSION;
  /** 发起读取的 Application（catalog appKey，或 'tutor' / 'classroom-companion'） */
  appId: string;
  /** 登录用户 User.id；访客没有 */
  learnerId?: string;
  /** 访客 / 登录后合并用的设备标识 */
  deviceId?: string;
  /** 当前课堂；供给方可据此把"本课相关"的概念排前面 */
  sessionId?: string;
  /** 本课涉及的概念 / 术语（可选），供给方用来取相关的掌握轨迹 */
  concepts?: string[];
  /** 这次任务需要哪几类；供给方只填这些 */
  need: LearnerContextNeed[];
  /** 每类最多几条（默认 8） */
  limit?: number;
}

export type LearnerMasteryStatus = 'unstable' | 'improving' | 'stable';

export interface LearnerConceptState {
  concept: string;
  status: LearnerMasteryStatus;
  /** ISO 时间：最近一次检验 */
  lastAt: string;
  /** 事实序列（测验 ✕ → 闪卡 ✓），最旧在前 */
  steps?: Array<{ appId: string; positive: boolean; at: string }>;
  /** 回到原话的证据（课堂时间点） */
  evidence?: { sessionId?: string; startMs: number; endMs?: number };
  evidenceIds?: string[];
}

export interface LearnerRecentLesson {
  title: string;
  /** ISO 时间 */
  at: string;
  sessionId?: string;
}

export interface LearnerNote {
  title: string;
  detail?: string;
  evidenceIds?: string[];
}

export interface LearnerContext {
  v: typeof LEARNER_CONTEXT_VERSION;
  /** ISO 时间：切片生成时刻 */
  generatedAt: string;
  source: 'local' | 'server' | 'remote';
  learnerId?: string;
  /** 概念掌握状态；还没稳的排最前 */
  mastery: LearnerConceptState[];
  /** 最近学过的课（最新在前） */
  recentLessons: LearnerRecentLesson[];
  /** 还没过去的困惑（长期理解里 kind=challenge 且 active） */
  challenges: LearnerNote[];
  /** 在学的主题 */
  topics: string[];
  /** 学习偏好（用户确认过的） */
  preferences: string[];
  /** 正在靠近的目标 */
  goals: string[];
  /** 全部可溯源证据 id（LearningEvent id / memory id） */
  evidenceIds: string[];
}

export function emptyLearnerContext(source: LearnerContext['source'] = 'local', learnerId?: string): LearnerContext {
  return {
    v: LEARNER_CONTEXT_VERSION,
    generatedAt: new Date().toISOString(),
    source,
    learnerId,
    mastery: [],
    recentLessons: [],
    challenges: [],
    topics: [],
    preferences: [],
    goals: [],
    evidenceIds: [],
  };
}

export function isLearnerContextEmpty(context: LearnerContext | null | undefined): boolean {
  if (!context) return true;
  return context.mastery.length === 0
    && context.recentLessons.length === 0
    && context.challenges.length === 0
    && context.topics.length === 0
    && context.preferences.length === 0
    && context.goals.length === 0;
}
