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
  'bili-recommend': COPY.feed.typeBiliRecommend,
  echo: COPY.feed.typeEcho,
};

const ACTION_LABELS: Record<string, string> = {
  'jump-timestamp': COPY.feed.actionJumpTimestamp,
  'make-flashcard': COPY.feed.actionMakeFlashcard,
  'ask-tutor': COPY.feed.actionAskTutor,
  'review-prev': COPY.feed.actionReviewPrev,
  'open-capture': COPY.feed.actionOpenCapture,
  'open-bilibili': COPY.feed.actionOpenBilibili,
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
  /** echo 沉淀卡分享回调（按 echoId） */
  onShareEcho?: (echoId: string) => void;
}

export function FeedStream({ items, isLoading, error, onAction, onRetry, onShareEcho }: FeedStreamProps) {
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
        <FeedCard key={`${item.type}-${index}`} item={item} onAction={onAction} onShareEcho={onShareEcho} />
      ))}
    </div>
  );
}

// ─── 单条卡片 ────────────────────────────────────────────────

interface FeedCardProps {
  item: FeedItem;
  onAction?: (item: FeedItem) => void;
  onShareEcho?: (echoId: string) => void;
}

function FeedCard({ item, onAction, onShareEcho }: FeedCardProps) {
  // B站视频推荐卡（封面 + UP + 推荐理由）
  if (item.type === 'bili-recommend') {
    const url = item.contentUrl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '');
    return (
      <a
        href={url || undefined}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => { if (!url) e.preventDefault(); onAction?.({ ...item, actionType: 'open-bilibili' }); }}
        className="flex gap-3 rounded-xl border border-divider bg-card p-3 transition-colors hover:border-pine/30 hover:bg-paper"
      >
        {item.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.coverUrl}
            alt=""
            className="h-[60px] w-[106px] flex-shrink-0 rounded-lg object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">
            {item.title}
          </p>
          {item.upName && (
            <p className="mt-0.5 text-[11px] text-ink-muted">{item.upName}</p>
          )}
          {item.body && (
            <p className="mt-1 line-clamp-2 text-[11px] italic leading-relaxed text-pine-light">
              {item.body}
            </p>
          )}
          {item.topicLabel && (
            <span className="mt-1 inline-block rounded-md bg-pine-fog px-1.5 py-0.5 text-[10px] font-medium text-pine-deep">
              {item.topicLabel}
            </span>
          )}
        </div>
      </a>
    );
  }

  // Echo 沉淀卡（并入信息流）
  if (item.type === 'echo') {
    return (
      <div className="relative overflow-hidden rounded-xl border border-divider bg-card pl-4 pr-4 py-3.5">
        <div className="absolute left-0 top-0 h-full w-[3px] bg-pine" />
        <div className="mb-1.5 flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-pine-fog px-1.5 py-0.5 text-[10px] font-medium text-pine-deep">
            {TYPE_LABELS.echo}
          </span>
        </div>
        <h4 className="text-[14px] font-semibold leading-snug text-ink">
          {item.title}
        </h4>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
          {item.body}
        </p>
        {item.takeaway && (
          <p className="mt-2 text-[12px] leading-relaxed text-pine">
            {item.takeaway}
          </p>
        )}
        {item.echoHighlights && item.echoHighlights.length > 0 && (
          <ul className="mt-2 space-y-1">
            {item.echoHighlights.slice(0, 3).map((h, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-ink-secondary">
                <span className="cite-src mono">{h.timestamp ? `[${h.timestamp}]` : '·'}</span>{' '}
                {h.text}
              </li>
            ))}
          </ul>
        )}
        {item.echoId && onShareEcho && (
          <button
            type="button"
            onClick={() => onShareEcho(item.echoId!)}
            className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-divider bg-paper px-2.5 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:border-pine/40 hover:text-pine"
          >
            {COPY.feed.shareEcho}
          </button>
        )}
      </div>
    );
  }

  // 默认：LLM 生成的 summary / probe-* / confusion-link 卡
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

      {/* 时间戳 chip（仅单课遗留 summary/confusion-link 才有） */}
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
