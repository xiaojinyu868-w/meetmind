/**
 * CollectionFeedMessageBubble — 收集 Feed 单条消息气泡
 *
 * 从 page.tsx renderMobileRecordView 的 collectionFeedItems.map() 提取。
 * 渲染单条收集消息，支持：audio / video / image / document / text 五种类型，
 * 以及长按菜单、多选模式、音频播放等交互。
 */

'use client';

import React from 'react';
import {
  MoreHorizontal,
  Play,
  Pause,
  BookOpen,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import type { SourceIngestItem } from '@/types/page-types';
import type { AudioPlaybackState } from '@/stores/collection-store';
import {
  getCollectionContextDisplayTitle,
  getCollectionContextTypeLabel,
} from '@/lib/capture/collection-context';
import {
  formatVoiceDurationCompact,
  getFileExtensionBadge,
  formatRelativeCollectionTime,
} from '@/lib/utils/page-utils';

// ==================== 类型定义 ====================

export interface CollectionFeedMessageBubbleProps {
  /** 消息条目 */
  item: SourceIngestItem;
  /** 是否桌面壳模式 */
  desktopShell: boolean;
  /** 气泡宽度 class */
  messageBubbleWidthClass: string;
  /** 是否处于多选模式 */
  isCollectionContextSelectionMode: boolean;
  /** 已选中的上下文 ID 列表 */
  selectedCollectionContextIds: string[];
  /** 音频播放状态 */
  audioPlaybackState: AudioPlaybackState | null;
  /** 当前正在播放的音频消息 ID */
  playingAudioMessageId: string | null;
  /** 当前展开转录文本的音频 ID */
  expandedAudioTranscriptId: string | null;

  // --- 回调 ---
  /** 打开消息操作菜单 */
  onOpenMessageMenu: (itemId: string) => void;
  /** 开始长按 */
  onBeginLongPress: (itemId: string) => void;
  /** 取消长按 */
  onCancelLongPress: () => void;
  /** 播放/暂停音频 */
  onToggleAudioPlayback: (item: SourceIngestItem) => Promise<void>;
  /** 选择/取消选择上下文条目 */
  onToggleContextItem: (item: SourceIngestItem) => void;
  /** 展开/收起音频转录 */
  onSetExpandedAudioTranscriptId: (updater: string | null | ((prev: string | null) => string | null)) => void;
  /** 从收集打开复习 */
  onOpenReview: (item: SourceIngestItem) => Promise<void>;
  /** 长按触发标志 ref */
  longPressTriggeredRef: React.MutableRefObject<boolean>;
}

// ==================== 组件实现 ====================

export function CollectionFeedMessageBubble({
  item,
  desktopShell,
  messageBubbleWidthClass,
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
}: CollectionFeedMessageBubbleProps) {
  // --- 派生数据（全部在组件内部计算） ---
  const isPrimary = (item.origin || 'user') === 'user';
  const typeLabel =
    item.type === 'audio'
      ? '录音'
      : item.type === 'video'
        ? '视频'
        : item.type === 'image'
          ? '图片'
          : item.type === 'document'
            ? '材料'
            : '文字';

  const bubbleText = item.fullText?.trim() || item.preview?.trim() || item.title;
  const collectionActionTitle = getCollectionContextDisplayTitle(item, 36);
  const audioProgress =
    audioPlaybackState?.id === item.id
      ? Math.max(0, Math.min(1, audioPlaybackState.progress))
      : 0;
  const isAudioPlaying = playingAudioMessageId === item.id;
  const isAudioTranscriptOpen = expandedAudioTranscriptId === item.id;
  const fileExtensionBadge = getFileExtensionBadge(item.title);
  const showInlineStatus = Boolean(
    item.status === 'failed' &&
    item.statusText &&
    item.type !== 'audio' &&
    item.type !== 'video'
  );
  const showAudioStatusText = Boolean(item.statusText) && item.status !== 'ready';
  const showVideoStatusText = Boolean(item.statusText) && item.status === 'failed';
  const statusTone =
    item.status === 'failed'
      ? 'bg-rose-50 text-rose-600'
      : item.status === 'ready'
        ? 'bg-white/70 text-[#4f7a36]'
        : 'bg-white/70 text-[#3d7d1f]';
  const isAttachmentMessage =
    Boolean(item.attachmentUrl) && (item.type === 'document' || item.type === 'text');
  const isSelectedForContext = selectedCollectionContextIds.includes(item.id);

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
  const showInlineMoreButton = !isCollectionContextSelectionMode;

  return (
    <div
      key={item.id}
      className={`group flex ${isPrimary ? 'justify-end' : 'justify-start'}`}
      onContextMenu={
        desktopShell && !isCollectionContextSelectionMode
          ? (event) => {
              event.preventDefault();
              onOpenMessageMenu(item.id);
            }
          : undefined
      }
      onTouchStart={
        !desktopShell && !isCollectionContextSelectionMode
          ? () => onBeginLongPress(item.id)
          : undefined
      }
      onTouchEnd={!desktopShell ? onCancelLongPress : undefined}
      onTouchCancel={!desktopShell ? onCancelLongPress : undefined}
      onTouchMove={!desktopShell ? onCancelLongPress : undefined}
      onClickCapture={
        !desktopShell
          ? (event) => {
              if (!longPressTriggeredRef.current) return;
              longPressTriggeredRef.current = false;
              event.preventDefault();
              event.stopPropagation();
            }
          : undefined
      }
    >
      <div className={`${messageBubbleWidthClass}`}>
        <div
          className={`relative overflow-hidden rounded-2xl px-4 py-3.5 ${
            isPrimary
              ? 'rounded-br-md bg-[#F0FAF4]'
              : 'rounded-bl-md bg-[#F7F7F5]'
          } ${isSelectedForContext ? 'ring-2 ring-[#5B6ABF]/30' : ''}`}
        >
          {!isCollectionContextSelectionMode ? (
            <div className={`mb-2 flex items-center justify-between gap-2 ${isPrimary ? 'text-[#5B6ABF]' : 'text-slate-500'}`}>
              <span className="text-[11px] font-medium uppercase tracking-wider opacity-60">
                {typeLabel}
              </span>
              {showInlineMoreButton ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenMessageMenu(item.id);
                  }}
                  className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label={`更多操作：${collectionActionTitle}`}
                >
                  <MoreHorizontal size={14} />
                </button>
              ) : null}
            </div>
          ) : null}
          {isCollectionContextSelectionMode ? (
            <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
              <button
                type="button"
                onClick={() => onToggleContextItem(item)}
                aria-pressed={isSelectedForContext}
                className={`rounded-full px-2.5 py-1 font-medium transition ${
                  isSelectedForContext
                    ? 'bg-[#D6DAFA] text-[#424E96]'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {isSelectedForContext ? '已选' : '选择'}
              </button>
              <span className="text-[10px] text-slate-400">{getCollectionContextTypeLabel(item.type)}</span>
            </div>
          ) : null}

          {/* --- 内容区：按类型分支渲染 --- */}
          {item.type === 'audio' ? (
            <div className="space-y-2">
              <div className={`flex ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                <button
                  type="button"
                  onClick={() => {
                    void onToggleAudioPlayback(item);
                  }}
                  disabled={!item.mediaUrl}
                  className={`inline-flex max-w-full items-center gap-3 rounded-full px-3 py-2 transition ${
                    isPrimary
                      ? 'bg-white/60 text-slate-700'
                      : 'bg-slate-100 text-slate-700'
                  } disabled:cursor-default disabled:opacity-80`}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#232322] text-white">
                    {isAudioPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                  </span>
                  <span className="relative flex h-5 w-[88px] items-center">
                    <span
                      className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-slate-200"
                      style={{ width: '100%' }}
                    />
                    <span
                      className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[#5DADE2] transition-all"
                      style={{ width: `${Math.max(8, audioProgress * 100)}%` }}
                    />
                    <span className="relative z-10 flex w-full items-end justify-between px-1">
                      {[8, 12, 16, 11, 15, 9, 13, 10].map((height, index) => (
                        <span
                          key={`${item.id}-wave-${index}`}
                          className="w-[3px] rounded-full bg-slate-400"
                          style={{ height: `${height}px`, opacity: index / 8 < audioProgress ? 0.95 : 0.35 }}
                        />
                      ))}
                    </span>
                  </span>
                  <span className="text-[11px] font-semibold">
                    {formatVoiceDurationCompact(
                      audioPlaybackState?.id === item.id && audioPlaybackState.duration > 0
                        ? audioPlaybackState.duration * 1000
                        : item.durationMs
                    )}
                  </span>
                </button>
              </div>
              <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                isPrimary ? 'justify-end text-slate-500' : 'justify-start text-slate-500'
              }`}>
                {showAudioStatusText ? (
                  <span className="font-medium">{item.statusText}</span>
                ) : null}
                {item.segmentCount > 0 && item.fullText?.trim() ? (
                  <>
                    {showAudioStatusText ? (
                      <span aria-hidden="true" className="opacity-40">·</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        onSetExpandedAudioTranscriptId((prev) => (prev === item.id ? null : item.id))
                      }
                      className="rounded-full px-2.5 py-1 font-medium text-slate-500 transition hover:bg-slate-100"
                    >
                      {isAudioTranscriptOpen ? '收起文字' : '看文字'}
                    </button>
                  </>
                ) : null}
              </div>
              {isAudioTranscriptOpen && item.segmentCount > 0 && item.fullText?.trim() ? (
                <div className={`rounded-xl px-3 py-2 text-[15px] leading-7 ${
                  isPrimary ? 'bg-white/50 text-[#232322]' : 'bg-white text-[#232322]'
                }`}>
                  {bubbleText}
                </div>
              ) : null}
            </div>
          ) : item.type === 'image' ? (
            <div className="space-y-2">
              {item.previewUrl ? (
                <a
                  href={item.attachmentUrl || item.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-[18px]"
                  aria-label={`查看原图：${item.title}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt={item.title}
                    className="max-h-60 w-full object-cover"
                  />
                </a>
              ) : (
                <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                    isPrimary ? 'bg-white/50 text-violet-500' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <ImageIcon size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                  </div>
                </div>
              )}
            </div>
          ) : item.type === 'document' || isAttachmentMessage ? (
            <div className="space-y-2">
              {item.attachmentUrl ? (
                <a
                  href={item.attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`block rounded-xl px-3 py-2.5 transition ${
                    isPrimary
                      ? 'bg-white/40 hover:bg-white/60'
                      : 'bg-white hover:bg-[#F7F7F5]'
                  }`}
                >
                  <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                      isPrimary ? 'bg-white text-blue-500' : 'bg-white text-slate-500'
                    }`}>
                      <FileText size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                    </div>
                    {fileExtensionBadge ? (
                      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                        {fileExtensionBadge}
                      </span>
                    ) : null}
                  </div>
                </a>
              ) : (
                <div className={`flex items-center gap-2 ${isPrimary ? 'justify-end' : 'justify-start'}`}>
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                    isPrimary ? 'bg-white/70 text-[#2563eb]' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <FileText size={15} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                    {fileExtensionBadge ? <p className="text-[11px] text-slate-500">{fileExtensionBadge}</p> : null}
                  </div>
                </div>
              )}
              {/* 文档解析中文案 */}
              {showDocumentParsing ? (
                <div className={`flex items-center gap-2 text-[11px] ${
                  isPrimary ? 'justify-end text-white/80' : 'justify-start text-amber-600/80'
                }`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    <span>{item.statusText}</span>
                  </span>
                </div>
              ) : null}
            </div>
          ) : item.type === 'video' ? (
            <div className="space-y-2">
              {(() => {
                const hasThumbnail = !!item.previewUrl;
                const cardClick = () => void onOpenReview(item);
                if (hasThumbnail) {
                  return (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); cardClick(); }}
                      className={`block w-full overflow-hidden rounded-xl text-left transition ${
                        isPrimary ? 'bg-white/40' : 'bg-white'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.previewUrl}
                        alt={item.title}
                        className="block w-full aspect-video object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                      <div className="px-3 py-2">
                        <p className="truncate text-sm font-medium text-[#232322]">{item.title}</p>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#787774]">
                          {item.videoProvider ? <span>{item.videoProvider}</span> : null}
                          {item.durationMs ? (
                            <span>{item.videoProvider ? ' · ' : ''}{formatVoiceDurationCompact(item.durationMs)}</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                }
                /* 无缩略图：轻量链接卡片 */
                return (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); cardClick(); }}
                    className={`block w-full overflow-hidden rounded-xl text-left transition ${
                      isPrimary ? 'bg-white/40' : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 px-3 py-3">
                      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        isPrimary ? 'bg-[#EDE9FE] text-[#7C3AED]' : 'bg-[#F0FAF4] text-[#2d6a3f]'
                      }`}>
                        <Play size={17} className="ml-0.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#232322]">{item.title}</p>
                        {item.durationMs ? (
                          <p className="mt-0.5 text-[11px] text-[#787774]">
                            {formatVoiceDurationCompact(item.durationMs)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })()}
              <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] ${
                isPrimary ? 'justify-end text-white/75' : 'justify-start text-slate-500'
              }`}>
                {showVideoStatusText ? (
                  <span className="font-medium">{item.statusText}</span>
                ) : item.videoImported && item.serverTranscriptSegments && item.serverTranscriptSegments.length > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onOpenReview(item);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-[#D1F4E0]/80 px-2.5 py-0.5 text-[11px] font-medium text-[#2d6a3f] transition hover:bg-[#D1F4E0]"
                  >
                    <BookOpen size={11} />
                    <span>已解析 · {item.serverTranscriptSegments.length}句 · 去复习</span>
                  </button>
                ) : item.type === 'video' && isStaleParsing ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9A4A12]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#C97B3F]" />
                    <span>解析未完成，换个浏览器再试一次</span>
                  </span>
                ) : item.type === 'video' && !item.videoImported && !item.sessionId && item.status !== 'failed' && (item.reviewable || item.status === 'parsing') ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-600/80">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                    <span>{item.statusText || '解析中…'}</span>
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[15px] leading-7 text-[#232322]">{bubbleText}</p>
            </div>
          )}

          {/* --- 底部时间戳 + 状态 --- */}
          <div className={`mt-2 flex items-center ${isPrimary ? 'justify-end' : 'justify-start'} gap-2 text-[11px] text-slate-400`}>
            <span>{formatRelativeCollectionTime(item.addedAt)}</span>
            {showInlineStatus ? (
              <span className={`rounded-full px-2 py-0.5 ${statusTone}`}>
                {item.statusText || typeLabel}
              </span>
            ) : null}
          </div>

        </div>
      </div>
    </div>
  );
}
