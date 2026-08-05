import prisma from '@/lib/prisma';
import {
  parseWorkspaceConversationMessageMutations,
  parseWorkspaceConversationMutations,
  type PortableWorkspaceConversationMessageMutation,
  type PortableWorkspaceConversationMutation,
} from '@/lib/capture/workspace-conversation';
import type { MessageAttachment } from '@/types/conversation';

export const ACCOUNT_CONVERSATION_SCOPE = 'global-ask';
export const MAX_ACCOUNT_CONVERSATION_MUTATIONS = 100;
export const MAX_ACCOUNT_CONVERSATIONS_IN_SNAPSHOT = 20;
export const MAX_ACCOUNT_MESSAGES_PER_CONVERSATION = 500;

export type AccountConversationMutationErrorCode = 'INVALID_INPUT' | 'CONFLICT';

export class AccountConversationMutationError extends Error {
  constructor(
    public readonly code: AccountConversationMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountConversationMutationError';
  }
}

export interface AccountConversationSyncResult {
  accepted: number;
  ignored: number;
}

function parseMetadata(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function parseAttachments(value: string | null): MessageAttachment[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const attachment = item as Partial<MessageAttachment>;
      if (
        (attachment.type !== 'image' && attachment.type !== 'file')
        || typeof attachment.url !== 'string'
      ) return [];
      return [{
        type: attachment.type,
        url: attachment.url,
        name: typeof attachment.name === 'string' ? attachment.name : undefined,
        size: typeof attachment.size === 'number' ? attachment.size : undefined,
      } satisfies MessageAttachment];
    });
  } catch {
    return undefined;
  }
}

function mutationTime(value: string): number {
  return new Date(value).getTime();
}

export function shouldIgnoreAccountConversationMutation(
  current: { clientUpdatedAt: Date; sourceMutationId: string },
  next: PortableWorkspaceConversationMutation,
): boolean {
  const currentTime = current.clientUpdatedAt.getTime();
  const nextTime = mutationTime(next.updatedAt);
  if (!Number.isFinite(nextTime)) return true;
  if (nextTime !== currentTime) return nextTime < currentTime;
  return next.mutationId <= current.sourceMutationId;
}

function ensureAccountConversationMutation(
  mutation: PortableWorkspaceConversationMutation,
): PortableWorkspaceConversationMutation {
  if (
    mutation.sessionId !== ACCOUNT_CONVERSATION_SCOPE
    || !mutation.mutationId
    || !Number.isFinite(mutationTime(mutation.createdAt))
    || !Number.isFinite(mutationTime(mutation.updatedAt))
  ) {
    throw new AccountConversationMutationError('INVALID_INPUT', '账号会话 mutation 不合法');
  }
  return mutation;
}

function ensureAccountMessageMutation(
  mutation: PortableWorkspaceConversationMessageMutation,
): PortableWorkspaceConversationMessageMutation {
  if (
    !mutation.messageId
    || !mutation.conversationId
    || !mutation.mutationId
    || !Number.isFinite(mutationTime(mutation.createdAt))
  ) {
    throw new AccountConversationMutationError('INVALID_INPUT', '账号会话消息 mutation 不合法');
  }
  return mutation;
}

export async function syncAccountConversationMutations(params: {
  userId: string;
  conversations: unknown;
  messages: unknown;
}): Promise<AccountConversationSyncResult> {
  const conversations = parseWorkspaceConversationMutations(params.conversations)
    .map(ensureAccountConversationMutation);
  const messages = parseWorkspaceConversationMessageMutations(params.messages)
    .map(ensureAccountMessageMutation);
  if (
    conversations.length === 0
    && messages.length === 0
  ) {
    throw new AccountConversationMutationError('INVALID_INPUT', '至少需要一条账号会话 mutation');
  }
  if (conversations.length + messages.length > MAX_ACCOUNT_CONVERSATION_MUTATIONS) {
    throw new AccountConversationMutationError(
      'INVALID_INPUT',
      `单次最多同步 ${MAX_ACCOUNT_CONVERSATION_MUTATIONS} 条账号会话 mutation`,
    );
  }

  let accepted = 0;
  let ignored = 0;
  await prisma.$transaction(async (tx) => {
    for (const mutation of conversations) {
      const current = await tx.accountConversation.findUnique({ where: { id: mutation.conversationId } });
      if (current && current.userId !== params.userId) {
        throw new AccountConversationMutationError('CONFLICT', '账号会话归属冲突');
      }
      if (current && shouldIgnoreAccountConversationMutation(current, mutation)) {
        ignored += 1;
        continue;
      }
      const nextData = {
        userId: params.userId,
        scope: ACCOUNT_CONVERSATION_SCOPE,
        type: mutation.type,
        title: mutation.title,
        sessionId: ACCOUNT_CONVERSATION_SCOPE,
        messageCount: mutation.messageCount,
        lastMessage: mutation.lastMessage ?? null,
        model: mutation.model ?? null,
        metadataJson: mutation.metadata ? JSON.stringify(mutation.metadata) : null,
        status: mutation.status,
        sourceMutationId: mutation.mutationId,
        clientCreatedAt: new Date(mutation.createdAt),
        clientUpdatedAt: new Date(mutation.updatedAt),
      };
      await tx.accountConversation.upsert({
        where: { id: mutation.conversationId },
        create: { id: mutation.conversationId, ...nextData },
        update: nextData,
      });
      if (mutation.status === 'deleted') {
        await tx.accountConversationMessage.deleteMany({
          where: { conversationId: mutation.conversationId },
        });
      }
      accepted += 1;
    }

    for (const mutation of messages) {
      const parent = await tx.accountConversation.findFirst({
        where: {
          id: mutation.conversationId,
          userId: params.userId,
          scope: ACCOUNT_CONVERSATION_SCOPE,
          status: 'active',
        },
        select: { id: true },
      });
      if (!parent) {
        ignored += 1;
        continue;
      }
      const current = await tx.accountConversationMessage.findUnique({ where: { id: mutation.messageId } });
      if (current) {
        if (current.conversationId !== mutation.conversationId) {
          throw new AccountConversationMutationError('CONFLICT', '账号消息归属冲突');
        }
        ignored += 1;
        continue;
      }
      await tx.accountConversationMessage.create({
        data: {
          id: mutation.messageId,
          conversationId: mutation.conversationId,
          role: mutation.role,
          content: mutation.content,
          attachmentsJson: mutation.attachments ? JSON.stringify(mutation.attachments) : null,
          sourceMutationId: mutation.mutationId,
          clientCreatedAt: new Date(mutation.createdAt),
        },
      });
      accepted += 1;
    }
  });
  return { accepted, ignored };
}

export interface AccountConversationSnapshot {
  conversations: PortableWorkspaceConversationMutation[];
  messages: PortableWorkspaceConversationMessageMutation[];
}

export async function getAccountConversationSnapshot(
  userId: string,
  options: { limit?: number; pinnedConversationId?: string } = {},
): Promise<AccountConversationSnapshot> {
  const take = Math.min(
    Math.max(1, options.limit ?? MAX_ACCOUNT_CONVERSATIONS_IN_SNAPSHOT),
    MAX_ACCOUNT_CONVERSATIONS_IN_SNAPSHOT,
  );
  const recentConversations = await prisma.accountConversation.findMany({
    where: { userId, scope: ACCOUNT_CONVERSATION_SCOPE },
    orderBy: { clientUpdatedAt: 'desc' },
    take,
    include: {
      messages: {
        orderBy: { clientCreatedAt: 'desc' },
        take: MAX_ACCOUNT_MESSAGES_PER_CONVERSATION,
      },
    },
  });
  const pinnedConversationId = options.pinnedConversationId?.trim().slice(0, 200);
  const pinnedConversation = pinnedConversationId
    && !recentConversations.some((conversation) => conversation.id === pinnedConversationId)
    ? await prisma.accountConversation.findFirst({
        where: {
          id: pinnedConversationId,
          userId,
          scope: ACCOUNT_CONVERSATION_SCOPE,
        },
        include: {
          messages: {
            orderBy: { clientCreatedAt: 'desc' },
            take: MAX_ACCOUNT_MESSAGES_PER_CONVERSATION,
          },
        },
      })
    : null;
  const conversations = pinnedConversation
    ? [...recentConversations, pinnedConversation]
    : recentConversations;
  return {
    conversations: conversations.map((conversation) => ({
      conversationId: conversation.id,
      type: conversation.type as PortableWorkspaceConversationMutation['type'],
      title: conversation.title,
      sessionId: ACCOUNT_CONVERSATION_SCOPE,
      messageCount: conversation.messageCount,
      lastMessage: conversation.lastMessage ?? undefined,
      model: conversation.model ?? undefined,
      metadata: parseMetadata(conversation.metadataJson),
      status: conversation.status === 'deleted' ? 'deleted' : 'active',
      createdAt: conversation.clientCreatedAt.toISOString(),
      updatedAt: conversation.clientUpdatedAt.toISOString(),
      mutationId: conversation.sourceMutationId,
    })),
    messages: conversations.flatMap((conversation) => [...conversation.messages]
      .sort((left, right) => left.clientCreatedAt.getTime() - right.clientCreatedAt.getTime())
      .map((message) => ({
      messageId: message.id,
      conversationId: message.conversationId,
      role: message.role as PortableWorkspaceConversationMessageMutation['role'],
      content: message.content,
      attachments: parseAttachments(message.attachmentsJson),
      status: 'active' as const,
      createdAt: message.clientCreatedAt.toISOString(),
      updatedAt: message.clientCreatedAt.toISOString(),
      mutationId: message.sourceMutationId,
      }))),
  };
}
