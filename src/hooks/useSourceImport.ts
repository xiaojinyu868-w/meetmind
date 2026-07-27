'use client';

import { useCallback, type MutableRefObject, type ChangeEvent } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import { useUIStore } from '@/stores/ui-store';
import { useSessionStore } from '@/stores/session-store';
import {
  detectReachFromFile,
  detectReachFromText,
  isAudioReachFile,
  isDocumentReachFile,
  isImageReachFile,
  isVideoReachFile,
} from '@/lib/context-reach';
import { parseVideoLink } from '@/lib/utils/video-link';
import {
  compactText,
  getLocalMediaDurationMs,
  buildASRContextHint,
  buildSourcePreviewText,
  buildSupportReferenceSnippet,
  readJsonApiResponse,
  resolveSourceFailureStatus,
  transcribeAudioFile,
  parseDocumentFile,
  parseImageFile,
  normalizeImportedVideoSegments,
} from '@/lib/utils/page-utils';
import { toast } from 'sonner';
import type {
  TranscriptSegment,
  ImportedVideoResult,
  ImportedVideoSource,
} from '@/types';
import type {
  SourceIngestType,
  SourceIngestRole,
  SourceIngestItem,
  SourceProvenance,
  SupportReferenceItem,
} from '@/types/page-types';
import { buildSourceProvenance, canonicalizeSourceUrl } from '@/lib/capture/source-provenance';

// ── External deps that come from caller ──

export interface SourceImportDeps {
  /** Ingest transcript segments into session state (remains in page.tsx due to heavy session-level side effects). */
  ingestTranscriptSegments: (params: {
    segments: TranscriptSegment[];
    sourceType: SourceIngestType;
    sourceTitle: string;
    audioBlob?: Blob;
    mediaUrl?: string;
    mediaDurationMs?: number;
    videoSource?: ImportedVideoSource;
    sourceItemId?: string;
    persistSourceKey?: string;
    persistSourceType?: string;
    persistRole?: SourceIngestRole;
    occurredAt?: string;
    sourceUrl?: string;
    provenance?: SourceProvenance;
  }) => Promise<void>;

  /** Persist a capture entry to the workspace backend. */
  persistCaptureToWorkspace: (params: {
    sourceType: string;
    sourceKey: string;
    role: string;
    contentType: string;
    title: string;
    previewText?: string;
    normalizedText?: string;
    sourceUrl?: string;
    mediaUrl?: string;
    tutorContext?: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<string | undefined>;

  /** Append a new source item to the collection feed. */
  appendSourceItem: (params: {
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
  }) => void;

  /** Update an existing source item by id. */
  updateSourceItem: (id: string, patch: Partial<SourceIngestItem>) => void;

  /** Append a support source (document / text) to the collection. */
  appendSupportSource: (params: {
    id?: string;
    sourceKey?: string;
    type: Extract<SourceIngestType, 'document' | 'text'>;
    title: string;
    segments: TranscriptSegment[];
    appendItem?: boolean;
    provenance?: SourceProvenance;
  }) => { supportId: string; reference: string };

  /** ASR context hint (manual input). */
  asrContextHint: string;

  /** User's B站 Cookie from settings (settings_bilibiliCookie preference). */
  biliCookie: string;
}

export interface SourceImportRefs {
  segmentsRef: MutableRefObject<TranscriptSegment[]>;
  previewObjectUrlsRef: MutableRefObject<string[]>;
  sourceFileInputRef: MutableRefObject<HTMLInputElement | null>;
}

// ── Return type ──

export interface SourceImportReturn {
  handleVideoImportReady: (
    result: ImportedVideoResult,
    options?: {
      sourceItemId?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
      provenance?: SourceProvenance;
    }
  ) => Promise<void>;

  handleImportFiles: (
    files: FileList | File[],
    pickerMode?: 'audio' | 'support' | 'all',
    options?: { sessionId?: string; capturedAtMs?: number }
  ) => Promise<void>;

  handleSourceFileButtonClick: (mode?: 'audio' | 'support' | 'all') => void;

  handleSourceFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;

  importVideoLinkIntoSourceItem: (
    url: string,
    options?: {
      sourceItemId?: string;
      optimisticTitle?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
    }
  ) => Promise<boolean>;

  importArticleLinkIntoSourceItem: (
    url: string,
    options?: {
      sourceItemId?: string;
      optimisticTitle?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
      provenance?: SourceProvenance;
    }
  ) => Promise<boolean>;

  importComposerVideoLink: (url: string) => Promise<void>;
}

// ── Error mapping ──

const VIDEO_IMPORT_ERROR_MESSAGES: Record<string, string> = {
  BILI_COOKIE_EXPIRED: 'B站登录已过期，请在设置里更新 Cookie',
  BILI_AUDIO_DOWNLOAD_FORBIDDEN: 'B站拒绝了匿名请求，请在设置里配置 B站 Cookie',
  BILI_AUDIO_INCOMPLETE: '音频下载不完整，可能是网络限速，稍后重试',
  BILI_PLAYURL_FAILED: 'B站拒绝了音频请求，请在设置里配置 Cookie',
  BILI_URL_PARSE_FAILED: 'B站链接解析失败，请检查链接是否正确',
  BILI_VIEW_META_FAILED: 'B站视频信息获取失败，稍后重试',
  BILI_API_ERROR: 'B站接口返回异常，可能是风控限制，请配置 Cookie',
  BILI_NETWORK_ERROR: 'B站网络请求失败，稍后重试',
  BILI_SUBTITLE_FETCH_FAILED: 'B站字幕获取失败，稍后重试',
  YTDLP_UNAVAILABLE: '服务器未安装 yt-dlp，请联系管理员',
  YTDLP_DOWNLOAD_FAILED: '视频下载失败，稍后重试',
  ASR_API_KEY_MISSING: '转写服务未配置，请联系管理员',
  ASR_PUBLIC_HOST_MISSING: '转写服务地址未配置，请联系管理员',
  FFMPEG_NOT_FOUND: '服务器未安装 ffmpeg，请联系管理员',
  UNSUPPORTED_PLATFORM: '当前节点不支持该平台视频',
  INVALID_VIDEO_URL: '无法识别的视频链接',
  MISSING_VIDEO_URL: '缺少视频链接',
  VIDEO_URL_UNSAFE: '不允许访问该视频地址',
};

function mapVideoImportError(code: string | undefined, fallbackError: string | undefined): string {
  if (code && VIDEO_IMPORT_ERROR_MESSAGES[code]) {
    return VIDEO_IMPORT_ERROR_MESSAGES[code];
  }
  if (fallbackError && fallbackError.trim()) {
    return fallbackError.trim();
  }
  return '这条链接先收下了，稍后再试试';
}

// ── Hook ──

export function useSourceImport(
  deps: SourceImportDeps,
  refs: SourceImportRefs,
): SourceImportReturn {
  const {
    ingestTranscriptSegments,
    persistCaptureToWorkspace,
    appendSourceItem,
    updateSourceItem,
    appendSupportSource,
    asrContextHint,
    biliCookie,
  } = deps;

  const { segmentsRef, previewObjectUrlsRef, sourceFileInputRef } = refs;

  // ── Store selectors (read only what's needed) ──
  const collectionActions = useCollectionStore((s) => s.actions);
  const supportReferences = useCollectionStore((s) => s.supportReferences);
  const sourceFilePickerMode = useCollectionStore((s) => s.sourceFilePickerMode);

  const setActiveSourceImportCount = collectionActions.setActiveSourceImportCount;
  const setSourceImportError = collectionActions.setSourceImportError;
  const setSourceFilePickerMode = collectionActions.setSourceFilePickerMode;

  const uiActions = useUIStore((s) => s.actions);
  const setShowMobileRecorder = uiActions.setShowMobileRecorder;
  const setMobileCollectionSheet = uiActions.setMobileCollectionSheet;

  const sessionActions = useSessionStore((s) => s.actions);
  const setDataSource = sessionActions.setDataSource;

  // ── handleVideoImportReady ──

  const handleVideoImportReady = useCallback(async (
    result: ImportedVideoResult,
    options?: {
      sourceItemId?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
    }
  ) => {
    const importedSegments = Array.isArray(result.segments) ? result.segments : [];
    if (importedSegments.length === 0) {
      toast.warning('视频已导入，但转写为空，请更换视频或重试。');
      return;
    }

    await ingestTranscriptSegments({
      segments: importedSegments,
      sourceType: 'video',
      sourceTitle: result.source.title || '视频链接',
      videoSource: result.source,
      sourceItemId: options?.sourceItemId,
      persistSourceKey: options?.persistSourceKey,
      persistSourceType: options?.persistSourceType,
      persistRole: options?.persistRole,
      occurredAt: options?.occurredAt,
    });
  }, [ingestTranscriptSegments]);

  // ── handleImportFiles ──

  const handleImportFiles = useCallback(async (
    files: FileList | File[],
    pickerMode: 'audio' | 'support' | 'all' = 'all',
    options?: { sessionId?: string; capturedAtMs?: number }
  ) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    setActiveSourceImportCount((count) => count + 1);
    setSourceImportError('');

    try {
      const queuedFiles = await Promise.all(fileList.map(async (file) => {
        const isAudio = isAudioReachFile(file);
        const isVideo = isVideoReachFile(file);
        const isImage = isImageReachFile(file);
        const objectUrl = URL.createObjectURL(file);
        const mediaUrl = isAudio || isVideo ? objectUrl : undefined;
        const previewUrl = isImage ? objectUrl : undefined;
        const attachmentUrl = !isAudio && !isVideo ? objectUrl : undefined;
        const durationMs = isAudio || isVideo ? await getLocalMediaDurationMs(file) : undefined;
        if (objectUrl) {
          previewObjectUrlsRef.current.push(objectUrl);
        }
        return {
          id: `${isAudio ? 'audio' : isVideo ? 'video' : isImage ? 'image' : 'support'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          isAudio,
          isVideo,
          isImage,
          mediaUrl,
          previewUrl,
          attachmentUrl,
          durationMs,
        };
      }));
      const importedReferenceTexts: string[] = [];
      let handledFileCount = 0;
      const errorMessages: string[] = [];

      queuedFiles.forEach(({ id, file, isAudio, isVideo, isImage, mediaUrl, previewUrl, attachmentUrl, durationMs }) => {
        const pendingProvenance = buildSourceProvenance({
          ingressChannel: 'upload',
          isExtracting: true,
        });
        appendSourceItem({
          id,
          sourceKey: isAudio || isVideo ? `ingest:${id}` : `support:${id}`,
          type: isAudio ? 'audio' : isVideo ? 'video' : isImage ? 'image' : 'document',
          role: isAudio || isVideo ? 'primary' : 'support',
          title: file.name,
          preview: isAudio || isVideo ? '' : file.name,
          mediaUrl,
          previewUrl,
          attachmentUrl,
          segmentCount: 0,
          origin: 'user',
          status: isAudio || isVideo ? 'transcribing' : 'parsing',
          statusText: isAudio
            ? '转写稍后完成'
            : isImage
            ? '正在识别…'
            : (!isAudio && !isVideo)
            ? '正在阅读…'
            : undefined,
          sessionId: isImage ? options?.sessionId : undefined,
          durationMs,
          provenance: pendingProvenance,
        });
        if (isImage && options?.capturedAtMs !== undefined) {
          updateSourceItem(id, { capturedAtMs: options.capturedAtMs });
        }
      });

      for (const { id, file, isAudio, isVideo, isImage, mediaUrl, previewUrl, attachmentUrl, durationMs } of queuedFiles) {
        const fileReach = detectReachFromFile(file);
        try {
          if (isImage) {
            if (pickerMode === 'audio') {
              updateSourceItem(id, {
                status: 'failed',
                statusText: '这次只接收音频文件',
              });
              continue;
            }
            // 图片识别也可能 5-15 秒，给递进文案
            const imgProgressStages = [
              { delay: 0, text: '正在识别…' },
              { delay: 6000, text: '正在看清楚…' },
            ];
            const imgProgressTimers: ReturnType<typeof setTimeout>[] = [];
            for (const stage of imgProgressStages) {
              imgProgressTimers.push(
                setTimeout(() => {
                  updateSourceItem(id, { statusText: stage.text });
                }, stage.delay)
              );
            }
            const clearImgProgressTimers = () => {
              for (const timer of imgProgressTimers) clearTimeout(timer);
            };
            let parsed;
            try {
              parsed = await parseImageFile(file);
            } finally {
              clearImgProgressTimers();
            }
            const appended = appendSupportSource({
              id,
              sourceKey: `support:${id}`,
              type: 'document',
              title: parsed.title,
              segments: parsed.segments,
              appendItem: false,
              provenance: buildSourceProvenance({
                ingressChannel: 'upload',
                normalizedText: parsed.segments.map((segment) => segment.text).join('\n'),
                contentState: 'complete',
                completeness: 1,
              }),
            });
            const imageProvenance = buildSourceProvenance({
              ingressChannel: 'upload',
              normalizedText: appended.reference,
              contentState: 'complete',
              completeness: 1,
            });
            updateSourceItem(id, {
              sourceKey: `support:${id}`,
              type: 'image',
              role: 'support',
              title: parsed.title,
              preview: buildSourcePreviewText(parsed.segments, 220),
              previewUrl,
              attachmentUrl,
              fullText: appended.reference,
              segmentCount: parsed.segments.length,
              status: 'ready',
              statusText: undefined,
              origin: 'user',
              sessionId: options?.sessionId,
              capturedAtMs: options?.capturedAtMs,
              provenance: imageProvenance,
            });
            void persistCaptureToWorkspace({
              sourceType: 'support-import',
              sourceKey: `support:${id}`,
              role: 'support',
              contentType: 'image',
              title: parsed.title,
              previewText: buildSourcePreviewText(parsed.segments, 180),
              normalizedText: appended.reference,
              tutorContext: appended.reference,
              occurredAt: new Date().toISOString(),
              metadata: {
                from: 'file-import',
                fileType: parsed.fileType,
                fileName: file.name,
                capturedAtMs: options?.capturedAtMs,
                sessionId: options?.sessionId,
                provenance: imageProvenance,
              },
            });
            importedReferenceTexts.push(
              compactText(
                parsed.segments
                  .slice(0, 20)
                  .map((segment) => segment.text)
                  .join(' '),
                1200
              )
            );
            handledFileCount += 1;
            continue;
          }

          if (isDocumentReachFile(file)) {
            if (pickerMode === 'audio') {
              updateSourceItem(id, {
                status: 'failed',
                statusText: '这次只接收音频文件',
              });
              continue;
            }
            // 文档解析可能耗时 30-60 秒（图文 PDF 尤其慢），给用户递进式文案反馈
            const docProgressStages = [
              { delay: 0, text: '正在阅读…' },
              { delay: 5000, text: '正在识别文字…' },
              { delay: 15000, text: '内容比较多，还在读…' },
              { delay: 35000, text: '快好了，再等等…' },
            ];
            const docProgressTimers: ReturnType<typeof setTimeout>[] = [];
            for (const stage of docProgressStages) {
              docProgressTimers.push(
                setTimeout(() => {
                  updateSourceItem(id, { statusText: stage.text });
                }, stage.delay)
              );
            }
            const clearDocProgressTimers = () => {
              for (const timer of docProgressTimers) clearTimeout(timer);
            };
            let parsed;
            try {
              parsed = await parseDocumentFile(file);
            } finally {
              clearDocProgressTimers();
            }
            const supportType = parsed.fileType === 'txt' || parsed.fileType === 'md' ? 'text' : 'document';
            const appended = appendSupportSource({
              id,
              sourceKey: `support:${id}`,
              type: supportType,
              title: parsed.title,
              segments: parsed.segments,
              appendItem: false,
              provenance: buildSourceProvenance({
                ingressChannel: 'upload',
                normalizedText: parsed.segments.map((segment) => segment.text).join('\n'),
                contentState: 'complete',
                completeness: 1,
              }),
            });
            const documentProvenance = buildSourceProvenance({
              ingressChannel: 'upload',
              normalizedText: appended.reference,
              contentState: 'complete',
              completeness: 1,
            });
            updateSourceItem(id, {
              sourceKey: `support:${id}`,
              type: supportType,
              role: 'support',
              title: parsed.title,
              preview: buildSourcePreviewText(parsed.segments, 180) || parsed.title,
              attachmentUrl,
              fullText: appended.reference,
              segmentCount: parsed.segments.length,
              status: 'ready',
              statusText: undefined,
              origin: 'user',
              provenance: documentProvenance,
            });
            void persistCaptureToWorkspace({
              sourceType: 'support-import',
              sourceKey: `support:${id}`,
              role: 'support',
              contentType: 'document',
              title: parsed.title,
              previewText: buildSourcePreviewText(parsed.segments, 180),
              normalizedText: appended.reference,
              tutorContext: appended.reference,
              occurredAt: new Date().toISOString(),
              metadata: {
                from: 'file-import',
                fileType: parsed.fileType,
                fileName: file.name,
                provenance: documentProvenance,
              },
            });
            importedReferenceTexts.push(
              compactText(
                parsed.segments
                  .slice(0, 20)
                  .map((segment) => segment.text)
                  .join(' '),
                1200
              )
            );
            handledFileCount += 1;
            continue;
          }

          if (isAudio || isVideo || isAudioReachFile(file) || isVideoReachFile(file)) {
            if (pickerMode === 'support') {
              updateSourceItem(id, {
                status: 'failed',
                statusText: '这次只接收资料文件',
              });
              continue;
            }
            const contextHint = buildASRContextHint({
              manualHint: asrContextHint,
              recentSegments: segmentsRef.current,
              importedReferences: [
                ...supportReferences.map((item) => item.snippet),
                ...importedReferenceTexts,
              ],
              maxChars: 3000,
            });
            const segments = await transcribeAudioFile(file, contextHint);
            const mediaBlob = new Blob([await file.arrayBuffer()], { type: file.type || (isVideo ? 'video/mp4' : 'audio/mpeg') });
            await ingestTranscriptSegments({
              segments,
              sourceType: isVideo ? 'video' : 'audio',
              sourceTitle: file.name,
              audioBlob: mediaBlob,
              mediaUrl,
              mediaDurationMs: durationMs,
              sourceItemId: id,
            });
            if (mediaUrl) {
              updateSourceItem(id, { mediaUrl, durationMs });
            }
            handledFileCount += 1;
            continue;
          }

          throw new Error(`${fileReach.label} 暂时还不能自动接入：${file.name}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isUserInputIssue = /只接收|没有识别到|暂时还不能自动接入/i.test(message);
          const isTranscribeIssue = isAudio || isVideo;
          if (isUserInputIssue) {
            errorMessages.push(message);
          } else if (isTranscribeIssue) {
            // 转录失败：把真实错误暴露出来，而不是静默保留
            errorMessages.push(message);
          }
          updateSourceItem(id, {
            status: 'failed',
            statusText: isTranscribeIssue && !isUserInputIssue
              ? `转写未完成：${message.length > 40 ? message.slice(0, 40) + '…' : message}`
              : resolveSourceFailureStatus({ isAudio, isVideo, isImage }),
            preview: isAudio || isVideo ? '' : file.name,
            origin: 'user',
            provenance: buildSourceProvenance({
              ingressChannel: 'upload',
              failed: true,
            }),
          });
        }
      }

      if (handledFileCount === 0) {
        if (errorMessages.length > 0) {
          setSourceImportError(errorMessages[0]);
        }
        return;
      }

      if (errorMessages.length > 0) {
        setSourceImportError(errorMessages[0]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSourceImportError(message);
    } finally {
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
      setSourceFilePickerMode('all');
    }
  }, [
    appendSourceItem,
    appendSupportSource,
    asrContextHint,
    ingestTranscriptSegments,
    persistCaptureToWorkspace,
    supportReferences,
    updateSourceItem,
    previewObjectUrlsRef,
    segmentsRef,
    setActiveSourceImportCount,
    setSourceImportError,
    setSourceFilePickerMode,
  ]);

  // ── handleSourceFileButtonClick ──

  const handleSourceFileButtonClick = useCallback((mode: 'audio' | 'support' | 'all' = 'all') => {
    setSourceImportError('');
    setSourceFilePickerMode(mode);
    setShowMobileRecorder(false);
    setMobileCollectionSheet(null);

    // Unified picker is the default for the chat-style collection flow.
    if (mode !== 'all') {
      setDataSource('demo');
    }

    sourceFileInputRef.current?.click();
  }, [setSourceImportError, setSourceFilePickerMode, setShowMobileRecorder, setMobileCollectionSheet, setDataSource, sourceFileInputRef]);

  // ── handleSourceFileInputChange ──

  const handleSourceFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      // 课中拍照透传：从 input dataset 读取 capturedAtMs 和 sessionId
      const input = event.target;
      const capturedAtMsStr = input.dataset.capturedAtMs;
      const sessionIdFromInput = input.dataset.sessionId;
      const capturedAtMs = capturedAtMsStr ? Number(capturedAtMsStr) : undefined;
      const sessionId = sessionIdFromInput || undefined;
      const hasOptions = capturedAtMs !== undefined || sessionId !== undefined;
      void handleImportFiles(
        files,
        sourceFilePickerMode,
        hasOptions ? { capturedAtMs, sessionId } : undefined,
      );
      // 清理 dataset
      delete input.dataset.capturedAtMs;
      delete input.dataset.sessionId;
    }
    if (sourceFileInputRef.current) {
      sourceFileInputRef.current.value = '';
    }
  }, [handleImportFiles, sourceFilePickerMode, sourceFileInputRef]);

  // ── importVideoLinkIntoSourceItem ──

  const importVideoLinkIntoSourceItem = useCallback(async (
    url: string,
    options?: {
      sourceItemId?: string;
      optimisticTitle?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
    }
  ): Promise<boolean> => {
    const detected = parseVideoLink(url);
    const canonicalUrl = canonicalizeSourceUrl(url);
    const existingByUrl = !options?.sourceItemId && canonicalUrl
      ? useCollectionStore.getState().sourceItems.find((item) => (
          item.provenance?.canonicalUrl === canonicalUrl
          || canonicalizeSourceUrl(item.attachmentUrl) === canonicalUrl
        ))
      : undefined;
    const targetSourceId = options?.sourceItemId || existingByUrl?.id || `video-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTitle = options?.optimisticTitle || (() => {
      try {
        const hostname = new URL(url).hostname.replace(/^www\./i, '');
        if (detected?.providerLabel) {
          return `${detected.providerLabel} 链接`;
        }
        return hostname || '视频链接';
      } catch {
        return detected?.providerLabel ? `${detected.providerLabel} 链接` : '视频链接';
      }
    })();

    const pendingProvenance = buildSourceProvenance({
      ingressChannel: options?.persistSourceType === 'wechat' ? 'wechat' : 'composer',
      sourceUrl: url,
      platformId: detected?.provider,
      platformLabel: detected?.providerLabel,
      isExtracting: true,
    });

    if (options?.sourceItemId || existingByUrl) {
      updateSourceItem(targetSourceId, {
        type: 'video',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        mediaUrl: detected?.playableUrl || url,
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: undefined,
        reviewable: false,
        provenance: pendingProvenance,
      });
    } else {
      appendSourceItem({
        id: targetSourceId,
        type: 'video',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        mediaUrl: detected?.playableUrl || url,
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: undefined,
        reviewable: false,
        provenance: pendingProvenance,
      });
    }

    setActiveSourceImportCount((count) => count + 1);
    setSourceImportError('');

    // 模拟进度阶段文案，让用户感知到后台在做事
    const progressStages = [
      { delay: 0, text: '正在获取视频信息…' },
      { delay: 4000, text: '正在下载音频…' },
      { delay: 12000, text: '正在听懂内容…' },
      { delay: 30000, text: '内容比较长，还在努力…' },
      { delay: 60000, text: '快好了，再等等…' },
    ];
    const progressTimers: ReturnType<typeof setTimeout>[] = [];
    for (const stage of progressStages) {
      progressTimers.push(
        setTimeout(() => {
          updateSourceItem(targetSourceId, { statusText: stage.text });
        }, stage.delay)
      );
    }
    const clearProgressTimers = () => {
      for (const timer of progressTimers) clearTimeout(timer);
    };

    try {
      const response = await fetch('/api/video/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          mode: 'turbo',
          language: 'zh',
          biliCookie: biliCookie || undefined,
        }),
      });

      clearProgressTimers();

      const payload = await readJsonApiResponse<{
        success?: boolean;
        error?: string;
        code?: string;
        detail?: string;
        sourceMode?: ImportedVideoResult['sourceMode'];
        trace?: ImportedVideoSource['importTrace'];
        source?: Partial<ImportedVideoSource>;
        segments?: TranscriptSegment[];
        sentences?: Array<{
          id?: string;
          text?: string;
          beginTime?: number;
          endTime?: number;
          confidence?: number;
        }>;
      }>(response, '链接解析失败');

      if (!response.ok || !payload.success) {
        const friendlyMessage = mapVideoImportError(payload.code, payload.error);
        updateSourceItem(targetSourceId, {
          status: 'failed',
          statusText: friendlyMessage,
          provenance: { ...pendingProvenance, contentState: 'failed' },
        });
        return false;
      }

      const segments = normalizeImportedVideoSegments(payload);
      if (segments.length === 0) {
        updateSourceItem(targetSourceId, {
          title: payload.source?.title || optimisticTitle,
          previewUrl: payload.source?.thumbnailUrl,
          mediaUrl: payload.source?.playableUrl || detected?.playableUrl || url,
          attachmentUrl: payload.source?.originalUrl || url,
          status: 'failed',
          statusText: '导入成功但没听到内容，稍后再试试',
          provenance: { ...pendingProvenance, contentState: 'failed' },
        });
        return false;
      }

      await handleVideoImportReady({
        segments,
        source: {
          provider: payload.source?.provider || detected?.provider || 'generic',
          providerLabel: payload.source?.providerLabel || detected?.providerLabel || 'Web Video',
          originalUrl: payload.source?.originalUrl || url,
          resolvedUrl: payload.source?.resolvedUrl,
          embedUrl: payload.source?.embedUrl || detected?.embedUrl,
          playableUrl: payload.source?.playableUrl || detected?.playableUrl || url,
          title: payload.source?.title,
          durationSec: payload.source?.durationSec,
          thumbnailUrl: payload.source?.thumbnailUrl,
          audioUrl: payload.source?.audioUrl,
          sourceMode: payload.source?.sourceMode || payload.sourceMode,
          bvid: payload.source?.bvid,
          cid: payload.source?.cid,
          importTrace: payload.source?.importTrace || payload.trace,
        },
        sourceMode: payload.sourceMode,
        trace: payload.trace,
      }, {
        sourceItemId: targetSourceId,
        persistSourceKey: options?.persistSourceKey || existingByUrl?.sourceKey,
        persistSourceType: options?.persistSourceType,
        persistRole: options?.persistRole,
        occurredAt: options?.occurredAt,
      });

      return true;
    } catch (err) {
      clearProgressTimers();
      const message = err instanceof Error ? err.message : '导入失败';
      updateSourceItem(targetSourceId, {
        status: 'failed',
        statusText: message,
        provenance: { ...pendingProvenance, contentState: 'failed' },
      });
      return false;
    } finally {
      clearProgressTimers();
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
    }
  }, [appendSourceItem, handleVideoImportReady, setActiveSourceImportCount, setSourceImportError, updateSourceItem]);

  // ── importArticleLinkIntoSourceItem ──

  const importArticleLinkIntoSourceItem = useCallback(async (
    url: string,
    options?: {
      sourceItemId?: string;
      optimisticTitle?: string;
      persistSourceKey?: string;
      persistSourceType?: string;
      persistRole?: SourceIngestRole;
      occurredAt?: string;
      provenance?: SourceProvenance;
    }
  ): Promise<boolean> => {
    const detected = parseVideoLink(url);
    const canonicalUrl = canonicalizeSourceUrl(url);
    const existingByUrl = !options?.sourceItemId && canonicalUrl
      ? useCollectionStore.getState().sourceItems.find((item) => (
          item.provenance?.canonicalUrl === canonicalUrl
          || canonicalizeSourceUrl(item.attachmentUrl) === canonicalUrl
        ))
      : undefined;
    const targetSourceId = options?.sourceItemId || existingByUrl?.id || `article-link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTitle = options?.optimisticTitle || (() => {
      try {
        if (detected?.providerLabel) {
          return `${detected.providerLabel} 文章`;
        }
        const hostname = new URL(url).hostname.replace(/^www\./i, '');
        return hostname || '图文链接';
      } catch {
        return detected?.providerLabel ? `${detected.providerLabel} 文章` : '图文链接';
      }
    })();
    const pendingProvenance = options?.provenance || buildSourceProvenance({
      ingressChannel: 'composer',
      sourceUrl: url,
      isExtracting: true,
    });

    if (options?.sourceItemId || existingByUrl) {
      updateSourceItem(targetSourceId, {
        type: 'text',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: '正在提取文章内容…',
        reviewable: false,
        provenance: pendingProvenance,
      });
    } else {
      appendSourceItem({
        id: targetSourceId,
        type: 'text',
        role: 'primary',
        title: optimisticTitle,
        preview: compactText(url, 120),
        attachmentUrl: url,
        segmentCount: 0,
        origin: 'user',
        status: 'parsing',
        statusText: '正在提取文章内容…',
        reviewable: false,
        provenance: pendingProvenance,
      });
    }

    setActiveSourceImportCount((count) => count + 1);
    setSourceImportError('');

    try {
      const response = await fetch('/api/article/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          provider: detected?.provider,
        }),
      });

      const payload = await readJsonApiResponse<{
        success?: boolean;
        error?: string;
        title?: string;
        content?: string;
        text?: string;
        description?: string;
        author?: string;
        wordCount?: number;
        imageUrls?: string[];
        source?: {
          provider?: string;
          providerLabel?: string;
          originalUrl?: string;
          extractMethod?: string;
        };
        segments?: TranscriptSegment[];
        sentences?: Array<{
          id?: string;
          text?: string;
          beginTime?: number;
          endTime?: number;
          confidence?: number;
        }>;
      }>(response, '文章提取失败');

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || '文章提取失败');
      }

      const segments = normalizeImportedVideoSegments(payload);
      const readyProvenance = buildSourceProvenance({
        ingressChannel: options?.provenance?.ingressChannel || 'composer',
        sourceUrl: payload.source?.originalUrl || url,
        normalizedText: payload.text,
        platformId: payload.source?.provider,
        platformLabel: payload.source?.providerLabel,
        author: payload.author,
        extractionMethod: payload.source?.extractMethod,
        contentState: 'complete',
        completeness: 1,
      });
      if (segments.length === 0) {
        updateSourceItem(targetSourceId, {
          title: payload.title || optimisticTitle,
          attachmentUrl: url,
          status: 'failed',
          statusText: '文章内容为空，稍后再试试',
          provenance: { ...pendingProvenance, contentState: 'failed' },
        });
        return false;
      }

      await ingestTranscriptSegments({
        segments,
        sourceType: 'document',
        sourceTitle: payload.title || optimisticTitle,
        sourceItemId: targetSourceId,
        persistSourceKey: options?.persistSourceKey || existingByUrl?.sourceKey,
        persistSourceType: options?.persistSourceType,
        persistRole: options?.persistRole,
        occurredAt: options?.occurredAt,
        sourceUrl: payload.source?.originalUrl || url,
        provenance: readyProvenance,
      });

      // 补充写入 fullText 和图片信息，供复习态原文展示使用
      updateSourceItem(targetSourceId, {
        fullText: payload.text || segments.map((s) => s.text).join('\n\n'),
        imageUrls: payload.imageUrls?.filter((u) => u.startsWith('http')) || undefined,
        attachmentUrl: payload.source?.originalUrl || url,
        provenance: readyProvenance,
      });

      return true;
    } catch {
      updateSourceItem(targetSourceId, {
        title: optimisticTitle,
        status: 'failed',
        statusText: '文章提取失败，稍后再试试',
        attachmentUrl: url,
        provenance: { ...pendingProvenance, contentState: 'failed' },
      });
      return false;
    } finally {
      setActiveSourceImportCount((count) => Math.max(0, count - 1));
    }
  }, [appendSourceItem, ingestTranscriptSegments, setActiveSourceImportCount, setSourceImportError, updateSourceItem]);

  // ── importComposerVideoLink ──
  // NOTE: composerReach is read from collectionStore.collectionComposerText at call site.
  // We keep it as a thin wrapper. The caller in page.tsx passes composerReach.channel context.

  const importComposerVideoLink = useCallback(async (url: string, composerText?: string) => {
    // 优先使用调用方传入的原始 composerText（避免 store 已被清空）
    const text = composerText ?? useCollectionStore.getState().collectionComposerText;
    const reach = detectReachFromText(text);
    if (reach.channel === 'article-link') {
      await importArticleLinkIntoSourceItem(url);
    } else {
      await importVideoLinkIntoSourceItem(url);
    }
  }, [importVideoLinkIntoSourceItem, importArticleLinkIntoSourceItem]);

  return {
    handleVideoImportReady,
    handleImportFiles,
    handleSourceFileButtonClick,
    handleSourceFileInputChange,
    importVideoLinkIntoSourceItem,
    importArticleLinkIntoSourceItem,
    importComposerVideoLink,
  };
}
