import { LLMConfig } from '@/lib/config/app.config';
import type { GuidanceQuestion as GuidanceQuestionType, Citation } from '@/types/dify';

// 直接从配置层取模型注册表，避免经 llm-service 把服务端依赖（prisma 计量等）拉进客户端 bundle
const AVAILABLE_MODELS = LLMConfig.models;
const DEFAULT_WORKSHOP_MODEL_ID = LLMConfig.workshopModel;

// 持久化状态的 key
export const TUTOR_STATE_KEY = 'tutor_last_state';
export const REALTIME_TEACHER_MODEL_ID = 'qwen3.5-omni-plus';
export const IS_REALTIME_TEACHER_AVAILABLE = AVAILABLE_MODELS.some((model) => model.id === REALTIME_TEACHER_MODEL_ID);
export const FIXED_TUTOR_MODEL_ID = DEFAULT_WORKSHOP_MODEL_ID;
// label 从注册表动态取当前模型展示名，避免写死的字符串与实际模型不符（历史上误标成 'QWEN 3.6'）。
export const FIXED_TUTOR_MODEL_LABEL =
  AVAILABLE_MODELS.find((model) => model.id === FIXED_TUTOR_MODEL_ID)?.name || FIXED_TUTOR_MODEL_ID;

export interface Segment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface ActionItem {
  id: string;
  type: 'replay' | 'exercise' | 'review';
  title: string;
  description: string;
  estimatedMinutes: number;
  completed: boolean;
}

export interface TutorLaunchImage {
  id: string;
  name: string;
  url: string;
  previewUrl?: string;
}

export interface TutorMessageImage {
  id: string;
  name: string;
  previewUrl: string;
}

export interface AITutorProps {
  breakpoint: import('@/lib/services/meetmind-service').Breakpoint | null;
  segments: Segment[];
  isLoading: boolean;
  onResolve: () => void;
  onActionItemsUpdate?: (items: ActionItem[], sourceAnchorId?: string) => void;
  sessionId?: string;  // 用于缓存关联
  /** 当前材料标题，仅用于内容适配与场景理解，不替代真实原文。 */
  lessonTitle?: string;
  onSeek?: (timeMs: number) => void;  // 点击时间戳跳转播放
  initialQuestion?: string;  // 移动端传入的初始问题
  isMobile?: boolean;  // 移动端模式，使用简化布局
  supportContextText?: string;
  initialQuestionNonce?: number;
  onInitialQuestionConsumed?: () => void;
  preferSupportContext?: boolean;
  launchQuestion?: string;
  launchQuestionNonce?: number;
  launchDisplayText?: string;
  launchImages?: TutorLaunchImage[];
  onLaunchQuestionConsumed?: () => void;
  hideMobileHeader?: boolean;
  realtimeTeacherEnabled?: boolean;
  onRealtimeTeacherEnabledChange?: (enabled: boolean) => void;
  /** 语音同桌转写已落到历史时通知外层，让文字 agent 能接回。 */
  onRealtimeConversationSaved?: (conversationId: string) => void;
  /** 递增此值触发全局对话清空（开新对话） */
  newConversationNonce?: number;
  /** 当全局对话内容有/无变化时通知外层 */
  onConversationActiveChange?: (hasMessages: boolean) => void;
  /** 从历史列表点进来的指定对话（M10 agent 路径消费；老路径忽略）。 */
  selectedConversationId?: string | null;
  selectedConversationTitle?: string | null;
  /** 打开当前课程历史列表。 */
  onShowHistory?: () => void;
  /** agent 路径内点击开新对话后通知外层清掉历史选择。 */
  onAgentNewConversation?: () => void;
  /**
   * M10：当前视频/音频播放位置（秒）。
   * 复习态的 AI 同桌会把这个值注入 system prompt 的 fullTranscript 锚点，
   * 让 LLM 优先回答"此刻在听的那段"——即使没时间戳也能对齐。
   * 老 AITutor SSE 路径不消费这个字段（无害）。
   */
  currentTimeSec?: number;
  /** 复习态结构化应用应在中间学习工作区打开，而不是塞进聊天气泡。 */
  onOpenAppInWorkspace?: (appKey: import('@/lib/ai-native/app-catalog').WorkshopAppKey) => void;
  /** 当前课后学习黑板快照，供同桌理解中间应用、测验/闪卡进度和最近学习动态。 */
  learningActivityContext?: string;
}

export interface TutorCacheEnvelopeV1 {
  version: 1;
  model: string;
  transcriptSignature: string;
  response: TutorAPIResponse;
}

export interface TutorAPIResponse {
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
  guidance_question?: GuidanceQuestionType;
  citations?: Citation[];
  conversation_id?: string;
  // 摘要相关字段
  summary_generated?: boolean;
  cached_summary?: {
    overview: string;
    takeaways: string;
    keyDifficulties: string[];
  };
}

export interface TutorChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  images?: TutorMessageImage[];
}
