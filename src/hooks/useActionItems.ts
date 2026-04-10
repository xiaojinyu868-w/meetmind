/**
 * useActionItems
 *
 * 行动项管理 — 从 page.tsx 提取（Phase 6）
 *
 * 包含：
 *   handleActionComplete    — 切换行动项完成状态 + 持久化
 *   handleStartNextAction   — 跳到下一个未完成行动项
 *   handleGenerateSummary   — 生成课堂摘要
 *   handleActionItemsUpdate — 接收新行动项列表 + 恢复已完成状态
 *
 * 遵循 (deps) 模式。Store 写入通过 getState().actions。
 */

import { useCallback } from 'react';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { getPreference, setPreference } from '@/lib/db';
import { getActionProgressKey } from '@/lib/utils/page-utils';
import type { Anchor } from '@/lib/services/anchor-service';
import type { ActionItem } from '@/types/page-types';

// ── Deps interface ──

interface UseActionItemsDeps {
  sessionId: string;
  actionItems: ActionItem[];
  selectedAnchorTimestamp: number | undefined;
  anchors: Anchor[];
  currentTime: number;
  handleUnifiedSeek: (timeMs: number, autoPlay?: boolean) => void;
  generateSummary: () => Promise<void>;
}

// ── Hook ──

export function useActionItems(deps: UseActionItemsDeps) {
  const {
    sessionId,
    actionItems,
    selectedAnchorTimestamp,
    anchors,
    currentTime,
    handleUnifiedSeek,
    generateSummary,
  } = deps;

  const handleActionComplete = useCallback((actionId: string) => {
    useCaptureEditorStore.getState().actions.setActionItems(prev => {
      const next = prev.map(item =>
        item.id === actionId ? { ...item, completed: !item.completed } : item
      );
      const completionState = next.reduce<Record<string, boolean>>((acc, item) => {
        if (item.completed) acc[item.id] = true;
        return acc;
      }, {});
      void setPreference(getActionProgressKey(sessionId), completionState).catch((err) => {
        console.error('Failed to persist action completion:', err);
      });
      return next;
    });
  }, [sessionId]);

  const handleStartNextAction = useCallback(() => {
    const nextPending = actionItems.find((item) => !item.completed);
    if (!nextPending) return;
    const nextTimestamp = typeof nextPending.relatedTimestamp === 'number'
      ? nextPending.relatedTimestamp
      : (selectedAnchorTimestamp ?? anchors.find((anchor) => !anchor.resolved)?.timestamp ?? currentTime);
    handleUnifiedSeek(nextTimestamp, true);
  }, [actionItems, selectedAnchorTimestamp, anchors, currentTime, handleUnifiedSeek]);

  // Generate class summary via SWR hook.
  const handleGenerateSummary = useCallback(async () => {
    try {
      await generateSummary();
    } catch (error) {
      console.error('生成摘要失败:', error);
    }
  }, [generateSummary]);

  // NOTE: cleaned corrupted legacy comment.
  const handleActionItemsUpdate = useCallback((items: ActionItem[]) => {
    void (async () => {
      try {
        const completionState = await getPreference<Record<string, boolean>>(getActionProgressKey(sessionId), {});
        const mergedItems = items.map((item) => ({
          ...item,
          completed: completionState[item.id] ?? item.completed,
        }));
        useCaptureEditorStore.getState().actions.setActionItems(mergedItems);
      } catch (err) {
        console.error('Failed to restore action completion:', err);
        useCaptureEditorStore.getState().actions.setActionItems(items);
      }
    })();
  }, [sessionId]);

  return {
    handleActionComplete,
    handleStartNextAction,
    handleGenerateSummary,
    handleActionItemsUpdate,
  };
}
