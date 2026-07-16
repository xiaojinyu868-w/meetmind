'use client';

/**
 * CollectionCard — 收集流卡片组件 v3（R9-2 顶级 UX 重做）
 *
 * 用户反馈整改：
 *   - 巨型缩略图喧宾夺主（aspect-video max-h-220 占满卡片宽度，一屏看 2-3 张）
 *     → 视频改横向布局：左 144×81 缩略图 + 右主体（标题/meta/状态），一屏看 6-8 张
 *   - 信息层级倒置（缩略图视觉权重 > 标题）
 *     → 标题升至 16px font-semibold，时间/状态徽章作为次要 meta
 *   - 大量 v6 hex 直写（#1C1B19/#FAF7F2/#D1F4E0/#B8842B/#FADEC9/#D3E4F4 等）
 *     → 全清，统一 v7 token（pine 主签名色家族 + ink/paper 灰阶）
 *   - 状态徽章用绿色 #D1F4E0 + 土黄 #B8842B（与 v7 双签名色冲突）
 *     → 已解析 = pine 主签名 / 解析中 = vermilion 朱批 + 呼吸动画
 *
 * 视觉决策（顶级产品参考 Linear / Pocket / Readwise / 即刻）：
 *   - 列表项 = 横向布局，密度优先
 *   - 缩略图是辅助识别，不是主角
 *   - hover 召唤 pine 主签名（"AI 在场"信号扩散到 capture 列表）
 */

import React from 'react';
import {
  MoreHorizontal,
  Play,
  Pause,
  BookOpen,
  FileText,
  Image as ImageIcon,
  ChevronRight,
} from 'lucide-react';
import type { SourceIngestItem } from '@/types/page-types';
import type { AudioPlaybackState } from '@/stores/collection-store';
import {
  getCollectionContextDisplayTitle,
} from '@/lib/capture/collection-context';
import {
  formatVoiceDurationCompact,
  getFileExtensionBadge,
  formatRelativeCollectionTime,
} from '@/lib/utils/page-utils';

// ==================== 类型定义 ====================

export interface CollectionCardProps {
  item: SourceIngestItem;
  /** 刚领取或刚恢复的内容：短暂显示 AI 在场微光，帮助用户确认落点。 */
  emphasized?: boolean;
  isCollectionContextSelectionMode: boolean;
  selectedCollectionContextIds: string[];
  audioPlaybackState: AudioPlaybackState | null;
  playingAudioMessageId: string | null;
  expandedAudioTranscriptId: string | null;
  onOpenMessageMenu: (itemId: string) => void;
  onBeginLongPress: (itemId: string) => void;
  onCancelLongPress: () => void;
  onToggleAudioPlayback: (item: SourceIngestItem) => Promise<void>;
  onToggleContextItem: (item: SourceIngestItem) => void;
  onSetExpandedAudioTranscriptId: (updater: string | null | ((prev: string | null) => string | null)) => void;
  onOpenReview: (item: SourceIngestItem) => Promise<void>;
  longPressTriggeredRef: React.MutableRefObject<boolean>;
}

// ==================== 辅助：类型标签（v7 双签名色家族） ====================
//
// 之前 5 个 type 各有独立配色（黄/绿/蓝/橙/灰），违背 v7 "双签名色 = 架构" 原则。
// 现在统一：媒体类（视频/音频）= pine 系，文字类（笔记）= ink-muted 中性，
// 资料类（图片/文档）= paper-warm + ink-secondary 克制。

import { COPY } from '@/lib/ui/copy';
import { getProvenanceSourceLabel } from '@/lib/capture/source-provenance';

function TypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    audio:    { label: COPY.sourceType.audio,    bg: 'bg-pine/[0.08]',     text: 'text-pine',           dot: 'bg-pine' },
    video:    { label: COPY.sourceType.video,    bg: 'bg-pine/[0.08]',     text: 'text-pine',           dot: 'bg-pine' },
    image:    { label: COPY.sourceType.image,    bg: 'bg-paper-warm',      text: 'text-ink-secondary',  dot: 'bg-ink-muted' },
    document: { label: COPY.sourceType.document, bg: 'bg-paper-warm',      text: 'text-ink-secondary',  dot: 'bg-ink-muted' },
    text:     { label: COPY.sourceType.text,     bg: 'bg-paper-warm',      text: 'text-ink-secondary',  dot: 'bg-ink-muted' },
  };
  const c = config[type] || config.text;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] font-mono text-[10px] font-medium tracking-[0.02em] ${c.bg} ${c.text}`}>
      <span className={`h-[4px] w-[4px] rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// ==================== 组件实现 ====================

export function CollectionCard({
  item,
  emphasized = false,
  isCollectionContextSelectionMode,
  selectedCollectionContextIds,
  audioPlaybackState,
  playingAudioMessageId,
  expandedAudioTranscriptId,
  onOpenMessageMenu,
  onBeginLongPress,
  onCancelLongPress,
  onToggleAudioPlayback,
  onToggleContextItem,
  onSetExpandedAudioTranscriptId,
  onOpenReview,
  longPressTriggeredRef,
}: CollectionCardProps) {
  const bubbleText = item.fullText?.trim() || item.preview?.trim() || item.title;
  const audioProgress =
    audioPlaybackState?.id === item.id
      ? Math.max(0, Math.min(1, audioPlaybackState.progress))
      : 0;
  const isAudioPlaying = playingAudioMessageId === item.id;
  const isAudioTranscriptOpen = expandedAudioTranscriptId === item.id;
  const fileExtensionBadge = getFileExtensionBadge(item.title);
  const isSelectedForContext = selectedCollectionContextIds.includes(item.id);
  const showAudioStatusText = Boolean(item.statusText) && item.status !== 'ready';
  const showVideoStatusText = Boolean(item.statusText) && item.status === 'failed';
  const showInlineStatus = Boolean(
    item.status === 'failed' && item.statusText && item.type !== 'audio' && item.type !== 'video'
  );
  const isAttachmentMessage = Boolean(item.attachmentUrl) && (item.type === 'document' || item.type === 'text');
  const provenanceLabel = getProvenanceSourceLabel(item.provenance);
  const showProvenanceState = isAttachmentMessage || item.type === 'document' || item.type === 'image';
  const provenanceStateLabel = !showProvenanceState
    ? ''
    : item.provenance?.contentState === 'extracting'
    ? COPY.sourceState.extracting
    : item.provenance?.contentState === 'complete'
      ? COPY.sourceState.complete
      : item.provenance?.contentState === 'partial'
        ? COPY.sourceState.partial
        : item.provenance?.contentState === 'link-only'
          ? COPY.sourceState.linkOnly
          : item.provenance?.contentState === 'failed'
            ? COPY.sourceState.failed
            : '';

  // 孤儿检测：视频/文档卡在 parsing 超过 10 分钟，判定为异常
  const STALE_PARSING_THRESHOLD_MS = 10 * 60 * 1000;
  const addedAtMs = item.addedAt ? new Date(item.addedAt).getTime() : NaN;
  const isStaleParsing = Boolean(
    item.status === 'parsing' &&
    !Number.isNaN(addedAtMs) &&
    Date.now() - addedAtMs > STALE_PARSING_THRESHOLD_MS &&
    !item.videoImported &&
    !item.sessionId
  );
  const showDocumentParsing = Boolean(
    (item.type === 'document' || item.type === 'image' || (item.type === 'text' && isAttachmentMessage)) &&
    item.status === 'parsing' &&
    item.statusText &&
    !isStaleParsing
  );

  const hasVideoThumbnail = item.type === 'video' && item.previewUrl;
  const hasVideoTranscript = Boolean(
    item.videoImported && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0
  );
  const showVideoParsing =
    item.type === 'video' &&
    !item.videoImported &&
    !item.sessionId &&
    item.status !== 'failed' &&
    (item.reviewable || item.status === 'parsing');

  return (
    <div
      className={`group relative rounded-2xl bg-card transition-all duration-200 ${emphasized ? 'surface-ai' : ''}
        ${emphasized
          ? 'ring-[1.5px] ring-pine/35'
          : isSelectedForContext
          ? 'ring-[1.5px] ring-pine/40 bg-pine/[0.03]'
          : 'ring-[0.5px] ring-ink/[0.06] hover:ring-pine/25 hover:bg-paper-warm/40'
        }`}
      onContextMenu={(event) => {
        if (!isCollectionContextSelectionMode) {
          event.preventDefault();
          onOpenMessageMenu(item.id);
        }
      }}
      onTouchStart={
        !isCollectionContextSelectionMode
          ? () => onBeginLongPress(item.id)
          : undefined
      }
      onTouchEnd={onCancelLongPress}
      onTouchCancel={onCancelLongPress}
      onTouchMove={onCancelLongPress}
      onClickCapture={(event) => {
        if (!longPressTriggeredRef.current) return;
        longPressTriggeredRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {/* ── 视频类型：R9-2 顶级 UX 横向布局（左小缩略图 + 右主体）── */}
      {item.type === 'video' ? (
        <div className="flex items-stretch gap-3.5 px-3 py-3">
          {/* 左：紧凑视频缩略图 144×81（保留 16:9，但缩到合理尺寸） */}
          {hasVideoThumbnail ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
              className="relative flex-shrink-0 overflow-hidden rounded-xl bg-paper-warm transition-transform group-hover:scale-[0.99]"
              aria-label={`播放 ${item.title}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt={item.title}
                className="block h-[81px] w-[144px] object-cover"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              {/* 中央播放按钮 — 仅 hover 显，避免视觉污染 */}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/0 opacity-0 transition-all duration-200 group-hover:bg-ink/30 group-hover:opacity-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card/95 text-pine shadow-card backdrop-blur-sm">
                  <Play size={14} className="ml-0.5" fill="currentColor" />
                </span>
              </span>
              {/* 右下角时长 */}
              {item.durationMs ? (
                <span className="absolute bottom-1.5 right-1.5 rounded bg-ink/75 px-1.5 py-[1px] font-mono text-[10px] font-medium tabular-nums text-white">
                  {formatVoiceDurationCompact(item.durationMs)}
                </span>
              ) : null}
            </button>
          ) : (
            // 无缩略图：占位 icon
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
              className="flex h-[81px] w-[144px] flex-shrink-0 items-center justify-center rounded-xl bg-pine/[0.06] text-pine transition-all hover:bg-pine/[0.10]"
            >
              <Play size={20} className="ml-0.5" fill="currentColor" />
            </button>
          )}

          {/* 右：主体 — 标题为视觉中心，meta/状态为辅助 */}
          <div className="min-w-0 flex-1 py-0.5">
            {/* 顶行：TypeBadge + time + provider + 操作 */}
            <div className="mb-1.5 flex items-center gap-2">
              <TypeBadge type="video" />
              <span className="font-mono text-[10.5px] tabular-nums text-ink-muted">
                {formatRelativeCollectionTime(item.addedAt)}
              </span>
              {provenanceLabel || item.videoProvider ? (
                <>
                  <span className="text-ink-muted/40">·</span>
                  <span className="text-[11px] text-ink-muted">{provenanceLabel || item.videoProvider}</span>
                </>
              ) : null}
              <div className="ml-auto flex flex-shrink-0 items-center">
                {isCollectionContextSelectionMode ? (
                  <button
                    type="button"
                    onClick={() => onToggleContextItem(item)}
                    aria-pressed={isSelectedForContext}
                    className={`rounded-full px-2.5 py-[3px] text-[11px] font-medium transition-all ${
                      isSelectedForContext
                        ? 'bg-pine text-white'
                        : 'bg-paper-warm text-ink-secondary hover:bg-pine/10 hover:text-pine'
                    }`}
                  >
                    {isSelectedForContext ? '已选' : '选择'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenMessageMenu(item.id); }}
                    className="rounded-md p-1 text-ink-muted/60 opacity-0 transition-all hover:bg-paper-warm hover:text-ink-secondary group-hover:opacity-100"
                    aria-label={`操作：${getCollectionContextDisplayTitle(item, 36)}`}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* 标题 — 视觉中心，line-clamp-2 处理长标题 */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
              className="block w-full text-left"
            >
              <p className="line-clamp-2 text-[14.5px] font-medium leading-snug tracking-[-0.01em] text-ink transition-colors group-hover:text-pine">
                {item.title}
              </p>
            </button>

            {/* 底行：状态徽章 — 已解析 / 解析中 / 失败 */}
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              {showVideoStatusText ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-vermilion/[0.08] px-2 py-[2px] font-medium text-vermilion">
                  <span className="h-1.5 w-1.5 rounded-full bg-vermilion" />
                  {item.statusText}
                </span>
              ) : hasVideoTranscript ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-pine/[0.08] px-2 py-[2px] font-medium text-pine transition-all hover:bg-pine/[0.14]"
                >
                  <BookOpen size={11} strokeWidth={2} />
                  <span>已解析 · {item.serverTranscriptSegments!.length}句</span>
                  <ChevronRight size={11} strokeWidth={2} className="ml-0.5" />
                </button>
              ) : isStaleParsing ? (
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-vermilion/70" />
                  <span>解析未完成，换个浏览器再试</span>
                </span>
              ) : showVideoParsing ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-warm px-2 py-[2px] font-medium text-ink-secondary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pine" />
                  <span>{item.statusText || '正在整理这节课…'}</span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        // ── 非视频类型：原有 padding box（feed 样式）──
        <div className="px-4 pb-3 pt-3">
          {/* 顶栏：TypeBadge + 时间 + 操作 */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <TypeBadge type={item.type} />
              <span className="font-mono text-[10.5px] tabular-nums text-ink-muted">
                {formatRelativeCollectionTime(item.addedAt)}
              </span>
              {provenanceLabel ? (
                <>
                  <span className="text-ink-muted/40">·</span>
                  <span className="truncate text-[11px] text-ink-muted">{provenanceLabel}</span>
                </>
              ) : null}
              {provenanceStateLabel ? (
                <span className="rounded-full bg-paper-warm px-1.5 py-0.5 text-[9px] text-ink-muted">
                  {provenanceStateLabel}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isCollectionContextSelectionMode ? (
                <button
                  type="button"
                  onClick={() => onToggleContextItem(item)}
                  aria-pressed={isSelectedForContext}
                  className={`rounded-full px-2.5 py-[3px] text-[11px] font-medium transition-all ${
                    isSelectedForContext
                      ? 'bg-pine text-white'
                      : 'bg-paper-warm text-ink-secondary hover:bg-pine/10 hover:text-pine'
                  }`}
                >
                  {isSelectedForContext ? '已选' : '选择'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onOpenMessageMenu(item.id); }}
                  className="rounded-md p-1 text-ink-muted/60 opacity-0 transition-all hover:bg-paper-warm hover:text-ink-secondary group-hover:opacity-100"
                  aria-label={`操作：${getCollectionContextDisplayTitle(item, 36)}`}
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            </div>
          </div>

          {/* 文字类型 */}
          {item.type === 'text' && !isAttachmentMessage ? (
            <p className="whitespace-pre-wrap text-[14px] leading-[1.75] text-ink">
              {bubbleText}
            </p>
          ) : null}

          {/* 音频类型 — 胶囊播放器 */}
          {item.type === 'audio' ? (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => void onToggleAudioPlayback(item)}
                disabled={!item.mediaUrl}
                aria-label={isAudioPlaying ? '暂停音频' : '播放音频'}
                aria-disabled={!item.mediaUrl}
                className="inline-flex items-center gap-3 rounded-2xl bg-paper-warm px-3 py-2.5 transition hover:bg-paper-deep disabled:opacity-50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pine text-white">
                  {isAudioPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" fill="currentColor" />}
                </span>
                {/* 波形条 */}
                <span className="relative flex h-5 w-[100px] items-center">
                  <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 rounded-full bg-divider" />
                  <span
                    className="absolute left-0 top-1/2 h-[1.5px] -translate-y-1/2 rounded-full bg-pine transition-all duration-300"
                    style={{ width: `${Math.max(4, audioProgress * 100)}%` }}
                  />
                  <span className="relative z-10 flex w-full items-end justify-between px-0.5">
                    {[6, 10, 14, 8, 13, 7, 11, 9, 10, 6, 12].map((h, i) => (
                      <span
                        key={`wave-${item.id}-${i}`}
                        className="w-[2px] rounded-full transition-opacity duration-200"
                        style={{
                          height: `${h}px`,
                          backgroundColor: i / 10 < audioProgress ? 'var(--pine, #2D4F3E)' : 'var(--ink-muted, #5C5A55)',
                          opacity: i / 10 < audioProgress ? 0.85 : 0.3,
                        }}
                      />
                    ))}
                  </span>
                </span>
                <span className="font-mono text-[11.5px] font-medium tabular-nums text-ink-secondary">
                  {formatVoiceDurationCompact(
                    audioPlaybackState?.id === item.id && audioPlaybackState.duration > 0
                      ? audioPlaybackState.duration * 1000
                      : item.durationMs
                  )}
                </span>
              </button>

              <div className="flex items-center gap-2 text-[11px] text-ink-muted">
                {showAudioStatusText ? (
                  <span className="font-medium">{item.statusText}</span>
                ) : null}
                {item.segmentCount > 0 && item.fullText?.trim() ? (
                  <button
                    type="button"
                    onClick={() =>
                      onSetExpandedAudioTranscriptId((prev) => (prev === item.id ? null : item.id))
                    }
                    className="rounded-full px-2 py-[2px] text-ink-secondary transition-all hover:bg-paper-warm hover:text-pine"
                  >
                    {isAudioTranscriptOpen ? '收起文字' : '查看文字'}
                  </button>
                ) : null}
              </div>

              {isAudioTranscriptOpen && item.segmentCount > 0 && item.fullText?.trim() ? (
                <div className="rounded-xl bg-paper-warm px-3.5 py-3">
                  <p className="text-[13.5px] leading-[1.75] text-ink">{bubbleText}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 图片类型 */}
          {item.type === 'image' ? (
            <div>
              {item.previewUrl ? (
                <a
                  href={item.attachmentUrl || item.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt={item.title}
                    className="max-h-48 w-auto max-w-full rounded-xl object-cover"
                  />
                </a>
              ) : (
                <div className="flex items-center gap-2.5 rounded-xl bg-paper-warm px-3 py-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-paper-deep text-ink-secondary">
                    <ImageIcon size={14} />
                  </span>
                  <p className="truncate text-[13.5px] text-ink">{item.title}</p>
                </div>
              )}
            </div>
          ) : null}

          {/* 文档/附件类型 */}
          {(item.type === 'document' || isAttachmentMessage) ? (
            <div className="space-y-2">
              {item.attachmentUrl ? (
                <a
                  href={item.attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl bg-paper-warm px-3.5 py-3 transition-all hover:bg-paper-deep"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-card text-ink-secondary ring-1 ring-divider">
                    <FileText size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{item.title}</p>
                    {fileExtensionBadge ? (
                      <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.04em] text-ink-muted">{fileExtensionBadge}</p>
                    ) : null}
                  </div>
                  <ChevronRight size={13} className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
                </a>
              ) : (
                <div className="flex items-center gap-2.5 rounded-xl bg-paper-warm px-3 py-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-card text-ink-secondary ring-1 ring-divider">
                    <FileText size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] text-ink">{item.title}</p>
                    {fileExtensionBadge ? <p className="font-mono text-[10.5px] uppercase text-ink-muted">{fileExtensionBadge}</p> : null}
                  </div>
                </div>
              )}
              {showDocumentParsing ? (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-warm px-2 py-[2px] font-medium text-ink-secondary">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pine" />
                    <span>{item.statusText}</span>
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 底部状态（失败提示） */}
          {showInlineStatus ? (
            <div className="mt-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-vermilion/[0.08] px-2 py-[2px] text-[11px] font-medium text-vermilion">
                <span className="h-1.5 w-1.5 rounded-full bg-vermilion" />
                {item.statusText}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CollectionCard;
