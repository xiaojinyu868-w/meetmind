'use client';

import { useEffect, useState } from 'react';
import {
  ACCOUNT_CONVERSATION_OUTBOX_CHANGED_EVENT,
  ACCOUNT_CONVERSATIONS_MERGED_EVENT,
  syncAccountConversationsNow,
} from '@/lib/services/account-conversation-sync-client';

export function useAccountConversationSync(
  accessToken: string | null | undefined,
  userId: string | null | undefined,
): number {
  const [mergeRevision, setMergeRevision] = useState(0);

  useEffect(() => {
    if (!accessToken || !userId || userId === 'anonymous') return undefined;
    const sync = () => { void syncAccountConversationsNow(accessToken, userId); };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener(ACCOUNT_CONVERSATION_OUTBOX_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener(ACCOUNT_CONVERSATION_OUTBOX_CHANGED_EVENT, sync);
    };
  }, [accessToken, userId]);

  useEffect(() => {
    const handleMerged = () => setMergeRevision((revision) => revision + 1);
    window.addEventListener(ACCOUNT_CONVERSATIONS_MERGED_EVENT, handleMerged);
    return () => window.removeEventListener(ACCOUNT_CONVERSATIONS_MERGED_EVENT, handleMerged);
  }, []);

  return mergeRevision;
}
