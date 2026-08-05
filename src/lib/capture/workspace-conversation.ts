import type {
  ConversationHistory,
  ConversationMessage,
  ConversationType,
  MessageAttachment,
  MessageRole,
} from '@/types/conversation';

export const MAX_WORKSPACE_CONVERSATION_MESSAGE_CHARS = 16_000;

export interface PortableWorkspaceConversationMutation {
  conversationId: string;
  type: ConversationType;
  title: string;
  sessionId: string;
  anchorId?: string;
  anchorTimestamp?: number;
  messageCount: number;
  lastMessage?: string;
  model?: string;
  metadata?: Record<string, unknown>;
  status: 'active' | 'deleted';
  createdAt: string;
  updatedAt: string;
  mutationId: string;
}

export interface PortableWorkspaceConversationMessageMutation {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  attachments?: MessageAttachment[];
  status: 'active';
  createdAt: string;
  updatedAt: string;
  mutationId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | undefined {
  return requiredString(value) || undefined;
}

function isoDate(value: unknown): string | null {
  const parsed = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeConversationType(value: unknown): ConversationType | null {
  return value === 'tutor' || value === 'chat' || value === 'global-chat' ? value : null;
}

function normalizeMessageRole(value: unknown): MessageRole | null {
  return value === 'user' || value === 'assistant' || value === 'system' ? value : null;
}

function serializableRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  try {
    return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function portableAttachments(value: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item) => {
    const record = asRecord(item);
    const type = record?.type === 'image' || record?.type === 'file' ? record.type : null;
    const url = optionalString(record?.url);
    if (!type || !url || (!url.startsWith('https://') && !url.startsWith('/api/'))) return [];
    return [{
      type,
      url: url.slice(0, 2_048),
      name: optionalString(record?.name)?.slice(0, 200),
      size: typeof record?.size === 'number' && Number.isFinite(record.size)
        ? Math.max(0, Math.round(record.size))
        : undefined,
    } satisfies MessageAttachment];
  });
  return attachments.length > 0 ? attachments : undefined;
}

export function isWorkspaceConversationSyncSession(sessionId: string | undefined): boolean {
  return Boolean(sessionId?.trim() && sessionId !== 'global-ask');
}

function buildPortableConversationMutation(
  conversation: ConversationHistory,
  options: { mutationId: string; status?: 'active' | 'deleted' },
): PortableWorkspaceConversationMutation | null {
  const conversationId = requiredString(conversation.conversationId);
  const sessionId = requiredString(conversation.sessionId);
  const type = normalizeConversationType(conversation.type);
  const createdAt = isoDate(conversation.createdAt);
  const updatedAt = isoDate(conversation.updatedAt);
  const mutationId = requiredString(options.mutationId);
  if (
    !conversationId
    || !sessionId
    || !type
    || !createdAt
    || !updatedAt
    || !mutationId
  ) return null;

  return {
    conversationId,
    type,
    title: requiredString(conversation.title)?.slice(0, 240) || '',
    sessionId,
    anchorId: optionalString(conversation.anchorId),
    anchorTimestamp: typeof conversation.anchorTimestamp === 'number'
      && Number.isFinite(conversation.anchorTimestamp)
      ? Math.max(0, Math.round(conversation.anchorTimestamp))
      : undefined,
    messageCount: Math.max(0, Math.round(conversation.messageCount || 0)),
    lastMessage: optionalString(conversation.lastMessage)?.slice(0, 500),
    model: optionalString(conversation.model)?.slice(0, 120),
    metadata: serializableRecord(conversation.metadata),
    status: options.status || 'active',
    createdAt,
    updatedAt,
    mutationId,
  };
}

export function buildWorkspaceConversationMutation(
  conversation: ConversationHistory,
  options: { mutationId: string; status?: 'active' | 'deleted' },
): PortableWorkspaceConversationMutation | null {
  const mutation = buildPortableConversationMutation(conversation, options);
  return mutation && isWorkspaceConversationSyncSession(mutation.sessionId) ? mutation : null;
}

export function buildAccountConversationMutation(
  conversation: ConversationHistory,
  options: { mutationId: string; status?: 'active' | 'deleted' },
): PortableWorkspaceConversationMutation | null {
  const mutation = buildPortableConversationMutation(conversation, options);
  return mutation?.sessionId === 'global-ask' ? mutation : null;
}

export function buildWorkspaceConversationMessageMutation(
  message: ConversationMessage,
  mutationId: string,
): PortableWorkspaceConversationMessageMutation | null {
  const messageId = requiredString(message.messageId);
  const conversationId = requiredString(message.conversationId);
  const role = normalizeMessageRole(message.role);
  const createdAt = isoDate(message.createdAt);
  const normalizedMutationId = requiredString(mutationId);
  if (!messageId || !conversationId || !role || !createdAt || !normalizedMutationId) return null;
  return {
    messageId,
    conversationId,
    role,
    content: String(message.content || '').slice(0, MAX_WORKSPACE_CONVERSATION_MESSAGE_CHARS),
    attachments: portableAttachments(message.attachments),
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    mutationId: normalizedMutationId,
  };
}

export const buildAccountConversationMessageMutation = buildWorkspaceConversationMessageMutation;

export function parseWorkspaceConversationMutations(
  value: unknown,
): PortableWorkspaceConversationMutation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const conversationId = requiredString(record?.conversationId);
    const sessionId = requiredString(record?.sessionId);
    const type = normalizeConversationType(record?.type);
    const createdAt = isoDate(record?.createdAt);
    const updatedAt = isoDate(record?.updatedAt);
    const status = record?.status === 'deleted' ? 'deleted' : 'active';
    if (!conversationId || !sessionId || !type || !createdAt || !updatedAt) return [];
    return [{
      conversationId,
      type,
      title: requiredString(record?.title)?.slice(0, 240) || '',
      sessionId,
      anchorId: optionalString(record?.anchorId),
      anchorTimestamp: typeof record?.anchorTimestamp === 'number'
        && Number.isFinite(record.anchorTimestamp)
        ? Math.max(0, Math.round(record.anchorTimestamp))
        : undefined,
      messageCount: typeof record?.messageCount === 'number'
        ? Math.max(0, Math.round(record.messageCount))
        : 0,
      lastMessage: optionalString(record?.lastMessage)?.slice(0, 500),
      model: optionalString(record?.model)?.slice(0, 120),
      metadata: serializableRecord(record?.metadata),
      status,
      createdAt,
      updatedAt,
      mutationId: optionalString(record?.mutationId) || '',
    }];
  });
}

export function parseWorkspaceConversationMessageMutations(
  value: unknown,
): PortableWorkspaceConversationMessageMutation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const messageId = requiredString(record?.messageId);
    const conversationId = requiredString(record?.conversationId);
    const role = normalizeMessageRole(record?.role);
    const createdAt = isoDate(record?.createdAt);
    if (!messageId || !conversationId || !role || !createdAt) return [];
    return [{
      messageId,
      conversationId,
      role,
      content: String(record?.content || '').slice(0, MAX_WORKSPACE_CONVERSATION_MESSAGE_CHARS),
      attachments: portableAttachments(record?.attachments),
      status: 'active',
      createdAt,
      updatedAt: isoDate(record?.updatedAt) || createdAt,
      mutationId: optionalString(record?.mutationId) || '',
    }];
  });
}
