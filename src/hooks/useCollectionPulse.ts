'use client';

import { useEffect, useMemo, type RefObject } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
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
    if (audioCount > 0) chips.push(`${audioCount} 段课堂录音`);
    if (documentCount > 0) chips.push(`${documentCount} 份材料`);
    if (imageCount > 0) chips.push(`${imageCount} 张图片材料`);
    if (textCount > 0) chips.push(`${textCount} 条你的想法`);
    if (videoCount > 0) chips.push(`${videoCount} 个视频来源`);

    if (showMobileRecorder || isRecording) {
      return {
        title: '正在整理',
        body: '这段语音正在和前面的内容接到同一条学习线索里，你不用先整理它。',
        chips: chips.slice(0, 3),
        actions: [],
      };
    }

    if (primaryCount > 0 && supportCount > 0) {
      return {
        title: '新的整理提示',
        body: '你已经把课堂录音和补充材料放进了同一条线索。后面不需要总结，继续轻轻往里加就行。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'continue-voice', label: '再录一段' },
          { key: 'capture-confusion', label: '补一句困惑' },
        ],
      };
    }

    if (audioCount >= 2) {
      return {
        title: '新的整理提示',
        body: '你已经连续留下了几段课堂录音，这节课的主线开始显出来了。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'capture-confusion', label: '记下没懂的点' },
          { key: 'add-material', label: '贴一份讲义' },
        ],
      };
    }

    if (audioCount > 0 && textCount > 0) {
      return {
        title: '新的整理提示',
        body: '你不只是在收课堂内容，也已经留下了自己的理解或困惑，这会让后面的同桌更有抓手。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'continue-voice', label: '继续录音' },
          { key: 'add-material', label: '补充材料' },
        ],
      };
    }

    if (latestItem.type === 'document' || latestItem.type === 'image' || latestItem.type === 'video') {
      return {
        title: '新的整理提示',
        body: '这份材料已经接进来了。后面再补一句当时没懂的地方，同桌会更容易看出联系。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'capture-confusion', label: '记下没懂的点' },
          { key: 'continue-voice', label: '录一段语音' },
        ],
      };
    }

    if (latestItem.type === 'audio') {
      return {
        title: '新的整理提示',
        body: '这段录音已经留下来了。先别急着整理，继续往里丢材料或困惑，会更有价值。',
        chips: chips.slice(0, 3),
        actions: [
          { key: 'capture-confusion', label: '补一句困惑' },
          { key: 'add-material', label: '贴一份材料' },
        ],
      };
    }

    return {
      title: '新的整理提示',
      body: '这条收集流已经开始有自己的形状了。继续轻轻追加，不用一次说完整。',
      chips: chips.slice(0, 3),
      actions: [
        { key: 'continue-voice', label: '继续录音' },
        { key: 'capture-confusion', label: '写一句想法' },
      ],
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

    const typeLabelMap: Record<string, string> = {
      audio: '录音',
      video: '视频',
      image: '图片',
      document: '材料',
      text: '想法',
    };

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
