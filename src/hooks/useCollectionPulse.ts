'use client';

import { useEffect, useMemo, type RefObject } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { COPY } from '@/lib/ui/copy';
import type { SourceIngestItem, CollectionPulseState } from '@/types/page-types';

// ─── Types ───────────────────────────────────────────────────────────────

export interface UseCollectionPulseDeps {
  /** Sorted collection feed items (from useCollectionComposer) */
  collectionFeedItems: SourceIngestItem[];
}

export interface UseCollectionPulseRefs {
  /** Tracks the last shown pulse signature to avoid re-showing */
  lastCollectionPulseSignatureRef: RefObject<string>;
  /** When true, suppress the next pulse preview auto-show */
  suppressNextCollectionPulsePreviewRef: RefObject<boolean>;
}

// ─── Hook ────────────────────────────────────────────────────────────────

export function useCollectionPulse(
  deps: UseCollectionPulseDeps,
  refs: UseCollectionPulseRefs,
) {
  const { collectionFeedItems } = deps;
  const { lastCollectionPulseSignatureRef, suppressNextCollectionPulsePreviewRef } = refs;

  // ── Store selectors ──────────────────────────────────────────────────
  const captureDrivenPulse = useCollectionStore((s) => s.captureDrivenPulse);
  const setShowCollectionPulsePreview = useCollectionStore((s) => s.actions).setShowCollectionPulsePreview;

  const isRecording = useSessionStore((s) => s.isRecording);
  const showMobileRecorder = useUIStore((s) => s.showMobileRecorder);

  // ── Derived: collectionPulse ─────────────────────────────────────────
  const collectionPulse = useMemo<CollectionPulseState | null>(() => {
    if (captureDrivenPulse) {
      return captureDrivenPulse;
    }

    if (collectionFeedItems.length === 0) return null;

    const latestItem = collectionFeedItems[collectionFeedItems.length - 1];
    const primaryCount = collectionFeedItems.filter((item) => item.role === 'primary').length;
    const supportCount = collectionFeedItems.filter((item) => item.role === 'support').length;
    const audioCount = collectionFeedItems.filter((item) => item.type === 'audio').length;
    const textCount = collectionFeedItems.filter((item) => item.type === 'text').length;
    const documentCount = collectionFeedItems.filter((item) => item.type === 'document').length;
    const imageCount = collectionFeedItems.filter((item) => item.type === 'image').length;
    const videoCount = collectionFeedItems.filter((item) => item.type === 'video').length;

    const chips: string[] = [];
    if (audioCount > 0) chips.push(COPY.collection.pulse.chipAudio(audioCount));
    if (documentCount > 0) chips.push(COPY.collection.pulse.chipDocument(documentCount));
    if (imageCount > 0) chips.push(COPY.collection.pulse.chipImage(imageCount));
    if (textCount > 0) chips.push(COPY.collection.pulse.chipText(textCount));
    if (videoCount > 0) chips.push(COPY.collection.pulse.chipVideo(videoCount));

    if (showMobileRecorder || isRecording) {
      return {
        title: COPY.collection.pulse.recording.title,
        body: COPY.collection.pulse.recording.body,
        chips: chips.slice(0, 3),
        actions: [],
      };
    }

    if (primaryCount > 0 && supportCount > 0) {
      return {
        title: COPY.collection.pulse.primaryAndSupport.title,
        body: COPY.collection.pulse.primaryAndSupport.body,
        chips: chips.slice(0, 3),
        actions: [...COPY.collection.pulse.primaryAndSupport.actions],
      };
    }

    if (audioCount >= 2) {
      return {
        title: COPY.collection.pulse.audioMany.title,
        body: COPY.collection.pulse.audioMany.body,
        chips: chips.slice(0, 3),
        actions: [...COPY.collection.pulse.audioMany.actions],
      };
    }

    if (audioCount > 0 && textCount > 0) {
      return {
        title: COPY.collection.pulse.audioAndText.title,
        body: COPY.collection.pulse.audioAndText.body,
        chips: chips.slice(0, 3),
        actions: [...COPY.collection.pulse.audioAndText.actions],
      };
    }

    if (latestItem.type === 'document' || latestItem.type === 'image' || latestItem.type === 'video') {
      return {
        title: COPY.collection.pulse.materialAdded.title,
        body: COPY.collection.pulse.materialAdded.body,
        chips: chips.slice(0, 3),
        actions: [...COPY.collection.pulse.materialAdded.actions],
      };
    }

    if (latestItem.type === 'audio') {
      return {
        title: COPY.collection.pulse.audioAdded.title,
        body: COPY.collection.pulse.audioAdded.body,
        chips: chips.slice(0, 3),
        actions: [...COPY.collection.pulse.audioAdded.actions],
      };
    }

    return {
      title: COPY.collection.pulse.fallback.title,
      body: COPY.collection.pulse.fallback.body,
      chips: chips.slice(0, 3),
      actions: [...COPY.collection.pulse.fallback.actions],
    };
  }, [captureDrivenPulse, collectionFeedItems, isRecording, showMobileRecorder]);

  // ── Derived: collectionPulseSignature ────────────────────────────────
  const collectionPulseSignature = useMemo(() => {
    if (!collectionPulse) return '';
    return [
      collectionPulse.title,
      collectionPulse.body,
      collectionPulse.chips.join('|'),
      (collectionPulse.actions || []).map((action) => action.key).join('|'),
    ].join('::');
  }, [collectionPulse]);

  // ── Derived: captureActivitySummary ──────────────────────────────────
  const captureActivitySummary = useMemo(() => {
    const now = new Date();
    const dayKeys = new Map<string, number>();

    collectionFeedItems.forEach((item) => {
      const date = new Date(item.addedAt);
      if (Number.isNaN(date.getTime())) {
        return;
      }
      const key = date.toISOString().slice(0, 10);
      dayKeys.set(key, (dayKeys.get(key) || 0) + 1);
    });

    const tiles = Array.from({ length: 28 }, (_, index) => {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(now.getDate() - (27 - index));
      const key = date.toISOString().slice(0, 10);
      const count = dayKeys.get(key) || 0;
      return {
        key,
        count,
      };
    });

    const activeDays = tiles.filter((tile) => tile.count > 0).length;

    let streak = 0;
    for (let index = tiles.length - 1; index >= 0; index -= 1) {
      if (tiles[index].count > 0) {
        streak += 1;
      } else {
        break;
      }
    }

    const kindCounts = collectionFeedItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.type] = (acc[item.type] || 0) + 1;
      return acc;
    }, {});

    const typeLabelMap: Record<string, string> = COPY.collection.activityKind;

    const topKinds = Object.entries(kindCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type]) => typeLabelMap[type] || type);

    return {
      totalCount: collectionFeedItems.length,
      activeDays,
      streak,
      tiles,
      topKinds,
    };
  }, [collectionFeedItems]);

  // ── Auto-show/hide pulse preview effect ──────────────────────────────
  useEffect(() => {
    if (!collectionPulseSignature || isRecording || showMobileRecorder) {
      setShowCollectionPulsePreview(false);
      return;
    }

    if ((suppressNextCollectionPulsePreviewRef as React.MutableRefObject<boolean>).current) {
      (suppressNextCollectionPulsePreviewRef as React.MutableRefObject<boolean>).current = false;
      (lastCollectionPulseSignatureRef as React.MutableRefObject<string>).current = collectionPulseSignature;
      setShowCollectionPulsePreview(false);
      return;
    }

    if ((lastCollectionPulseSignatureRef as React.RefObject<string>).current === collectionPulseSignature) {
      return;
    }

    (lastCollectionPulseSignatureRef as React.MutableRefObject<string>).current = collectionPulseSignature;
    setShowCollectionPulsePreview(true);
    const timer = window.setTimeout(() => {
      setShowCollectionPulsePreview(false);
    }, 3600);

    return () => window.clearTimeout(timer);
  }, [collectionPulseSignature, isRecording, showMobileRecorder, lastCollectionPulseSignatureRef, suppressNextCollectionPulsePreviewRef, setShowCollectionPulsePreview]);

  return {
    collectionPulse,
    collectionPulseSignature,
    captureActivitySummary,
  };
}
