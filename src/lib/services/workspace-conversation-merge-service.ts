import {
  parseWorkspaceConversationMessageMutations,
  parseWorkspaceConversationMutations,
  type PortableWorkspaceConversationMessageMutation,
  type PortableWorkspaceConversationMutation,
} from '@/lib/capture/workspace-conversation';
import {
  db,
  type ConversationHistoryRecord,
  type ConversationMessageRecord,
} from '@/lib/db';

export interface WorkspaceConversationMergeResult {
  inserted: number;
  updated: number;
  deleted: number;
  messagesInserted: number;
  ignored: number;
}

export interface WorkspaceConversationMergePlan extends WorkspaceConversationMergeResult {
  conversationPuts: ConversationHistoryRecord[];
  conversationDeleteIds: number[];
  deletedConversationIds: string[];
  messagePuts: ConversationMessageRecord[];
}

function shouldApplyRemote(
  local: ConversationHistoryRecord,
  remote: PortableWorkspaceConversationMutation,
): boolean {
  const remoteTime = new Date(remote.updatedAt).getTime();
  const localTime = local.updatedAt.getTime();
  if (remoteTime !== localTime) return remoteTime > localTime;
  return Boolean(remote.mutationId) && remote.mutationId > (local.sourceMutationId || '');
}

function toConversationRecord(
  remote: PortableWorkspaceConversationMutation,
  userId: string,
  existing?: ConversationHistoryRecord,
): ConversationHistoryRecord {
  return {
    ...existing,
    conversationId: remote.conversationId,
    userId,
    type: remote.type,
    title: remote.title,
    sessionId: remote.sessionId,
    anchorId: remote.anchorId,
    anchorTimestamp: remote.anchorTimestamp,
    messageCount: remote.messageCount,
    lastMessage: remote.lastMessage,
    model: remote.model,
    metadata: remote.metadata ? JSON.stringify(remote.metadata) : undefined,
    sourceMutationId: remote.mutationId,
    createdAt: new Date(remote.createdAt),
    updatedAt: new Date(remote.updatedAt),
  };
}

function toMessageRecord(
  remote: PortableWorkspaceConversationMessageMutation,
): ConversationMessageRecord {
  return {
    messageId: remote.messageId,
    conversationId: remote.conversationId,
    role: remote.role,
    content: remote.content,
    attachments: remote.attachments ? JSON.stringify(remote.attachments) : undefined,
    createdAt: new Date(remote.createdAt),
  };
}

export function planWorkspaceConversationMerge(params: {
  localConversations: ConversationHistoryRecord[];
  localMessages: ConversationMessageRecord[];
  remoteConversations: PortableWorkspaceConversationMutation[];
  remoteMessages: PortableWorkspaceConversationMessageMutation[];
  sessionId: string;
  userId: string;
}): WorkspaceConversationMergePlan {
  const plan: WorkspaceConversationMergePlan = {
    conversationPuts: [],
    conversationDeleteIds: [],
    deletedConversationIds: [],
    messagePuts: [],
    inserted: 0,
    updated: 0,
    deleted: 0,
    messagesInserted: 0,
    ignored: 0,
  };
  const working = new Map(params.localConversations.map((row) => [row.conversationId, { ...row }]));

  for (const remote of params.remoteConversations) {
    if (remote.sessionId !== params.sessionId) {
      plan.ignored += 1;
      continue;
    }
    const local = working.get(remote.conversationId);
    if (remote.status === 'deleted') {
      if (local && shouldApplyRemote(local, remote)) {
        if (local.id != null) plan.conversationDeleteIds.push(local.id);
        plan.deletedConversationIds.push(remote.conversationId);
        working.delete(remote.conversationId);
        plan.deleted += 1;
      } else if (!local) {
        plan.deletedConversationIds.push(remote.conversationId);
        plan.ignored += 1;
      } else {
        plan.ignored += 1;
      }
      continue;
    }
    if (local && !shouldApplyRemote(local, remote)) {
      plan.ignored += 1;
      continue;
    }
    const next = toConversationRecord(remote, params.userId, local);
    working.set(remote.conversationId, next);
    plan.conversationPuts.push(next);
    if (local) plan.updated += 1;
    else plan.inserted += 1;
  }

  const existingMessageIds = new Set(params.localMessages.map((row) => row.messageId));
  for (const remote of params.remoteMessages) {
    if (existingMessageIds.has(remote.messageId) || !working.has(remote.conversationId)) {
      plan.ignored += 1;
      continue;
    }
    const message = toMessageRecord(remote);
    plan.messagePuts.push(message);
    existingMessageIds.add(message.messageId);
    plan.messagesInserted += 1;
  }
  return plan;
}

export async function mergeWorkspaceConversationsFromCloud(params: {
  sessionId: string;
  userId: string;
  conversations: unknown;
  conversationMessages: unknown;
}): Promise<WorkspaceConversationMergeResult> {
  const remoteConversations = parseWorkspaceConversationMutations(params.conversations);
  const remoteMessages = parseWorkspaceConversationMessageMutations(params.conversationMessages);
  if (remoteConversations.length === 0 && remoteMessages.length === 0) {
    return { inserted: 0, updated: 0, deleted: 0, messagesInserted: 0, ignored: 0 };
  }

  return db.transaction('rw', [db.conversationHistory, db.conversationMessages], async () => {
    const localConversations = await db.conversationHistory
      .where('sessionId')
      .equals(params.sessionId)
      .toArray();
    const conversationIds = localConversations.map((row) => row.conversationId);
    const localMessages = conversationIds.length > 0
      ? await db.conversationMessages.where('conversationId').anyOf(conversationIds).toArray()
      : [];
    const plan = planWorkspaceConversationMerge({
      localConversations,
      localMessages,
      remoteConversations,
      remoteMessages,
      sessionId: params.sessionId,
      userId: params.userId,
    });
    if (plan.deletedConversationIds.length > 0) {
      await db.conversationMessages
        .where('conversationId')
        .anyOf(plan.deletedConversationIds)
        .delete();
    }
    if (plan.conversationDeleteIds.length > 0) {
      await db.conversationHistory.bulkDelete(plan.conversationDeleteIds);
    }
    if (plan.conversationPuts.length > 0) {
      await db.conversationHistory.bulkPut(plan.conversationPuts);
    }
    if (plan.messagePuts.length > 0) {
      await db.conversationMessages.bulkPut(plan.messagePuts);
    }
    return {
      inserted: plan.inserted,
      updated: plan.updated,
      deleted: plan.deleted,
      messagesInserted: plan.messagesInserted,
      ignored: plan.ignored,
    };
  });
}

// The merge algorithm is session-generic; account-global history uses its own API and outbox.
export const mergeConversationMutationsFromCloud = mergeWorkspaceConversationsFromCloud;
