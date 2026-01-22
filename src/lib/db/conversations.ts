/**
 * 对话历史 (ConversationHistory + Messages) 数据库操作
 * Owner: AI家教模块开发者
 */

import { db, type ConversationHistoryRecord, type ConversationMessageRecord } from './schema';

// ============ 对话历史操作 ============

/** 创建对话历史 */
export async function createConversationHistory(
  conversation: Omit<ConversationHistoryRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<number> {
  const now = new Date();
  return db.conversationHistory.add({
    ...conversation,
    createdAt: now,
    updatedAt: now
  });
}

/** 根据 conversationId 获取对话历史 */
export async function getConversationById(conversationId: string): Promise<ConversationHistoryRecord | undefined> {
  return db.conversationHistory
    .where('conversationId')
    .equals(conversationId)
    .first();
}

/** 根据 anchorId 获取对话历史（tutor 类型） */
export async function getConversationByAnchorId(anchorId: string): Promise<ConversationHistoryRecord | undefined> {
  return db.conversationHistory
    .where('anchorId')
    .equals(anchorId)
    .first();
}

/** 获取用户的对话历史列表 */
export async function getUserConversations(
  userId: string,
  options: { type?: 'tutor' | 'chat'; sessionId?: string; limit?: number; offset?: number } = {}
): Promise<ConversationHistoryRecord[]> {
  let collection;
  
  if (options.type) {
    collection = db.conversationHistory
      .where('[userId+type]')
      .equals([userId, options.type]);
  } else {
    collection = db.conversationHistory
      .where('userId')
      .equals(userId);
  }
  
  let results = await collection.reverse().sortBy('updatedAt');
  
  // 按 sessionId 过滤
  if (options.sessionId) {
    results = results.filter(r => r.sessionId === options.sessionId);
  }
  
  // 分页
  if (options.offset) {
    results = results.slice(options.offset);
  }
  if (options.limit) {
    results = results.slice(0, options.limit);
  }
  
  return results;
}

/** 搜索用户对话历史 */
export async function searchUserConversations(
  userId: string,
  keyword: string,
  options: { type?: 'tutor' | 'chat'; limit?: number } = {}
): Promise<ConversationHistoryRecord[]> {
  const lowerKeyword = keyword.toLowerCase();
  
  let collection;
  if (options.type) {
    collection = db.conversationHistory
      .where('[userId+type]')
      .equals([userId, options.type]);
  } else {
    collection = db.conversationHistory
      .where('userId')
      .equals(userId);
  }
  
  const all = await collection.toArray();
  
  // 在标题和最后消息中搜索
  let results = all.filter(c => 
    c.title.toLowerCase().includes(lowerKeyword) ||
    (c.lastMessage && c.lastMessage.toLowerCase().includes(lowerKeyword))
  );
  
  // 按更新时间降序
  results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  
  if (options.limit) {
    results = results.slice(0, options.limit);
  }
  
  return results;
}

/** 更新对话历史 */
export async function updateConversationHistory(
  conversationId: string,
  updates: Partial<Omit<ConversationHistoryRecord, 'id' | 'conversationId' | 'userId' | 'createdAt'>>
): Promise<number> {
  return db.conversationHistory
    .where('conversationId')
    .equals(conversationId)
    .modify({ ...updates, updatedAt: new Date() });
}

/** 删除对话历史（包括消息） */
export async function deleteConversationHistory(conversationId: string): Promise<void> {
  await db.transaction('rw', [db.conversationHistory, db.conversationMessages], async () => {
    await db.conversationMessages
      .where('conversationId')
      .equals(conversationId)
      .delete();
    await db.conversationHistory
      .where('conversationId')
      .equals(conversationId)
      .delete();
  });
}

/** 删除会话关联的所有对话历史（包括消息） */
export async function deleteSessionConversations(sessionId: string): Promise<void> {
  const conversations = await db.conversationHistory
    .where('sessionId')
    .equals(sessionId)
    .toArray();
  
  const conversationIds = conversations.map(c => c.conversationId);
  
  if (conversationIds.length > 0) {
    await db.transaction('rw', [db.conversationHistory, db.conversationMessages], async () => {
      await db.conversationMessages
        .where('conversationId')
        .anyOf(conversationIds)
        .delete();
      await db.conversationHistory
        .where('sessionId')
        .equals(sessionId)
        .delete();
    });
  }
}

/** 删除用户所有对话历史 */
export async function deleteUserConversations(userId: string): Promise<void> {
  const conversations = await db.conversationHistory
    .where('userId')
    .equals(userId)
    .toArray();
  
  const conversationIds = conversations.map(c => c.conversationId);
  
  await db.transaction('rw', [db.conversationHistory, db.conversationMessages], async () => {
    await db.conversationMessages
      .where('conversationId')
      .anyOf(conversationIds)
      .delete();
    await db.conversationHistory
      .where('userId')
      .equals(userId)
      .delete();
  });
}

// ============ 对话消息操作 ============

/** 添加对话消息 */
export async function addConversationMessage(
  message: Omit<ConversationMessageRecord, 'id' | 'createdAt'>
): Promise<number> {
  return db.conversationMessages.add({
    ...message,
    createdAt: new Date()
  });
}

/** 批量添加对话消息 */
export async function addConversationMessages(
  messages: Omit<ConversationMessageRecord, 'id' | 'createdAt'>[]
): Promise<number[]> {
  const now = new Date();
  const records = messages.map(m => ({
    ...m,
    createdAt: now
  }));
  return db.conversationMessages.bulkAdd(records, { allKeys: true }) as Promise<number[]>;
}

/** 获取对话的所有消息 */
export async function getConversationMessages(conversationId: string): Promise<ConversationMessageRecord[]> {
  return db.conversationMessages
    .where('conversationId')
    .equals(conversationId)
    .sortBy('createdAt');
}

/** 获取对话消息数量 */
export async function getConversationMessageCount(conversationId: string): Promise<number> {
  return db.conversationMessages
    .where('conversationId')
    .equals(conversationId)
    .count();
}

/** 删除对话的所有消息 */
export async function deleteConversationMessages(conversationId: string): Promise<number> {
  return db.conversationMessages
    .where('conversationId')
    .equals(conversationId)
    .delete();
}
