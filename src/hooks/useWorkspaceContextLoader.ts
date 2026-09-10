/**
 * useWorkspaceContextLoader
 *
 * 工作区上下文加载 + 同步 — 从 page.tsx 提取（Phase 5）
 *
 * 包含 3 个 useEffect：
 *   1. 工作区加载 — 认证后从 API 加载 captures + echoes
 *   2. workspaceCaptures → sourceItems 合并同步
 *   3. captureDrivenPulse 自动过期（12 秒后清零）
 *
 * 遵循 (deps, refs) 模式。所有 store 写入通过 getState().actions。
 */

import { useEffect } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import { useEchoStore } from '@/stores/echo-store';
import {
  compactText,
  buildWorkspaceCaptureSourceItem,
  resolveSourceItemSourceKey,
  getSupportReferenceDisplayTitle,
  mergeSupportReferences,
  mergeWorkspaceCaptures,
  mergeWorkspaceEchoes,
  mergeWechatWorkspaceCapturesIntoSourceItems,
  readJsonApiResponse,
} from '@/lib/utils/page-utils';
import { backfillCapturesToIndexedDB } from '@/lib/services/backfill-captures-to-indexeddb';
import { silentBackfillLessonTitles } from '@/lib/services/lesson-title-client';
import type { WorkspaceCaptureMessage, WorkspaceEchoMessage, SupportReferenceItem } from '@/types/page-types';

/** 定时刷新间隔 / 焦点触发的最小间隔（另一台设备结束的课在这个尺度内出现） */
export const WORKSPACE_REFRESH_INTERVAL_MS = 60_000;
export const WORKSPACE_REFRESH_MIN_GAP_MS = 20_000;

// ── Deps interface ──

interface UseWorkspaceContextLoaderDeps {
  accessToken: string | null;
  isAuthenticated: boolean;
  user: { id?: string } | null;
  wechatCaptureToken: string | null;
  /** Reactive: read workspaceCaptures for sync effect */
  workspaceCaptures: WorkspaceCaptureMessage[];
  /** Reactive: captureDrivenPulse for auto-expire effect */
  captureDrivenPulse: unknown;
}

// ── Refs interface ──

interface UseWorkspaceContextLoaderRefs {
  workspaceContextRequestKeyRef: React.MutableRefObject<string | null>;
}

// ── Hook ──

export function useWorkspaceContextLoader(
  deps: UseWorkspaceContextLoaderDeps,
  refs: UseWorkspaceContextLoaderRefs,
) {
  const {
    accessToken,
    isAuthenticated,
    user,
    wechatCaptureToken,
    workspaceCaptures,
    captureDrivenPulse,
  } = deps;

  const { workspaceContextRequestKeyRef } = refs;

  // ── Effect 1: 工作区加载 + 刷新 ──
  //
  // 2026-09-10 之前只在 (userId, wechatToken) 变化时拉一次：另一台设备结束了一节课，这边不刷新页面永远看不到
  //（生产实测 90s 内不出现）。现在首次加载后，页面回到前台 / 窗口获得焦点（≥20s 一次）和每 60s 定时
  // 各刷一次；拉回的 captures 走同一条合并 + 回填链路（幂等，按 id / sourceKey 去重，回填不覆盖本机编辑）。
  useEffect(() => {
    if (!isAuthenticated || !user?.id || !accessToken) return;

    const requestKey = `${user.id}:${wechatCaptureToken || ''}`;
    const isInitialLoad = workspaceContextRequestKeyRef.current !== requestKey;

    // 静默回填历史零信息标题（每次工作区加载最多 10 条，宁缺毋滥）
    if (isInitialLoad) silentBackfillLessonTitles(accessToken);

    let cancelled = false;
    let inFlight = false;
    let lastLoadedAt = 0;

    const loadWorkspace = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch('/api/workspace/current?includeArchived=1', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        const payload = await readJsonApiResponse<{
          success: boolean;
          workspace?: { id: string; name: string };
          captures?: WorkspaceCaptureMessage[];
          echoes?: WorkspaceEchoMessage[];
          error?: string;
        }>(response, '读取当前工作区失败');

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '读取当前工作区失败');
        }

        if (cancelled) return;

        const captures = Array.isArray(payload.captures) ? payload.captures : [];
        const activeCaptures = captures.filter((item) => (item.status || 'active') === 'active');
        const echoes = Array.isArray(payload.echoes) ? payload.echoes : [];

        if (payload.workspace?.id) {
          useEchoStore.getState().actions.setWorkspaceId(payload.workspace.id);
        }

        if (captures.length > 0) {
          // 档位1（跨设备带走数据）：把 capture 里的转录段回填到 IndexedDB，
          // 让「课堂 tab」也能显示在另一台设备录的课 + 完整转录（不只是材料 feed）。
          // 幂等 + 不覆盖本地已有转录；音频 blob 仍在原设备（档位2 上云后才跨设备可播）。
          if (user?.id) {
            void backfillCapturesToIndexedDB(captures, user.id)
              .then((r) => {
                if (r.backfilled > 0) {
                  // eslint-disable-next-line no-console
                  console.info('[workspace] backfilled captures to IndexedDB:', r);
                }
              })
              .catch(() => undefined);
          }
          useEchoStore.getState().actions.setWorkspaceCaptures((prev) => mergeWorkspaceCaptures(prev, captures));
          useCollectionStore.getState().actions.setSourceItems((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const existingSourceKeys = new Set(
              prev
                .map((item) => resolveSourceItemSourceKey(item))
                .filter((item): item is string => Boolean(item))
            );
            const next = [...prev];

            for (const item of activeCaptures) {
              const id = `workspace-${item.id}`;
              if (existingIds.has(id)) continue;
              if (item.sourceKey && existingSourceKeys.has(item.sourceKey)) continue;
              next.push(buildWorkspaceCaptureSourceItem(item));
              existingIds.add(id);
              if (item.sourceKey) {
                existingSourceKeys.add(item.sourceKey);
              }
            }

            return next;
          });

          const incomingReferences = activeCaptures
            .map((item) => {
              const snippet = (item.tutorContext || item.normalizedText || '').trim();
              if (!snippet) return null;
              const sourceItem = buildWorkspaceCaptureSourceItem(item);
              return {
                id: `workspace-${item.id}`,
                title: getSupportReferenceDisplayTitle(sourceItem),
                snippet: compactText(snippet, 2800),
              };
            })
            .filter((item): item is SupportReferenceItem => Boolean(item));

          if (incomingReferences.length > 0) {
            useCollectionStore.getState().actions.setSupportReferences((prev) => mergeSupportReferences(prev, incomingReferences));
          }
        }

        if (echoes.length > 0) {
          useEchoStore.getState().actions.setWorkspaceEchoes((prev) => mergeWorkspaceEchoes(prev, echoes));
        }

        workspaceContextRequestKeyRef.current = requestKey;
        lastLoadedAt = Date.now();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.error('[workspace.current]', message);
      } finally {
        inFlight = false;
      }
    };

    const refreshIfDue = (minGapMs: number) => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastLoadedAt < minGapMs) return;
      void loadWorkspace();
    };

    if (isInitialLoad) {
      void loadWorkspace();
    } else {
      lastLoadedAt = Date.now();
    }

    const onVisible = () => refreshIfDue(WORKSPACE_REFRESH_MIN_GAP_MS);
    const onFocus = () => refreshIfDue(WORKSPACE_REFRESH_MIN_GAP_MS);
    const timer = window.setInterval(() => refreshIfDue(WORKSPACE_REFRESH_INTERVAL_MS - 1000), WORKSPACE_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
    };
  }, [accessToken, isAuthenticated, user?.id, wechatCaptureToken]);

  // ── Effect 2: workspaceCaptures → sourceItems 合并同步 ──
  useEffect(() => {
    if (workspaceCaptures.length === 0) return;

    useCollectionStore.getState().actions.setSourceItems((prev) =>
      mergeWechatWorkspaceCapturesIntoSourceItems(
        prev,
        workspaceCaptures.filter((item) => (item.status || 'active') === 'active')
      )
    );
  }, [workspaceCaptures]);

  // ── Effect 3: captureDrivenPulse 自动过期 ──
  useEffect(() => {
    if (!captureDrivenPulse) return;

    const timer = window.setTimeout(() => {
      useCollectionStore.getState().actions.setCaptureDrivenPulse(null);
    }, 12000);

    return () => window.clearTimeout(timer);
  }, [captureDrivenPulse]);
}
