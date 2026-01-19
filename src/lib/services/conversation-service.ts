/**
 * 对话历史服务
 * 
 * 提供对话历史的完整 CRUD 操作，支持 AITutor 和 AIChat 组件的统一存储
 */

import {
  db,
  createConversationHistory,
  getConversationById,
  getConversationByAnchorId,
  getUserConversations,
  searchUserConversations,
  updateConversationHistory,
  deleteConversationHistory,
  addConversationMessage,
  addConversationMessages,
  getConversationMessages,
  getConversationMessageCount,
  type ConversationHistoryRecord,
  type ConversationMessageRecord,
} from '@/lib/db';
import type {
  ConversationHistory,
  ConversationMessage,
  ConversationType,
  MessageRole,
  CreateConversationParams,
  AddMessageParams,
  ListConversationsParams,
  SearchConversationsParams,
  MessageAttachment,
} from '@/types/conversation';

// ==================== 类型转换 ====================

/**
 * 数据库记录转换为应用层类型
 */
function recordToHistory(record: ConversationHistoryRecord): ConversationHistory {
  return {
    id: record.id,
    conversationId: record.conversationId,
    userId: record.userId,
    type: record.type,
    title: record.title,
    sessionId: record.sessionId,
    anchorId: record.anchorId,
    anchorTimestamp: record.anchorTimestamp,
    messageCount: record.messageCount,
    lastMessage: record.lastMessage,
    model: record.model,
    metadata: record.metadata ? JSON.parse(record.metadata) : undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * 数据库消息记录转换为应用层类型
 */
function recordToMessage(record: ConversationMessageRecord): ConversationMessage {
  return {
    id: record.id,
    messageId: record.messageId,
    conversationId: record.conversationId,
    role: record.role,
    content: record.content,
    attachments: record.attachments ? JSON.parse(record.attachments) : undefined,
    createdAt: record.createdAt,
  };
}

// ==================== 匿名用户 ID ====================

const ANONYMOUS_USER_ID = 'anonymous';

/**
 * 获取有效用户 ID（未登录时使用匿名标识）
 */
export function getEffectiveUserId(userId?: string | null): string {
  return userId || ANONYMOUS_USER_ID;
}

// ==================== 服务接口 ====================

export const conversationService = {
  /**
   * 创建新对话
   */
  async createConversation(params: CreateConversationParams): Promise<ConversationHistory> {
    const conversationId = crypto.randomUUID();
    const now = new Date();
    
    const record: Omit<ConversationHistoryRecord, 'id' | 'createdAt' | 'updatedAt'> = {
      conversationId,
      userId: getEffectiveUserId(params.userId),
      type: params.type,
      title: params.title || this.generateDefaultTitle(params.type),
      sessionId: params.sessionId,
      anchorId: params.anchorId,
      anchorTimestamp: params.anchorTimestamp,
      messageCount: 0,
      model: params.model,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    };
    
    await createConversationHistory(record);
    
    return {
      ...record,
      conversationId,
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
    };
  },

  /**
   * 获取或创建对话（用于继续对话场景）
   */
  async getOrCreateConversation(params: CreateConversationParams): Promise<ConversationHistory> {
    // 对于 tutor 类型，先尝试通过 anchorId 查找
    if (params.type === 'tutor' && params.anchorId) {
      const existing = await getConversationByAnchorId(params.anchorId);
      if (existing) {
        return recordToHistory(existing);
      }
    }
    
    // 创建新对话
    return this.createConversation(params);
  },

  /**
   * 根据 ID 获取对话
   */
  async getConversation(conversationId: string): Promise<ConversationHistory | null> {
    const record = await getConversationById(conversationId);
    return record ? recordToHistory(record) : null;
  },

  /**
   * 根据困惑点 ID 获取对话（tutor 类型）
   */
  async getConversationByAnchor(anchorId: string): Promise<ConversationHistory | null> {
    const record = await getConversationByAnchorId(anchorId);
    return record ? recordToHistory(record) : null;
  },

  /**
   * 获取用户对话列表
   */
  async listConversations(
    userId: string,
    params?: ListConversationsParams
  ): Promise<ConversationHistory[]> {
    const records = await getUserConversations(getEffectiveUserId(userId), {
      type: params?.type,
      sessionId: params?.sessionId,
      limit: params?.limit,
      offset: params?.offset,
    });
    return records.map(recordToHistory);
  },

  /**
   * 搜索用户对话
   */
  async searchConversations(
    userId: string,
    params: SearchConversationsParams
  ): Promise<ConversationHistory[]> {
    const records = await searchUserConversations(getEffectiveUserId(userId), params.keyword, {
      type: params.type,
      limit: params.limit,
    });
    return records.map(recordToHistory);
  },

  /**
   * 添加消息
   */
  async addMessage(
    conversationId: string,
    params: AddMessageParams
  ): Promise<ConversationMessage> {
    const messageId = crypto.randomUUID();
    const now = new Date();
    
    const record: Omit<ConversationMessageRecord, 'id' | 'createdAt'> = {
      messageId,
      conversationId,
      role: params.role,
      content: params.content,
      attachments: params.attachments ? JSON.stringify(params.attachments) : undefined,
    };
    
    await addConversationMessage(record);
    
    // 更新对话元数据
    const messageCount = await getConversationMessageCount(conversationId);
    await updateConversationHistory(conversationId, {
      messageCount,
      lastMessage: params.content.slice(0, 100), // 截取前 100 字符作为预览
    });
    
    return {
      ...record,
      messageId,
      attachments: params.attachments,
      createdAt: now,
    };
  },

  /**
   * 批量添加消息（用于恢复对话历史）
   */
  async addMessages(
    conversationId: string,
    messages: AddMessageParams[]
  ): Promise<ConversationMessage[]> {
    if (messages.length === 0) return [];
    
    const now = new Date();
    const records = messages.map(m => ({
      messageId: crypto.randomUUID(),
      conversationId,
      role: m.role,
      content: m.content,
      attachments: m.attachments ? JSON.stringify(m.attachments) : undefined,
    }));
    
    await addConversationMessages(records);
    
    // 更新对话元数据
    const messageCount = await getConversationMessageCount(conversationId);
    const lastMessage = messages[messages.length - 1];
    await updateConversationHistory(conversationId, {
      messageCount,
      lastMessage: lastMessage.content.slice(0, 100),
    });
    
    return records.map((r, i) => ({
      id: undefined,
      messageId: r.messageId,
      conversationId: r.conversationId,
      role: r.role as MessageRole,
      content: r.content,
      attachments: messages[i].attachments,
      createdAt: now,
    }));
  },

  /**
   * 获取对话消息列表
   */
  async getMessages(conversationId: string): Promise<ConversationMessage[]> {
    const records = await getConversationMessages(conversationId);
    return records.map(recordToMessage);
  },

  /**
   * 更新对话信息
   */
  async updateConversation(
    conversationId: string,
    updates: {
      title?: string;
      model?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const updateData: Parameters<typeof updateConversationHistory>[1] = {};
    
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.model !== undefined) updateData.model = updates.model;
    if (updates.metadata !== undefined) updateData.metadata = JSON.stringify(updates.metadata);
    
    await updateConversationHistory(conversationId, updateData);
  },

  /**
   * 删除对话（包括所有消息）
   */
  async deleteConversation(conversationId: string): Promise<void> {
    await deleteConversationHistory(conversationId);
  },

  /**
   * 生成默认对话标题
   */
  generateDefaultTitle(type: ConversationType): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return type === 'tutor' ? `困惑点辅导 ${dateStr}` : `AI 对话 ${dateStr}`;
  },

  /**
   * 从首条消息生成标题
   */
  generateTitleFromMessage(content: string, maxLength: number = 30): string {
    // 移除换行和多余空格
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength - 3) + '...';
  },
};

export default conversationService;
