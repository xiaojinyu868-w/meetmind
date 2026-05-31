'use client';

/**
 * CollectionCard — 收集流卡片组件 v2
 *
 * 设计升级：
 * - 独立白底圆角卡片（rounded-2xl / 16px），不再是 border-b 列表
 * - Whisper border：rgba(0,0,0,0.06) — 几乎不可见的呼吸边界
 * - Hover 微交互：边框加深 + 背景微变
 * - TypeBadge 药丸化：rounded-full + 更柔和的色彩
 * - 音频播放器胶囊：圆润的进度条 + 更精致的波形
 * - 视频缩略图：顶部贴合圆角裁切
 * - 遵循 MeetMind 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
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

// ==================== 辅助：类型标签（药丸风格） ====================

function TypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; bg: string; text: string; dot: string }> = {
    audio:    { label: '录音', bg: 'bg-[#FDF3C0]/60', text: 'text-[#2D4F3E]', dot: 'bg-[#B8842B]' },
    video:    { label: '视频', bg: 'bg-pine-fog', text: 'text-pine', dot: 'bg-pine' },
    image:    { label: '图片', bg: 'bg-[#D3E4F4]/60', text: 'text-[#1E5F8A]', dot: 'bg-[#2D4F3E]' },
    document: { label: '讲义', bg: 'bg-[#FADEC9]/60', text: 'text-[#5C5A55]', dot: 'bg-[#B8842B]' },
    text:     { label: '笔记', bg: 'bg-[#F0EBDF]',    text: 'text-[#5C5A55]', dot: 'bg-[#8E8B82]' },
  };
  const c = config[type] || config.text;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-medium tracking-wide ${c.bg} ${c.text}`}>
      <span className={`h-[5px] w-[5px] rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// ==================== 组件实现 ====================

export function CollectionCard({
  item,
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

  // 孤儿检测：视频/文档卡在 parsing 超过 10 分钟，判定为异常（页面关闭导致前端无法收结果）
  const STALE_PARSING_THRESHOLD_MS = 10 * 60 * 1000;
  const addedAtMs = item.addedAt ? new Date(item.addedAt).getTime() : NaN;
  const isStaleParsing = Boolean(
    item.status === 'parsing' &&
    !Number.isNaN(addedAtMs) &&
    Date.now() - addedAtMs > STALE_PARSING_THRESHOLD_MS &&
    !item.videoImported &&
    !item.sessionId
  );
  // 文档类正在解析
  const showDocumentParsing = Boolean(
    (item.type === 'document' || item.type === 'image' || (item.type === 'text' && isAttachmentMessage)) &&
    item.status === 'parsing' &&
    item.statusText &&
    !isStaleParsing
  );

  // 视频有缩略图时，顶部裁切圆角
  const hasVideoThumbnail = item.type === 'video' && item.previewUrl;

  return (
    <div
      className={`group relative rounded-2xl bg-white transition-all duration-200
        ${isSelectedForContext
          ? 'ring-[1.5px] ring-[#1C1B19]/20 bg-[#FAFAF9]'
          : 'ring-[0.5px] ring-[#1C1B19]/[0.06] hover:ring-[#1C1B19]/[0.12] hover:bg-[#FAFAF9]'
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
      {/* 视频缩略图（贴顶，顶部继承卡片圆角） */}
      {hasVideoThumbnail ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
          className="block w-full overflow-hidden rounded-t-2xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.previewUrl}
            alt={item.title}
            className="block w-full aspect-video max-h-[220px] object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </button>
      ) : null}

      <div className={`${hasVideoThumbnail ? 'px-5 pb-4 pt-3' : 'px-5 py-4'}`}>
        {/* ── 顶栏：时间 + 类型 + 操作 ── */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <TypeBadge type={item.type} />
            <span className="text-[11px] text-[#8E8B82] tabular-nums shrink-0">
              {formatRelativeCollectionTime(item.addedAt)}
            </span>
            {item.videoProvider ? (
              <span className="text-[10px] text-[#8E8B82]">· {item.videoProvider}</span>
            ) : null}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isCollectionContextSelectionMode ? (
              <button
                type="button"
                onClick={() => onToggleContextItem(item)}
                aria-pressed={isSelectedForContext}
                className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                  isSelectedForContext
                    ? 'bg-[#1C1B19] text-white'
                    : 'bg-[#F0EBDF] text-[#5C5A55] hover:bg-[#E8E2D5]'
                }`}
              >
                {isSelectedForContext ? '已选' : '选择'}
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMessageMenu(item.id);
                }}
                className="rounded-lg p-1.5 text-[#D0D0CC] transition-all hover:bg-[#F0EBDF] hover:text-[#5C5A55] group-hover:text-[#8E8B82]"
                aria-label={`操作：${getCollectionContextDisplayTitle(item, 36)}`}
              >
                <MoreHorizontal size={15} />
              </button>
            )}
          </div>
        </div>

        {/* ── 内容区 ── */}

        {/* 文字类型 */}
        {item.type === 'text' && !isAttachmentMessage ? (
          <p className="text-[14.5px] leading-[1.8] text-[#1C1B19] whitespace-pre-wrap">
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
              className="inline-flex items-center gap-3 rounded-[14px] bg-[#FAF7F2] px-3.5 py-3 transition hover:bg-[#F0EBDF] disabled:opacity-50"
            >
              <span className={`flex h-9 w-9 items-center justify-center rounded-full transition ${
                isAudioPlaying ? 'bg-[#1C1B19] text-white' : 'bg-[#1C1B19] text-white'
              }`}>
                {isAudioPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
              </span>
              {/* 波形条 */}
              <span className="relative flex h-6 w-[110px] items-center">
                <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 rounded-full bg-[#E8E2D5]" />
                <span
                  className="absolute left-0 top-1/2 h-[1.5px] -translate-y-1/2 rounded-full bg-[#1C1B19] transition-all duration-300"
                  style={{ width: `${Math.max(4, audioProgress * 100)}%` }}
                />
                <span className="relative z-10 flex w-full items-end justify-between px-0.5">
                  {[6, 10, 15, 8, 14, 7, 12, 9, 11, 6, 13].map((h, i) => (
                    <span
                      key={`wave-${item.id}-${i}`}
                      className="w-[2px] rounded-full transition-opacity duration-200"
                      style={{
                        height: `${h}px`,
                        backgroundColor: i / 11 < audioProgress ? '#1C1B19' : '#D0D0CC',
                        opacity: i / 11 < audioProgress ? 0.85 : 0.4,
                      }}
                    />
                  ))}
                </span>
              </span>
              <span className="text-[12px] font-medium text-[#5C5A55] tabular-nums">
                {formatVoiceDurationCompact(
                  audioPlaybackState?.id === item.id && audioPlaybackState.duration > 0
                    ? audioPlaybackState.duration * 1000
                    : item.durationMs
                )}
              </span>
            </button>

            <div className="flex items-center gap-2 text-[11px] text-[#8E8B82]">
              {showAudioStatusText ? (
                <span className="font-medium">{item.statusText}</span>
              ) : null}
              {item.segmentCount > 0 && item.fullText?.trim() ? (
                <button
                  type="button"
                  onClick={() =>
                    onSetExpandedAudioTranscriptId((prev) => (prev === item.id ? null : item.id))
                  }
                  className="rounded-full px-2.5 py-0.5 text-[#5C5A55] transition hover:bg-[#F0EBDF]"
                >
                  {isAudioTranscriptOpen ? '收起文字' : '查看文字'}
                </button>
              ) : null}
            </div>

            {isAudioTranscriptOpen && item.segmentCount > 0 && item.fullText?.trim() ? (
              <div className="rounded-xl bg-[#FAF7F2] px-4 py-3">
                <p className="text-[14px] leading-[1.8] text-[#1C1B19]">{bubbleText}</p>
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
                  className="max-h-56 w-auto max-w-full rounded-xl object-cover"
                />
              </a>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl bg-[#FAF7F2] px-3.5 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#D3E4F4] text-[#1E5F8A]">
                  <ImageIcon size={16} />
                </span>
                <p className="truncate text-[14px] text-[#1C1B19]">{item.title}</p>
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
                className="flex items-center gap-3 rounded-xl bg-[#FAF7F2] px-4 py-3.5 transition hover:bg-[#F0EBDF]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FADEC9] text-[#5C5A55]">
                  <FileText size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[#1C1B19]">{item.title}</p>
                  {fileExtensionBadge ? (
                    <p className="mt-0.5 text-[11px] text-[#8E8B82]">{fileExtensionBadge}</p>
                  ) : null}
                </div>
                <ChevronRight size={14} className="shrink-0 text-[#8E8B82]" />
              </a>
            ) : (
              <div className="flex items-center gap-2.5 rounded-xl bg-[#FAF7F2] px-3.5 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FADEC9] text-[#5C5A55]">
                  <FileText size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-[#1C1B19]">{item.title}</p>
                  {fileExtensionBadge ? <p className="text-[11px] text-[#8E8B82]">{fileExtensionBadge}</p> : null}
                </div>
              </div>
            )}
            {/* 文档解析中文案（PDF/图文 OCR 可能 30-60s） */}
            {showDocumentParsing ? (
              <div className="flex items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1.5 text-[#8E8B82]">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#B8842B]" />
                  <span>{item.statusText}</span>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 视频类型（有缩略图时标题在上方已处理，这里处理无缩略图和底部状态） */}
        {item.type === 'video' ? (
          <div className="space-y-2">
            {/* 有缩略图 → 显示标题 + 时长 */}
            {hasVideoThumbnail ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
                className="flex w-full items-center justify-between text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-[#1C1B19]">{item.title}</p>
                  {item.durationMs ? (
                    <p className="mt-0.5 text-[12px] text-[#8E8B82]">
                      {formatVoiceDurationCompact(item.durationMs)}
                    </p>
                  ) : null}
                </div>
                <ChevronRight size={14} className="shrink-0 text-[#8E8B82]" />
              </button>
            ) : (
              /* 无缩略图：轻量播放卡片 */
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
                className="flex w-full items-center gap-3 rounded-xl bg-[#FAF7F2] px-4 py-3.5 text-left transition hover:bg-[#F0EBDF]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pine-mist text-pine">
                  <Play size={17} className="ml-0.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[#1C1B19]">{item.title}</p>
                  {item.durationMs ? (
                    <p className="mt-0.5 text-[12px] text-[#8E8B82]">{formatVoiceDurationCompact(item.durationMs)}</p>
                  ) : null}
                </div>
                <ChevronRight size={14} className="shrink-0 text-[#8E8B82]" />
              </button>
            )}

            <div className="flex items-center gap-2 text-[11px]">
              {showVideoStatusText ? (
                <span className="font-medium text-vermilion">{item.statusText}</span>
              ) : item.videoImported && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void onOpenReview(item); }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#D1F4E0]/60 px-2.5 py-1 text-[11px] font-medium text-[#2E6948] transition hover:bg-[#D1F4E0]"
                >
                  <BookOpen size={11} />
                  <span>已解析 · {item.serverTranscriptSegments.length}句 · 去复习</span>
                </button>
              ) : item.type === 'video' && isStaleParsing ? (
                <span className="inline-flex items-center gap-1.5 text-[#5C5A55]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#B8842B]" />
                  <span>解析未完成，换个浏览器再试一次</span>
                </span>
              ) : item.type === 'video' && !item.videoImported && !item.sessionId && item.status !== 'failed' && (item.reviewable || item.status === 'parsing') ? (
                <span className="inline-flex items-center gap-1.5 text-[#8E8B82]">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#B8842B]" />
                  <span>{item.statusText || '解析中…'}</span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* 底部状态（失败提示） */}
        {showInlineStatus ? (
          <div className="mt-2.5">
            <span className="rounded-full bg-vermilion-fog px-2.5 py-1 text-[11px] font-medium text-vermilion">
              {item.statusText}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default CollectionCard;
