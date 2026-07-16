'use client';

import { useState } from 'react';
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { recordFeedPreference } from '@/lib/feed-preferences';
import { readStoredAccessToken } from '@/lib/hooks/useAuth';
import type { FeedContentKind, FeedItem, FeedItemType, FeedPerspective } from '@/types';
import { buildFeedSequence } from './feed-stream-model';

// ─── 类型标签映射 ────────────────────────────────────────────

const TYPE_LABELS: Record<FeedItemType, string> = {
  summary: COPY.feed.typeSummary,
  'probe-near': COPY.feed.typeProbeNear,
  'probe-lateral': COPY.feed.typeProbeLateral,
  'probe-bridge': COPY.feed.typeProbeBridge,
  'confusion-link': COPY.feed.typeConfusionLink,
  'web-recommend': COPY.feed.typeWebRecommend,
  'bili-recommend': COPY.feed.typeBiliRecommend,
  echo: COPY.feed.typeEcho,
};

const ACTION_LABELS: Record<string, string> = {
  'jump-timestamp': COPY.feed.actionJumpTimestamp,
  'make-flashcard': COPY.feed.actionMakeFlashcard,
  'ask-tutor': COPY.feed.actionAskTutor,
  'review-prev': COPY.feed.actionReviewPrev,
  'open-capture': COPY.feed.actionOpenCapture,
  'open-external': COPY.feed.actionOpenExternal,
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
  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="h-1 w-24 animate-pulse rounded-full bg-pine-mist" />
        <p className="text-[13px] text-ink-muted">{COPY.feed.loading}</p>
      </div>
    );
  }

  if (error && items.length === 0) {
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

  const orderedItems = buildFeedSequence(items);

  return (
    <div className="flex flex-col gap-2.5 pb-4">
      {orderedItems.map((item, index) => (
        <FeedCard
          key={`${item.type}-${item.bvid || item.echoId || item.captureId || item.title}-${index}`}
          item={item}
          onAction={onAction}
          onShareEcho={onShareEcho}
        />
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
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  const submitFeedback = (rating: 'up' | 'down') => {
    setFeedback(rating);
    recordFeedPreference(item, rating);
    const identity = item.bvid || item.echoId || item.captureId || item.title;
    const accessToken = readStoredAccessToken();
    void fetch('/api/feedback/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        messageId: `feed:${item.type}:${identity}`,
        rating,
        mode: 'intelligence-feed',
        messageText: `${item.title}\n${item.body}\n${item.whyForYou || ''}`.slice(0, 1000),
      }),
    }).catch(() => undefined);
  };

  if (feedback === 'down') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-divider/70 bg-paper px-3.5 py-3 text-[11px] text-ink-muted">
        <Check size={13} className="text-pine" />
        {COPY.feed.feedbackDismissed}
      </div>
    );
  }

  // 外部资料卡：MeetMind 服务端自动检索，不要求用户安装插件。
  if (item.type === 'web-recommend' || item.type === 'bili-recommend') {
    const url = item.contentUrl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : '');
    const sourceMeta = [
      item.authors?.slice(0, 2).join('、'),
      item.publishedAt,
      item.upName,
    ].filter(Boolean).join(' · ');
    return (
      <div className="rounded-xl border border-divider bg-card p-3 transition-colors hover:border-pine/30">
        <a
          href={url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            if (url) return;
            event.preventDefault();
            onAction?.({ ...item, actionType: item.type === 'web-recommend' ? 'open-external' : 'open-bilibili' });
          }}
          className="flex gap-3"
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
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md bg-pine-fog px-1.5 py-0.5 text-[10px] font-medium text-pine-deep">
                {getContentKindLabel(item.contentKind)}
              </span>
              {item.perspective ? (
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${item.perspective === 'counterpoint' ? 'bg-vermilion-mist text-vermilion' : 'bg-paper text-ink-muted'}`}>
                  {getPerspectiveLabel(item.perspective)}
                </span>
              ) : null}
            </div>
            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{item.title}</p>
            {sourceMeta && <p className="mt-1 line-clamp-1 text-[10.5px] text-ink-muted">{sourceMeta}</p>}
            {item.topicLabel && (
              <span className="mt-1 inline-block rounded-md bg-pine-fog px-1.5 py-0.5 text-[10px] font-medium text-pine-deep">
                {item.topicLabel}
              </span>
            )}
          </div>
        </a>
        {item.body && <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-ink-secondary">{item.body}</p>}
        {item.whyForYou && (
          <div className="mt-2.5 rounded-lg bg-vermilion-mist/40 px-2.5 py-2">
            <p className="text-[10px] font-medium text-vermilion">
              {item.perspective === 'counterpoint' ? COPY.feed.differentPerspectivePrefix : COPY.feed.whyPrefix}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">{item.whyForYou}</p>
            {(item.sourceCaptureIds?.length || item.goalLabel) ? (
              <p className="mt-1 text-[10px] text-ink-muted">
                {item.sourceCaptureIds?.length ? COPY.feed.sourceCount(item.sourceCaptureIds.length) : ''}
                {item.sourceCaptureIds?.length && item.goalLabel ? ' · ' : ''}
                {item.goalLabel ? COPY.feed.goalAlignment(item.goalLabel) : ''}
              </p>
            ) : null}
          </div>
        )}
        <FeedFeedback feedback={feedback} onFeedback={submitFeedback} />
      </div>
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
        <FeedFeedback feedback={feedback} onFeedback={submitFeedback} />
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
        <div className="mt-2 rounded-lg bg-vermilion-mist/40 px-2.5 py-2 text-[11px] leading-relaxed text-vermilion-light">
          <span className="font-medium">{COPY.feed.whyPrefix}</span> · {item.whyForYou}
          {(item.sourceCaptureIds?.length || item.goalLabel) ? (
            <p className="mt-1 text-[10px] text-ink-muted">
              {item.sourceCaptureIds?.length ? COPY.feed.sourceCount(item.sourceCaptureIds.length) : ''}
              {item.sourceCaptureIds?.length && item.goalLabel ? ' · ' : ''}
              {item.goalLabel ? COPY.feed.goalAlignment(item.goalLabel) : ''}
            </p>
          ) : null}
        </div>
      )}

      {/* 动作按钮 */}
      {item.actionType && (
        <button
          type="button"
          onClick={() => onAction?.(item)}
          className="mt-2.5 inline-flex items-center rounded-lg bg-pine-fog px-3 py-1.5 text-[12px] font-medium text-pine-deep transition-colors hover:bg-pine-mist"
        >
          {item.actionLabel || ACTION_LABELS[item.actionType]}
        </button>
      )}
      <FeedFeedback feedback={feedback} onFeedback={submitFeedback} />
    </div>
  );
}

function getContentKindLabel(kind: FeedContentKind | undefined): string {
  if (kind === 'paper') return COPY.feed.kindPaper;
  if (kind === 'book') return COPY.feed.kindBook;
  if (kind === 'report') return COPY.feed.kindReport;
  return COPY.feed.kindWeb;
}

function getPerspectiveLabel(perspective: FeedPerspective): string {
  if (perspective === 'deepen') return COPY.feed.perspectiveDeepen;
  if (perspective === 'counterpoint') return COPY.feed.perspectiveCounterpoint;
  return COPY.feed.perspectiveAdjacent;
}

function FeedFeedback({
  feedback,
  onFeedback,
}: {
  feedback: 'up' | 'down' | null;
  onFeedback: (rating: 'up' | 'down') => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-1.5 border-t border-divider/60 pt-2.5">
      <button
        type="button"
        onClick={() => onFeedback('up')}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] transition-colors ${feedback === 'up' ? 'bg-pine-fog text-pine-deep' : 'text-ink-muted hover:bg-paper hover:text-ink-secondary'}`}
      >
        <ThumbsUp size={11} />
        {feedback === 'up' ? COPY.feed.feedbackUseful : COPY.feed.useful}
      </button>
      <button
        type="button"
        onClick={() => onFeedback('down')}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-ink-muted transition-colors hover:bg-paper hover:text-ink-secondary"
      >
        <ThumbsDown size={11} />
        {COPY.feed.notRelevant}
      </button>
    </div>
  );
}
