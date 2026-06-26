'use client';

import { COPY } from '@/lib/ui/copy';
import type { FeedItem, FeedItemType } from '@/types';

// ─── 类型标签映射 ────────────────────────────────────────────

const TYPE_LABELS: Record<FeedItemType, string> = {
  summary: COPY.feed.typeSummary,
  'probe-near': COPY.feed.typeProbeNear,
  'probe-lateral': COPY.feed.typeProbeLateral,
  'probe-bridge': COPY.feed.typeProbeBridge,
  'confusion-link': COPY.feed.typeConfusionLink,
};

const ACTION_LABELS: Record<string, string> = {
  'jump-timestamp': COPY.feed.actionJumpTimestamp,
  'make-flashcard': COPY.feed.actionMakeFlashcard,
  'ask-tutor': COPY.feed.actionAskTutor,
  'review-prev': COPY.feed.actionReviewPrev,
};

/**
 * 条目类型 → 左侧色条颜色
 * summary / probe-* = pine（AI 沉淀 / 场景上下文）
 * confusion-link = vermilion（学生此刻 / 个人上下文）
 */
function getAccentClass(type: FeedItemType): string {
  if (type === 'confusion-link') return 'bg-vermilion';
  return 'bg-pine';
}

/**
 * 条目类型 → 标签底色
 */
function getBadgeClass(type: FeedItemType): string {
  if (type === 'confusion-link') return 'bg-vermilion-fog text-vermilion-deep';
  if (type === 'summary') return 'bg-pine-fog text-pine-deep';
  return 'bg-pine-mist text-pine-light';
}

// ─── 组件 ────────────────────────────────────────────────────

interface FeedStreamProps {
  items: FeedItem[];
  isLoading: boolean;
  error: Error | null;
  onAction?: (item: FeedItem) => void;
  onRetry?: () => void;
}

export function FeedStream({ items, isLoading, error, onAction, onRetry }: FeedStreamProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="h-1 w-24 animate-pulse rounded-full bg-pine-mist" />
        <p className="text-[13px] text-ink-muted">{COPY.feed.loading}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <p className="text-[13px] text-vermilion">{COPY.feed.error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-divider bg-card px-4 py-2 text-[12px] font-medium text-ink-secondary transition-colors hover:border-ink-muted"
          >
            {COPY.feed.retry}
          </button>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[13px] text-ink-muted">{COPY.feed.empty}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item, index) => (
        <FeedCard key={`${item.type}-${index}`} item={item} onAction={onAction} />
      ))}
    </div>
  );
}

// ─── 单条卡片 ────────────────────────────────────────────────

interface FeedCardProps {
  item: FeedItem;
  onAction?: (item: FeedItem) => void;
}

function FeedCard({ item, onAction }: FeedCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-divider bg-card pl-4 pr-4 py-3.5">
      {/* 左侧色条 */}
      <div className={`absolute left-0 top-0 h-full w-[3px] ${getAccentClass(item.type)}`} />

      {/* 类型标签 */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${getBadgeClass(item.type)}`}>
          {TYPE_LABELS[item.type]}
        </span>
      </div>

      {/* 标题 */}
      <h4 className="text-[14px] font-semibold leading-snug text-ink">
        {item.title}
      </h4>

      {/* 正文 */}
      <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
        {item.body}
      </p>

      {/* 时间戳 chip */}
      {item.timestamps && item.timestamps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.timestamps.map((ts) => (
            <button
              key={ts}
              type="button"
              onClick={() => onAction?.({ ...item, actionType: 'jump-timestamp' })}
              className="inline-flex items-center rounded-md border border-divider bg-paper px-2 py-0.5 text-[11px] font-medium tabular-nums text-pine transition-colors hover:bg-pine-fog"
            >
              {ts}
            </button>
          ))}
        </div>
      )}

      {/* whyForYou */}
      {item.whyForYou && (
        <p className="mt-2 text-[11px] italic leading-relaxed text-vermilion-light">
          {COPY.feed.whyPrefix} · {item.whyForYou}
        </p>
      )}

      {/* 动作按钮 */}
      {item.actionLabel && item.actionType && (
        <button
          type="button"
          onClick={() => onAction?.(item)}
          className="mt-2.5 inline-flex items-center rounded-lg bg-pine-fog px-3 py-1.5 text-[12px] font-medium text-pine-deep transition-colors hover:bg-pine-mist"
        >
          {item.actionLabel || ACTION_LABELS[item.actionType]}
        </button>
      )}
    </div>
  );
}
