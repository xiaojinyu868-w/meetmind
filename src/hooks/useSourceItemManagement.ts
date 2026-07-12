/**
 * useSourceItemManagement
 *
 * 收集源项 CRUD — 从 page.tsx 提取（Phase 6）
 *
 * 包含：
 *   appendSourceItem    — 追加一个新 source item
 *   updateSourceItem    — 按 id 部分更新 source item
 *   appendSupportSource — 追加参考资料（创建 item + 生成 reference snippet）
 *
 * 遵循零依赖模式。Store 写入通过 getState().actions。
 */

import { useCallback } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import {
  buildSupportReferenceSnippet,
  buildSourcePreviewText,
  mergeSupportReferences,
} from '@/lib/utils/page-utils';
import type { TranscriptSegment } from '@/types';
import type {
  SourceIngestType,
  SourceIngestRole,
  SourceIngestItem,
  SourceProvenance,
} from '@/types/page-types';

// ── Hook ──

export function useSourceItemManagement() {
  const appendSourceItem = useCallback((params: {
    id?: string;
    sourceKey?: string;
    type: SourceIngestType;
    role: SourceIngestRole;
    title: string;
    preview?: string;
    previewUrl?: string;
    mediaUrl?: string;
    attachmentUrl?: string;
    fullText?: string;
    segmentCount: number;
    keepPrevious?: boolean;
    origin?: 'user' | 'system';
    status?: SourceIngestItem['status'];
    statusText?: string;
    sessionId?: string;
    durationMs?: number;
    reviewable?: boolean;
    provenance?: SourceProvenance;
  }) => {
    useCollectionStore.getState().actions.setSourceItems((prev) => {
      const item: SourceIngestItem = {
        id: params.id || `${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceKey: params.sourceKey,
        type: params.type,
        role: params.role,
        title: params.title,
        preview: params.preview,
        previewUrl: params.previewUrl,
        mediaUrl: params.mediaUrl,
        attachmentUrl: params.attachmentUrl,
        fullText: params.fullText,
        segmentCount: params.segmentCount,
        addedAt: new Date().toISOString(),
        origin: params.origin || 'user',
        status: params.status || 'ready',
        statusText: params.statusText,
        sessionId: params.sessionId,
        durationMs: params.durationMs,
        reviewable: params.reviewable,
        provenance: params.provenance,
      };
      if (params.keepPrevious === false) {
        const supportOnly = prev.filter((sourceItem) => sourceItem.role === 'support');
        return [...supportOnly, item];
      }
      return [...prev, item];
    });
  }, []);

  const updateSourceItem = useCallback((id: string, patch: Partial<SourceIngestItem>) => {
    useCollectionStore.getState().actions.setSourceItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const appendSupportSource = useCallback((params: {
    id?: string;
    sourceKey?: string;
    type: Extract<SourceIngestType, 'document' | 'text'>;
    title: string;
    segments: TranscriptSegment[];
    appendItem?: boolean;
    provenance?: SourceProvenance;
  }) => {
    const supportId = params.id || `${params.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reference = buildSupportReferenceSnippet(params.segments, 2800);
    if (params.appendItem !== false) {
      appendSourceItem({
        id: supportId,
        sourceKey: params.sourceKey,
        type: params.type,
        role: 'support',
        title: params.title,
        preview: buildSourcePreviewText(params.segments, 180),
        segmentCount: params.segments.length,
        origin: 'user',
        status: 'ready',
        statusText: undefined,
        provenance: params.provenance,
      });
    }
    if (reference) {
      useCollectionStore.getState().actions.setSupportReferences((prev) => mergeSupportReferences(prev, [{
        id: supportId,
        title: params.title,
        snippet: reference,
      }]));
    }
    return {
      supportId,
      reference,
    };
  }, [appendSourceItem]);

  return {
    appendSourceItem,
    updateSourceItem,
    appendSupportSource,
  };
}
