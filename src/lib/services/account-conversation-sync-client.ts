'use client';

import {
  buildAccountConversationMutation,
  buildAccountConversationMessageMutation,
  type PortableWorkspaceConversationMessageMutation,
  type PortableWorkspaceConversationMutation,
} from '@/lib/capture/workspace-conversation';
import {
  ANONYMOUS_USER_ID,
  db,
  type ConversationHistoryRecord,
  type ConversationMessageRecord,
} from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { mergeConversationMutationsFromCloud } from '@/lib/services/workspace-conversation-merge-service';
import type { ConversationHistory, ConversationMessage, MessageAttachment } from '@/types/conversation';

const logger = createLogger('account-conversation-sync');
const OUTBOX_STORAGE_KEY = 'meetmind_account_conversation_outbox_v1';
const BOOTSTRAP_STORAGE_PREFIX = 'meetmind_account_conversation_bootstrap_v1:';
const PINNED_BOOTSTRAP_STORAGE_PREFIX = 'meetmind_account_conversation_pinned_bootstrap_v1:';
const MAX_SYNC_BATCH = 100;
const GLOBAL_ASK_SESSION_ID = 'global-ask';

export const ACCOUNT_CONVERSATION_OUTBOX_CHANGED_EVENT = 'meetmind:account-conversation-outbox-changed';
export const ACCOUNT_CONVERSATIONS_MERGED_EVENT = 'meetmind:account-conversations-merged';

type AccountConversationPayload =
  | PortableWorkspaceConversationMutation
  | PortableWorkspaceConversationMessageMutation;

export interface AccountConversationOutboxEntry {
  key: string;
  userId: string;
  kind: 'conversation' | 'message';
  payload: AccountConversationPayload;
  queuedAt: string;
}

export interface AccountConversationSyncResult {
  sent: number;
  pending: number;
  merged: number;
}

let volatileOutbox: AccountConversationOutboxEntry[] = [];
interface PendingAccountConversationSync {
  pinnedConversationId?: string;
  promise: Promise<AccountConversationSyncResult>;
}

const pendingSyncs = new Map<string, PendingAccountConversationSync>();
const pendingPinnedPulls = new Map<string, Promise<number>>();

function createMutationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `account-conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOutboxEntry(value: unknown): value is AccountConversationOutboxEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Partial<AccountConversationOutboxEntry>;
  return typeof entry.key === 'string'
    && typeof entry.userId === 'string'
    && (entry.kind === 'conversation' || entry.kind === 'message')
    && typeof entry.queuedAt === 'string'
    && Boolean(entry.payload)
    && typeof entry.payload?.mutationId === 'string'
    && typeof entry.payload?.updatedAt === 'string';
}

function isNewer(candidate: AccountConversationPayload, current: AccountConversationPayload): boolean {
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return candidate.mutationId > current.mutationId;
}

export function readAccountConversationMutationOutbox(): AccountConversationOutboxEntry[] {
  if (typeof localStorage === 'undefined') return [...volatileOutbox];
  try {
    const parsed = JSON.parse(localStorage.getItem(OUTBOX_STORAGE_KEY) || '[]') as unknown;
    const stored = Array.isArray(parsed) ? parsed.filter(isOutboxEntry) : [];
    const merged = new Map(stored.map((entry) => [entry.key, entry]));
    for (const entry of volatileOutbox) {
      const current = merged.get(entry.key);
      if (!current || isNewer(entry.payload, current.payload)) merged.set(entry.key, entry);
    }
    volatileOutbox = [...merged.values()];
  } catch {
    // Keep the in-memory copy retryable when persisted storage is unavailable.
  }
  return [...volatileOutbox];
}

function writeOutbox(entries: AccountConversationOutboxEntry[]): void {
  volatileOutbox = entries;
  if (typeof localStorage === 'undefined') return;
  try {
    if (entries.length === 0) localStorage.removeItem(OUTBOX_STORAGE_KEY);
    else localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    logger.warn('account conversation outbox storage unavailable', { error: String(error) });
  }
}

function enqueueEntry(entry: AccountConversationOutboxEntry): AccountConversationOutboxEntry {
  const existing = readAccountConversationMutationOutbox();
  const current = existing.find((item) => item.key === entry.key);
  if (current && !isNewer(entry.payload, current.payload)) return current;
  writeOutbox([...existing.filter((item) => item.key !== entry.key), entry]);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACCOUNT_CONVERSATION_OUTBOX_CHANGED_EVENT));
  }
  return entry;
}

export function enqueueAccountConversationMutation(
  conversation: ConversationHistory,
  options: { mutationId?: string; status?: 'active' | 'deleted' } = {},
): AccountConversationOutboxEntry | null {
  if (!conversation.userId || conversation.userId === 'anonymous') return null;
  const payload = buildAccountConversationMutation(conversation, {
    mutationId: options.mutationId || createMutationId(),
    status: options.status,
  });
  if (!payload) return null;
  return enqueueEntry({
    key: `${conversation.userId}:conversation:${payload.conversationId}`,
    userId: conversation.userId,
    kind: 'conversation',
    payload,
    queuedAt: payload.updatedAt,
  });
}

export function enqueueAccountConversationMessageMutation(
  userId: string,
  message: ConversationMessage,
  mutationId = createMutationId(),
): AccountConversationOutboxEntry | null {
  if (!userId || userId === 'anonymous') return null;
  const payload = buildAccountConversationMessageMutation(message, mutationId);
  if (!payload) return null;
  return enqueueEntry({
    key: `${userId}:message:${payload.messageId}`,
    userId,
    kind: 'message',
    payload,
    queuedAt: payload.updatedAt,
  });
}

async function postMutations(
  accessToken: string,
  entries: Array<{ kind: 'conversation' | 'message'; payload: AccountConversationPayload }>,
): Promise<boolean> {
  const response = await fetch('/api/conversations/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      conversations: entries.filter((entry) => entry.kind === 'conversation').map((entry) => entry.payload),
      messages: entries.filter((entry) => entry.kind === 'message').map((entry) => entry.payload),
    }),
  });
  const body = await response.json().catch(() => null) as { success?: boolean } | null;
  return response.ok && body?.success === true;
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
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

function parseAttachments(value: string | undefined): MessageAttachment[] | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as MessageAttachment[];
  } catch {
    return undefined;
  }
}

function historyRecordToConversation(record: ConversationHistoryRecord): ConversationHistory {
  return { ...record, metadata: parseMetadata(record.metadata) };
}

function messageRecordToConversationMessage(record: ConversationMessageRecord): ConversationMessage {
  return { ...record, attachments: parseAttachments(record.attachments) };
}

function getPinnedBootstrapMarker(userId: string, conversationId: string): string {
  return `${PINNED_BOOTSTRAP_STORAGE_PREFIX}${userId}:${conversationId}`;
}

async function buildBootstrapEntries(
  conversations: ConversationHistoryRecord[],
): Promise<Array<{ kind: 'conversation' | 'message'; payload: AccountConversationPayload }>> {
  const conversationEntries = conversations.flatMap((row) => {
    const payload = buildAccountConversationMutation(historyRecordToConversation(row), {
      mutationId: row.sourceMutationId || `bootstrap:${row.conversationId}:${row.updatedAt.toISOString()}`,
    });
    return payload ? [{ kind: 'conversation' as const, payload }] : [];
  });
  const ids = conversations.map((row) => row.conversationId);
  const messages = ids.length > 0
    ? await db.conversationMessages.where('conversationId').anyOf(ids).toArray()
    : [];
  const messageEntries = messages.flatMap((row) => {
    const payload = buildAccountConversationMessageMutation(
      messageRecordToConversationMessage(row),
      `bootstrap:${row.messageId}`,
    );
    return payload ? [{ kind: 'message' as const, payload }] : [];
  });
  return [...conversationEntries, ...messageEntries];
}

async function postBootstrapEntries(
  accessToken: string,
  entries: Array<{ kind: 'conversation' | 'message'; payload: AccountConversationPayload }>,
): Promise<boolean> {
  for (let index = 0; index < entries.length; index += MAX_SYNC_BATCH) {
    if (!await postMutations(accessToken, entries.slice(index, index + MAX_SYNC_BATCH))) return false;
  }
  return true;
}

async function claimAnonymousConversations(
  userId: string,
  conversations: ConversationHistoryRecord[],
): Promise<void> {
  for (const conversation of conversations) {
    if (conversation.userId !== ANONYMOUS_USER_ID || conversation.id == null) continue;
    try {
      await db.conversationHistory.update(conversation.id, { userId });
    } catch (error) {
      // 云端已接收时，本地归属更新失败也必须保留重试机会；下一次拉取会再次合并。
      logger.warn('anonymous account conversation claim deferred', {
        conversationId: conversation.conversationId,
        userId,
        error: String(error),
      });
    }
  }
}

async function bootstrapLocalHistory(
  accessToken: string,
  userId: string,
  pinnedConversationId?: string,
): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const marker = `${BOOTSTRAP_STORAGE_PREFIX}${userId}`;
  const bootstrapComplete = localStorage.getItem(marker) === 'complete';
  const normalizedPinnedId = pinnedConversationId?.trim();
  const pinnedMarker = normalizedPinnedId
    ? getPinnedBootstrapMarker(userId, normalizedPinnedId)
    : undefined;
  const pinnedComplete = pinnedMarker ? localStorage.getItem(pinnedMarker) === 'complete' : true;

  const candidates: ConversationHistoryRecord[] = [];
  const globalAskConversations = await db.conversationHistory
    .where('sessionId')
    .equals(GLOBAL_ASK_SESSION_ID)
    .toArray();
  if (!bootstrapComplete) {
    candidates.push(...globalAskConversations
      .filter((row) => row.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 20));
  }

  // 匿名 Global Ask 记录不受 recent-20 marker 限制：游客可能在上次登录后继续产生新线程，
  // 每次账号同步都检查，成功认领后本地 userId 会改变，不会再次迁移。
  candidates.push(...globalAskConversations
    .filter((row) => row.userId === ANONYMOUS_USER_ID)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));

  if (normalizedPinnedId && !pinnedComplete) {
    const pinned = await db.conversationHistory
      .where('conversationId')
      .equals(normalizedPinnedId)
      .first();
    if (
      pinned
      && (pinned.userId === userId || pinned.userId === ANONYMOUS_USER_ID)
      && pinned.sessionId === GLOBAL_ASK_SESSION_ID
      && !candidates.some((conversation) => conversation.conversationId === pinned.conversationId)
    ) {
      candidates.push(pinned);
    }
  }

  const conversations = [...new Map(candidates.map((conversation) => [conversation.conversationId, conversation])).values()];
  const accountConversations = conversations.filter((conversation) => conversation.userId === userId);
  const anonymousConversations = conversations.filter((conversation) => conversation.userId === ANONYMOUS_USER_ID);
  const accountEntries = await buildBootstrapEntries(accountConversations);
  const anonymousEntries = await buildBootstrapEntries(anonymousConversations);
  const accountUploaded = accountEntries.length === 0
    || await postBootstrapEntries(accessToken, accountEntries);
  const anonymousUploaded = anonymousEntries.length === 0
    || await postBootstrapEntries(accessToken, anonymousEntries);

  if (accountUploaded && !bootstrapComplete) localStorage.setItem(marker, 'complete');
  if (anonymousUploaded) {
    await claimAnonymousConversations(userId, anonymousConversations);
  }
  const pinnedUploaded = normalizedPinnedId && (
    (accountUploaded && accountConversations.some((conversation) => conversation.conversationId === normalizedPinnedId))
    || (anonymousUploaded && anonymousConversations.some((conversation) => conversation.conversationId === normalizedPinnedId))
  );
  if (pinnedMarker && normalizedPinnedId && !pinnedComplete && pinnedUploaded) {
    localStorage.setItem(pinnedMarker, 'complete');
  }
}

async function flushOutbox(accessToken: string, userId: string): Promise<{ sent: number; pending: number }> {
  let sent = 0;
  while (true) {
    const batch = readAccountConversationMutationOutbox()
      .filter((entry) => entry.userId === userId)
      .slice(0, MAX_SYNC_BATCH);
    if (batch.length === 0) break;
    try {
      if (!await postMutations(accessToken, batch)) break;
      const accepted = new Map(batch.map((entry) => [entry.key, entry.payload.mutationId]));
      writeOutbox(readAccountConversationMutationOutbox().filter((entry) => (
        accepted.get(entry.key) !== entry.payload.mutationId
      )));
      sent += batch.length;
    } catch (error) {
      logger.warn('account conversation outbox flush deferred', { error: String(error) });
      break;
    }
  }
  const pending = readAccountConversationMutationOutbox().filter((entry) => entry.userId === userId).length;
  return { sent, pending };
}

async function pullAccountConversations(
  accessToken: string,
  userId: string,
  pinnedConversationId?: string,
): Promise<number> {
  try {
    const normalizedPinnedId = pinnedConversationId?.trim();
    const path = normalizedPinnedId
      ? `/api/conversations/sync?${new URLSearchParams({ conversationId: normalizedPinnedId })}`
      : '/api/conversations/sync';
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json().catch(() => null) as {
      success?: boolean;
      conversations?: unknown;
      messages?: unknown;
    } | null;
    if (!response.ok || body?.success !== true) throw new Error(`HTTP ${response.status}`);
    const result = await mergeConversationMutationsFromCloud({
      sessionId: GLOBAL_ASK_SESSION_ID,
      userId,
      conversations: body.conversations,
      conversationMessages: body.messages,
    });
    const merged = result.inserted + result.updated + result.deleted + result.messagesInserted;
    if (merged > 0 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ACCOUNT_CONVERSATIONS_MERGED_EVENT));
    }
    return merged;
  } catch (error) {
    logger.warn('account conversation pull deferred', { error: String(error) });
    return 0;
  }
}

async function runSync(
  accessToken: string,
  userId: string,
  pinnedConversationId?: string,
): Promise<AccountConversationSyncResult> {
  try {
    await bootstrapLocalHistory(accessToken, userId, pinnedConversationId);
  } catch (error) {
    logger.warn('account conversation bootstrap deferred', { error: String(error) });
  }
  const flushed = await flushOutbox(accessToken, userId);
  const merged = await pullAccountConversations(accessToken, userId, pinnedConversationId);
  return { ...flushed, merged };
}

function pullPinnedConversationAfter(
  current: Promise<AccountConversationSyncResult>,
  accessToken: string,
  userId: string,
  pinnedConversationId: string,
): Promise<number> {
  const key = `${userId}:${pinnedConversationId}`;
  const existing = pendingPinnedPulls.get(key);
  if (existing) return existing;
  const pending = current
    .then(async () => {
      try {
        await bootstrapLocalHistory(accessToken, userId, pinnedConversationId);
      } catch (error) {
        logger.warn('account conversation pinned bootstrap deferred', { error: String(error) });
      }
      return pullAccountConversations(accessToken, userId, pinnedConversationId);
    })
    .finally(() => pendingPinnedPulls.delete(key));
  pendingPinnedPulls.set(key, pending);
  return pending;
}

export function syncAccountConversationsNow(
  accessToken: string | null | undefined,
  userId: string | null | undefined,
  pinnedConversationId?: string,
): Promise<AccountConversationSyncResult> {
  if (!accessToken || !userId || userId === 'anonymous') {
    return Promise.resolve({ sent: 0, pending: 0, merged: 0 });
  }
  const current = pendingSyncs.get(userId);
  const normalizedPinnedId = pinnedConversationId?.trim() || undefined;
  if (current) {
    if (!normalizedPinnedId || current.pinnedConversationId === normalizedPinnedId) {
      return current.promise;
    }
    const pinnedPull = pullPinnedConversationAfter(
      current.promise,
      accessToken,
      userId,
      normalizedPinnedId,
    );
    return Promise.all([current.promise, pinnedPull]).then(([result, pinnedMerged]) => ({
      ...result,
      merged: result.merged + pinnedMerged,
    }));
  }
  const pending = runSync(accessToken, userId, normalizedPinnedId)
    .finally(() => pendingSyncs.delete(userId));
  pendingSyncs.set(userId, { pinnedConversationId: normalizedPinnedId, promise: pending });
  return pending;
}
