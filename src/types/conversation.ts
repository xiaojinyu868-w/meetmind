/**
 * 对话历史模块类型定义
 * 
 * 用于 AITutor 和 AIChat 组件的统一对话历史存储
 */

// ==================== 对话类型 ====================

/**
 * 对话来源类型
 */
export type ConversationType = 'tutor' | 'chat';

/**
 * 消息角色
 */
export type MessageRole = 'user' | 'assistant' | 'system';

// ==================== 对话历史记录 ====================

/**
 * 对话历史记录（对话会话元数据）
 */
export interface ConversationHistory {
  id?: number;                           // IndexedDB 自增主键
  conversationId: string;                // UUID，唯一标识
  userId: string;                        // 用户 ID，用于数据隔离
  type: ConversationType;                // 对话类型
  title: string;                         // 对话标题
  sessionId?: string;                    // 关联的音频会话 ID
  anchorId?: string;                     // 关联的困惑点 ID（tutor 类型）
  anchorTimestamp?: number;              // 困惑点时间戳（毫秒）
  messageCount: number;                  // 消息数量
  lastMessage?: string;                  // 最后一条消息预览
  model?: string;                        // 使用的 AI 模型
  metadata?: Record<string, unknown>;    // 扩展元数据
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 消息附件
 */
export interface MessageAttachment {
  type: 'image' | 'file';
  url: string;                           // Data URL 或文件路径
  name?: string;
  size?: number;
}

/**
 * 对话消息
 */
export interface ConversationMessage {
  id?: number;                           // IndexedDB 自增主键
  messageId: string;                     // UUID，唯一标识
  conversationId: string;                // 关联对话 ID
  role: MessageRole;
  content: string;
  attachments?: MessageAttachment[];     // 多模态附件
  createdAt: Date;
}

// ==================== 服务层参数类型 ====================

/**
 * 创建对话参数
 */
export interface CreateConversationParams {
  userId: string;
  type: ConversationType;
  title?: string;
  sessionId?: string;
  anchorId?: string;
  anchorTimestamp?: number;
  model?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 添加消息参数
 */
export interface AddMessageParams {
  role: MessageRole;
  content: string;
  attachments?: MessageAttachment[];
}

/**
 * 查询对话列表参数
 */
export interface ListConversationsParams {
  type?: ConversationType;
  sessionId?: string;
  limit?: number;
  offset?: number;
}

/**
 * 搜索对话参数
 */
export interface SearchConversationsParams {
  keyword: string;
  type?: ConversationType;
  limit?: number;
}

// ==================== Hook 返回类型 ====================

/**
 * 对话历史 Hook 状态
 */
export interface ConversationHistoryState {
  conversations: ConversationHistory[];
  currentConversation: ConversationHistory | null;
  messages: ConversationMessage[];
  isLoading: boolean;
  error: string | null;
}

/**
 * 对话历史 Hook 操作
 */
export interface ConversationHistoryActions {
  loadConversations: (params?: ListConversationsParams) => Promise<void>;
  createConversation: (params: CreateConversationParams) => Promise<ConversationHistory>;
  selectConversation: (conversationId: string) => Promise<void>;
  addMessage: (params: AddMessageParams) => Promise<ConversationMessage>;
  deleteConversation: (conversationId: string) => Promise<void>;
  searchConversations: (params: SearchConversationsParams) => Promise<ConversationHistory[]>;
  clearCurrentConversation: () => void;
}

/**
 * 对话历史 Hook 完整返回类型
 */
export type UseConversationHistoryReturn = ConversationHistoryState & ConversationHistoryActions;
