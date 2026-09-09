'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { ContextClient, ContextClientError } from '../../packages/context-sdk/src';
import type { ContextEventInput, ContextEventRecord, ContextGrantRecord, UserContextBundle } from '@/types/context';

const portraitIntent = '整理这位用户当前在学什么、近期目标、明确表达的偏好、遇到的困难和最近的变化。保留自述与实际表现的区别，不将单次表现当成稳定特征。';

export function useSharedContext(spaceId = 'personal') {
  const { accessToken, user, isCheckingAuth } = useAuth();
  const [events, setEvents] = useState<ContextEventRecord[]>([]);
  const [grants, setGrants] = useState<ContextGrantRecord[]>([]);
  const [bundle, setBundle] = useState<UserContextBundle | null>(null);
  const [portrait, setPortrait] = useState<UserContextBundle | null>(null);
  const [loadingPortrait, setLoadingPortrait] = useState(false);
  const [selectedSource, setSelectedSource] = useState<ContextEventRecord | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const refreshGeneration = useRef(0);
  const pending = useRef<ContextEventInput | null>(null);
  const client = useMemo(() => accessToken ? new ContextClient({
    baseUrl: typeof window === 'undefined' ? 'http://localhost/api/context/v1' : `${window.location.origin}/api/context/v1`,
    token: accessToken,
  }) : null, [accessToken]);

  const refresh = useCallback(async () => {
    if (!client) return;
    const version = generation.current;
    const revision = ++refreshGeneration.current;
    setPortrait(null); setLoadingPortrait(true);
    const [history, applications, understanding] = await Promise.allSettled([
      client.events(undefined, spaceId), client.grants(),
      client.prepare({ task: { intent: portraitIntent }, scope: { spaceIds: [spaceId] }, budget: { maxTokens: 4_000 } }),
    ]);
    if (version !== generation.current || revision !== refreshGeneration.current) return;
    setLoadingPortrait(false);
    if (history.status === 'fulfilled') { setEvents(history.value.events); setNextCursor(history.value.nextCursor); }
    if (applications.status === 'fulfilled') setGrants(applications.value.grants);
    if (understanding.status === 'fulfilled') setPortrait(understanding.value);
    if ([history, applications, understanding].some((result) => result.status === 'rejected')) throw new Error('load_failed');
  }, [client, spaceId]);

  useEffect(() => {
    generation.current += 1;
    const version = generation.current;
    setEvents([]); setGrants([]); setBundle(null); setPortrait(null); setLoadingPortrait(false); setIssuedToken(null); setError(null); setBusy(false);
    setSelectedSource(null);
    pending.current = null;
    void refresh().catch(() => { if (version === generation.current) setError('load_failed'); });
    return () => { generation.current += 1; };
  }, [refresh, user?.id]);

  const run = useCallback(async (action: (client: ContextClient, isCurrent: () => boolean) => Promise<void>) => {
    if (!client) return false;
    const version = generation.current;
    const isCurrent = () => version === generation.current;
    setBusy(true); setError(null);
    try {
      await action(client, isCurrent);
      return isCurrent();
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof ContextClientError ? cause.code : 'request_failed');
      return false;
    } finally { if (isCurrent()) setBusy(false); }
  }, [client]);

  return {
    signedIn: Boolean(user && client), isCheckingAuth, events, grants, bundle, portrait, selectedSource, issuedToken, error,
    busy: busy || loadingPortrait, loadingPortrait, nextCursor,
    refresh: () => run(async () => { await refresh(); }),
    dismissToken: () => setIssuedToken(null),
    dismissSource: () => setSelectedSource(null),
    inspectSource: (id: string) => run(async (api, isCurrent) => {
      const result = await api.source(id);
      if (isCurrent()) setSelectedSource(result.event);
    }),
    loadMore: () => run(async (api, isCurrent) => {
      if (!nextCursor) return;
      const page = await api.events(nextCursor, spaceId);
      if (isCurrent()) { setEvents((rows) => [...rows, ...page.events]); setNextCursor(page.nextCursor); }
    }),
    append: (content: string, spaceId: string) => run(async (api, isCurrent) => {
      if (pending.current?.content !== content || pending.current.spaceId !== spaceId) {
        pending.current = {
          schemaVersion: 1, clientEventId: crypto.randomUUID(), type: 'user.note', content, spaceId,
          occurredAt: new Date().toISOString(),
        };
      }
      await api.append(pending.current);
      if (isCurrent()) { pending.current = null; setBundle(null); await refresh(); }
    }),
    prepare: (intent: string, spaceId: string) => run(async (api, isCurrent) => {
      const result = await api.prepare({ task: { intent }, scope: { spaceIds: [spaceId] }, budget: { maxTokens: 4_000 } });
      if (isCurrent()) setBundle(result);
    }),
    control: (id: string, action: 'pause' | 'resume' | 'forget') => run(async (api, isCurrent) => {
      await api.control(id, action);
      if (isCurrent()) { setBundle(null); setSelectedSource(null); await refresh(); }
    }),
    grant: (appId: string, spaceId: string, write: boolean) => run(async (api, isCurrent) => {
      const result = await api.grant({ appId, label: appId, spaceIds: [spaceId], capabilities: write ? ['read', 'write'] : ['read'] });
      if (isCurrent()) { setIssuedToken(result.token); await refresh(); }
    }),
    revoke: (id: string) => run(async (api, isCurrent) => {
      await api.revoke(id);
      if (isCurrent()) { setIssuedToken(null); await refresh(); }
    }),
  };
}
