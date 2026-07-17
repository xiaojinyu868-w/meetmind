'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { MobileAppNavigatorProvider, useMobileNav } from './MobileAppNavigator';
import { MobileCollectionCard } from './MobileCollectionCard';
import {
  buildClassroomTimeline,
  resolveMobileWorkshopRecommendation,
  resolveClassroomPhotoTimestamp,
  sortMobileWorkshopApps,
  sortCollectionNewestFirst,
} from './mobile-collection-utils';
import { MobileReviewSheet } from './MobileReviewSheet';
import { LessonDigestCard } from '@/components/LessonDigestCard';
import { useLessonDigest } from '@/hooks/useLessonDigest';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { toast } from 'sonner';
import { Mic, Camera, Paperclip, ArrowUp, ChevronRight, ChevronDown, Layers, Zap, FileText, Brain, Sparkles, MapPin, ExternalLink, Headphones, Newspaper, Image as ImageIcon, Pause, Play } from 'lucide-react';
import type { SourceIngestItem } from '@/types/page-types';
import type { TranscriptSegment } from '@/types';
import { getSpeakerLabel, getSpeakerColorClass } from '@/lib/services/asr/diarization-service';
import { CrossCourseFeedPanel } from '@/components/CrossCourseFeedPanel';
import { COPY } from '@/lib/ui/copy';
import { getProvenanceSourceLabel } from '@/lib/capture/source-provenance';
import { WORKSHOP_APP_CATALOG, getWorkshopAppByKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { MobileAppRunner } from './MobileAppRunner';
import { recommendWorkshopApp } from '@/components/apps/workshop-recommendation';
import { useWorkshopReadiness } from '@/components/apps/hooks/useWorkshopReadiness';
import { ClassroomFlowCanvas } from '@/components/classroom/ClassroomFlowCanvas';
import { useClassroomFlow } from '@/hooks/useClassroomFlow';
import { MobileLearningCommandCenter } from './MobileLearningCommandCenter';
import { ContextRecoveryCard } from '@/components/ContextRecoveryCard';
import { useLearningContext } from '@/hooks/useLearningContext';
import { MobileFirstLearningScreen } from './MobileFirstLearningScreen';
import { selectDemoLiveSegments } from '@/components/classroom/DemoLessonLoader';
import { GUEST_DEMO_LESSON_TITLE } from '@/components/classroom/guest-demo-entry';

export interface MobileAppShellProps {
  children?: React.ReactNode;
  collectionFeedItems: SourceIngestItem[];
  workspaceEchoes: Array<{ id: string; title: string; body: string; chips?: string[]; takeaway?: string; createdAt?: string }>;
  /** 返回 true 后才进入录课页，避免权限失败时出现假的 00:00 录课态。 */
  onStartRecording: () => Promise<boolean>;
  onOpenFilePicker: (mode: 'audio' | 'support' | 'all') => void;
  onOpenReview: (item: SourceIngestItem) => void;
  composerText: string;
  onComposerChange: (text: string) => void;
  onComposerSubmit: () => void;
  onComposerPaste: (e: React.ClipboardEvent) => void;
  onToggleComposerDictation: () => void | Promise<void>;
  composerVoiceStatus: 'idle' | 'connecting' | 'recording' | 'error';
  composerVoiceInterimText: string;
  composerRef: React.RefObject<HTMLTextAreaElement | null> | React.RefObject<HTMLTextAreaElement>;
  segments: TranscriptSegment[];
  sessionId: string | null;
  selectedReviewItem?: SourceIngestItem | null;
  onSeek: (ms: number) => void;
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  isRecording: boolean;
  onStopRecording: () => void;
  onPhotoCaptured: (file: File, capturedAtMs: number) => void;
  reviewSheetContent?: React.ReactNode;
  reviewSheetPreview?: string;
  classmateContent?: React.ReactNode;
  /** 点击 Echo 卡打开 echo 详情 */
  onOpenEcho?: () => void;
  /** 点击搜索按钮打开 AI 搜索 */
  onOpenSearch?: () => void;
  /** 课中快捷提问（suggestion chip 点击） */
  onQuickAsk?: (question: string) => void;
  /** 点击头像打开设置/菜单 */
  onOpenProfile?: () => void;
  /** Echo 列表（用于 echo screen 展示） */
  echoList?: Array<{ id: string; title: string; body: string; takeaway?: string; chips?: string[]; createdAt?: string }>;
  userNickname?: string | null;
  userAvatar?: string | null;
  isAuthenticated: boolean;
  /** 将内置试听音频与分段写入共享课堂上下文。 */
  onStartDemo?: () => Promise<void>;
  /** 显式 entry=demo 时直接进入试听现场。 */
  autoStartDemo?: boolean;
  demoMode?: boolean;
  demoAudioUrl?: string;
}

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSec(sec: number) { return fmtMs(sec * 1000); }

// ── 拍照 input ──

function useCameraCapture(
  onCaptured: (file: File, capturedAtMs: number) => void,
  resolveCapturedAtMs?: (file: File, requestedAtMs: number) => number,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const capturedAtMsRef = useRef<number>(0);
  const trigger = useCallback((capturedAtMs: number) => {
    capturedAtMsRef.current = capturedAtMs;
    inputRef.current?.click();
  }, []);
  const inputEl = (
    <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden"
      onChange={(e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
          const file = files[0];
          onCaptured(file, resolveCapturedAtMs?.(file, capturedAtMsRef.current) ?? capturedAtMsRef.current);
        }
        if (inputRef.current) inputRef.current.value = '';
      }}
    />
  );
  return { trigger, inputEl };
}

// ── 日期分组工具 ──

function getDateGroup(addedAt: string): string {
  const d = new Date(addedAt);
  const now = new Date();
  const diffDay = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDay === 0) return '今天';
  if (diffDay === 1) return '昨天';
  if (diffDay < 7) return `${diffDay}天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function groupByDate(items: SourceIngestItem[]): Array<{ label: string; items: SourceIngestItem[] }> {
  const groups: Array<{ label: string; items: SourceIngestItem[] }> = [];
  for (const item of items) {
    const label = getDateGroup(item.addedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

// ═══ 首页 ═══

function HomeScreen({ p }: { p: MobileAppShellProps }) {
  const { push } = useMobileNav();
  const learning = useLearningContext();
  const echo = p.workspaceEchoes[0];
  const [flashPhoto, setFlashPhoto] = useState<{ url: string; time: string } | null>(null);
  const [flash, setFlash] = useState(false);
  const { trigger: triggerCamera, inputEl: cameraInput } = useCameraCapture((file, capturedAtMs) => {
    p.onPhotoCaptured(file, capturedAtMs);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    const previewUrl = URL.createObjectURL(file);
    setFlashPhoto({ url: previewUrl, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) });
    toast.success('已拍下，正在识别内容…', { duration: 3000 });
  });
  // 移动首页是资料收件箱，不是聊天记录：最新内容应当无需滚动就能看到。
  // 桌面收集流仍保留时间正序，两种场景不共享展示顺序。
  const grouped = useMemo(
    () => groupByDate(sortCollectionNewestFirst(p.collectionFeedItems)),
    [p.collectionFeedItems]
  );
  const hasComposerText = p.composerText.trim().length > 0;
  const isComposerVoiceActive = p.composerVoiceStatus === 'connecting' || p.composerVoiceStatus === 'recording';
  const composerPlaceholder = p.composerVoiceInterimText
    || (p.composerVoiceStatus === 'connecting'
      ? COPY.mobileComposer.connecting
      : p.composerVoiceStatus === 'recording'
        ? COPY.mobileComposer.listening
        : COPY.mobileComposer.placeholder);

  // 清除临时预览卡：OCR 完成（store 新增 image item）或 30s 超时兜底
  useEffect(() => {
    if (!flashPhoto) return;
    const hasNewImage = p.collectionFeedItems.some(i => i.type === 'image' && i.addedAt && Date.now() - new Date(i.addedAt).getTime() < 30000);
    if (hasNewImage) {
      URL.revokeObjectURL(flashPhoto.url);
      setFlashPhoto(null);
      return;
    }
    // 30s 超时兜底（OCR 超慢或失败时）
    const timeout = setTimeout(() => {
      if (flashPhoto) {
        URL.revokeObjectURL(flashPhoto.url);
        setFlashPhoto(null);
        toast.info('识别超时，照片已收下');
      }
    }, 30000);
    return () => clearTimeout(timeout);
  }, [p.collectionFeedItems, flashPhoto]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#FAF7F2]">
      {cameraInput}
      {/* 顶栏 */}
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative h-8 w-8 m-octo-breath">
              <div className="absolute inset-0 rounded-full bg-pine-mist overflow-hidden">
                <img src="/images/octo-buddy/idle.png" alt="" className="h-full w-full object-cover" />
              </div>
            </div>
            <p className="text-[14px] font-semibold leading-tight text-ink">MeetMind</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted" onClick={() => p.onOpenSearch?.()} aria-label={COPY.globalAsk.title} title={COPY.globalAsk.title}>
              <Sparkles size={16} strokeWidth={2} />
            </button>
            <button className="h-7 w-7 rounded-full bg-paper-warm ring-1 ring-divider flex items-center justify-center text-[10px] font-medium text-ink-muted overflow-hidden active:scale-95 transition" onClick={() => p.onOpenProfile?.()}>
              {p.userAvatar ? <img src={p.userAvatar} alt="" className="h-full w-full object-cover" /> : (p.userNickname?.[0] || '林')}
            </button>
          </div>
        </div>
      </div>

      {/* 可滚动区 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-20 mm-mobile-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
        <MobileLearningCommandCenter
          onStartRecording={() => {
            void p.onStartRecording().then((started) => {
              if (started) push('recording');
            });
          }}
          onAddMaterial={() => p.onOpenFilePicker('all')}
          onCapturePhoto={() => triggerCamera(0)}
          onSearch={() => p.onOpenSearch?.()}
        />

        {learning.activeThread?.status === 'active' ? (
          <div className="mt-3">
            <ContextRecoveryCard
              thread={learning.activeThread}
              onResume={() => p.onOpenSearch?.()}
              compact
            />
          </div>
        ) : null}

        {/* 今日发现只做一条上下文入口，不再和学习控制台争夺主视觉。 */}
        {(echo || p.collectionFeedItems.length > 0) && (
          <button
            type="button"
            className="mb-5 mt-3 flex w-full items-center gap-3 rounded-[16px] border border-divider bg-white px-3.5 py-3 text-left transition active:scale-[0.99]"
            onClick={() => push('echo')}
          >
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] bg-pine-mist text-pine">
              <Newspaper size={14} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-pine">
                {COPY.mobileHome.intelligenceLabel}
              </span>
              <span className="mt-1 block truncate text-[12.5px] font-medium text-ink">
                {echo?.title || COPY.mobileHome.intelligenceFallback}
              </span>
            </span>
            <span className="flex items-center gap-0.5 text-[10.5px] font-medium text-ink-muted">
              {COPY.mobileHome.intelligenceAction}
              <ChevronRight size={11} strokeWidth={2} />
            </span>
          </button>
        )}

        {/* 收集流 — 按日期分组 */}
        <div className="flex items-center gap-3 px-1 pb-3">
          <span className="text-[13px] font-semibold text-ink-secondary">{COPY.mobileHome.recentLabel}</span>
          <span className="ml-1 h-px flex-1 bg-divider" />
        </div>

        {/* 拍照 flash 白屏 */}
        {flash && <div className="absolute inset-0 z-50 bg-white pointer-events-none" style={{ opacity: 0.8, transition: 'opacity 0.15s' }} />}

        {/* 拍照后临时预览卡 — OCR 完成前让用户看到照片已收入 */}
        {flashPhoto && (
          <div className="mb-2 m-card-in rounded-[16px] bg-white border-2 border-vermilion/30 p-3">
            <div className="flex items-start gap-2.5">
              <div className="relative h-9 w-9 flex-shrink-0 rounded-lg overflow-hidden bg-vermilion-mist">
                <img src={flashPhoto.url} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink">拍照采集</p>
                <p className="text-[11px] text-ink-muted mt-0.5">{flashPhoto.time} · 正在识别…</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-paper-warm px-1.5 py-0.5 text-[9px] font-medium text-ink-muted mt-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-pine m-rec-dot" />识别中
                </span>
              </div>
              <div className="h-4 w-4 flex-shrink-0 mt-1">
                <div className="h-3 w-3 rounded-full border-2 border-pine/30 border-t-pine animate-spin" />
              </div>
            </div>
          </div>
        )}

        {p.collectionFeedItems.length === 0 && !flashPhoto ? (
          <div className="rounded-[16px] border border-dashed border-divider bg-canvas/40 p-6 text-center">
            <p className="text-[13px] text-ink-muted">{COPY.mobileHome.recentEmpty}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {grouped.map((group, gi) => (
              <React.Fragment key={gi}>
                <div className="flex items-center gap-2 px-1 pb-1 pt-1">
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{group.label}</span>
                  <span className="h-px flex-1 bg-divider/50" />
                </div>
                {group.items.map((item, ii) => (
                  <div key={item.id} className="m-card-in" style={{ animationDelay: `${ii * 0.05}s` }}>
                    <MobileCollectionCard item={item} onClick={() => {
                      const canOpen = item.reviewable || item.type === 'document' || item.type === 'text' || item.type === 'image';
                      if (canOpen) {
                        p.onOpenReview(item);
                        push('review',{
                          sessionId:item.sessionId||'',
                          contentType:item.type==='video'?'video':item.type==='audio'?'audio':'article',
                          title:item.title,
                        });
                      } else toast.info(item.title || '内容暂不可复习');
                    }} />
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* 底部 composer */}
      <div className="flex-shrink-0 bg-paper px-3 py-2 pb-[max(env(safe-area-inset-bottom),8px)] border-t border-divider/60">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={COPY.mobileComposer.attach}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full text-ink-muted flex-shrink-0 hover:bg-canvas active:bg-canvas active:scale-95 focus-visible:ring-2 focus-visible:ring-pine/35 focus-visible:outline-none transition"
            onClick={() => p.onOpenFilePicker('all')}
          >
            <Paperclip size={19} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-[22px] bg-canvas px-4 py-2.5 focus-within:ring-2 focus-within:ring-pine/25">
            <textarea
              ref={p.composerRef as React.RefObject<HTMLTextAreaElement>}
              rows={1}
              value={p.composerText}
              name="mobile-quick-note"
              autoComplete="off"
              aria-label={COPY.mobileComposer.placeholder}
              placeholder={composerPlaceholder}
              className="w-full bg-transparent text-[16px] leading-5 text-ink placeholder:text-ink-muted outline-none resize-none"
              onChange={e => p.onComposerChange(e.target.value)}
              onKeyDown={e => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  p.onComposerSubmit();
                }
              }}
              onPaste={p.onComposerPaste}
            />
          </div>
          {hasComposerText && !isComposerVoiceActive ? (
            <button
              type="button"
              aria-label={COPY.mobileComposer.send}
              className="flex h-11 w-11 flex-shrink-0 touch-manipulation items-center justify-center rounded-full bg-pine text-white shadow-soft hover:bg-pine/90 active:scale-95 focus-visible:ring-2 focus-visible:ring-pine/40 focus-visible:ring-offset-2 focus-visible:outline-none transition"
              onClick={() => p.onComposerSubmit()}
            >
              <ArrowUp size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={isComposerVoiceActive ? COPY.mobileComposer.stopDictation : COPY.mobileComposer.startDictation}
              aria-pressed={isComposerVoiceActive}
              className={`flex h-11 w-11 flex-shrink-0 touch-manipulation items-center justify-center rounded-full active:scale-95 focus-visible:ring-2 focus-visible:ring-vermilion/35 focus-visible:outline-none transition ${isComposerVoiceActive ? 'bg-vermilion-mist text-vermilion' : 'text-ink-muted hover:bg-canvas active:bg-canvas'}`}
              onClick={() => void p.onToggleComposerDictation()}
            >
              <Mic size={19} strokeWidth={2} aria-hidden="true" className={isComposerVoiceActive ? 'animate-pulse motion-reduce:animate-none' : ''} />
            </button>
          )}
          <span className="sr-only" aria-live="polite">
            {p.composerVoiceStatus === 'connecting'
              ? COPY.mobileComposer.connecting
              : p.composerVoiceStatus === 'recording'
                ? COPY.mobileComposer.listening
                : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══ 录课态 ═══

function RecordingScreen({ p }: { p: MobileAppShellProps }) {
  const { pop, replace } = useMobileNav();
  const allSegments = useCaptureEditorStore(s => s.segments);
  const segments = p.demoMode
    ? selectDemoLiveSegments(p.currentTime / 1000)
    : allSegments;
  const liveInterimText = useCaptureEditorStore(s => s.liveInterimText);
  const sessionPhotos = useCollectionStore(s => s.sourceItems).filter(i => (
    i.type === 'image' && i.role === 'support' && Boolean(p.sessionId) && i.sessionId === p.sessionId
  ));
  const photoCount = sessionPhotos.length;
  const [flash, setFlash] = useState(false);
  const [classmateSheet, setClassmateSheet] = useState(false);
  const [recordingPane, setRecordingPane] = useState<'flow' | 'transcript'>('flow');
  const [transMode, setTransMode] = useState<'off' | 'en-zh' | 'zh-en'>(
    p.demoMode ? 'en-zh' : 'off',
  );
  const transLabels: Array<{ mode: typeof transMode; label: string }> = [
    { mode: 'off', label: '译' },
    { mode: 'en-zh', label: 'EN→中' },
    { mode: 'zh-en', label: '中→EN' },
  ];
  const cycleTrans = () => {
    setTransMode(prev => prev === 'off' ? 'en-zh' : prev === 'en-zh' ? 'zh-en' : 'off');
  };
  const transIdx = transLabels.findIndex(t => t.mode === transMode);
  const lastSeg = segments[segments.length - 1];

  // 录课计时器
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingStartAt, setRecordingStartAt] = useState<number | null>(null);
  const demoRecordingStartAt = useMemo(
    () => p.demoMode ? Date.now() : null,
    [p.demoMode],
  );
  useEffect(() => {
    if (!p.isRecording) {
      setRecordingSeconds(0);
      setRecordingStartAt(null);
      return;
    }
    const startAt = Date.now();
    setRecordingStartAt(startAt);
    setRecordingSeconds(0);
    const t = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - startAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [p.isRecording]);

  const {
    flow: classroomFlow,
    newItemIds: classroomFlowNewIds,
    isUnderstanding: isUnderstandingClassroomFlow,
  } = useClassroomFlow({
    enabled: p.isRecording || Boolean(p.demoMode),
    segments,
    recordingStartAt: p.demoMode ? demoRecordingStartAt : recordingStartAt,
  });

  const elapsedSeconds = p.demoMode ? Math.floor(p.currentTime / 1000) : recordingSeconds;
  const demoFinished = Boolean(
    p.demoMode
      && p.totalDuration > 0
      && p.currentTime >= p.totalDuration - 500,
  );
  const finishLesson = () => {
    if (p.demoMode) {
      if (p.isPlaying) p.onPlayPause();
      replace('review', {
        sessionId: p.sessionId || 'guest-demo',
        contentType: 'audio',
        title: GUEST_DEMO_LESSON_TITLE,
        segments: allSegments,
      });
      return;
    }
    p.onStopRecording();
    replace('processing');
  };

  // 拍照
  const { trigger: triggerCamera, inputEl: cameraInput } = useCameraCapture(
    (file, capturedAtMs) => {
      p.onPhotoCaptured(file, capturedAtMs);
      // flash 动画
      setFlash(true);
      setTimeout(() => setFlash(false), 150);
      toast.success(COPY.mobileJourney.photoCapturedAt(fmtMs(capturedAtMs)), { duration: 2200 });
    },
    (file, requestedAtMs) => resolveClassroomPhotoTimestamp({
      requestedAtMs,
      recordingStartedAtEpochMs: recordingStartAt,
      fileLastModifiedEpochMs: file.lastModified,
      capturedAtEpochMs: Date.now(),
    }),
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-canvas m-page-in">
      {cameraInput}
      {/* 顶栏 */}
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60 z-20">
        <div className="flex items-center gap-2.5">
          <button aria-label={COPY.navigation.back} onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="flex items-center gap-1.5">
            <span className="m-rec-dot h-2 w-2 rounded-full bg-vermilion" />
            <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">{fmtSec(elapsedSeconds)}</span>
          </div>
          {p.demoMode ? (
            <button
              type="button"
              onClick={p.onPlayPause}
              className="inline-flex items-center gap-1.5 rounded-full bg-pine-fog px-2.5 py-1 text-[10.5px] font-semibold text-pine"
            >
              {p.isPlaying ? <Pause size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
              {p.isPlaying ? COPY.mobileHome.demoPause : COPY.mobileHome.demoPlay}
            </button>
          ) : (
            <div className="flex items-center gap-[2px] h-5">
              <div className="m-wave-bar w-[3px] bg-vermilion rounded-full" style={{ animationDelay: '0s' }} />
              <div className="m-wave-bar w-[3px] bg-vermilion rounded-full" style={{ animationDelay: '0.1s' }} />
              <div className="m-wave-bar w-[3px] bg-vermilion rounded-full" style={{ animationDelay: '0.2s' }} />
              <div className="m-wave-bar w-[3px] bg-vermilion/60 rounded-full" style={{ animationDelay: '0.3s' }} />
            </div>
          )}
          <div className="flex-1" />
          <button onClick={cycleTrans} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium transition ${transMode !== 'off' ? 'bg-ink text-white' : 'text-ink-muted'}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h7M9 3v2c0 4.418-2.686 8-6 8" /></svg>
            <span>{transLabels[transIdx].label}</span>
          </button>
          <button aria-label={COPY.mobileJourney.finishLesson} onClick={finishLesson} className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white active:scale-90 transition">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          </button>
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-divider/60 bg-paper px-4 py-2">
        <div className="flex rounded-full border border-divider bg-card p-1">
          {(['flow', 'transcript'] as const).map((pane) => (
            <button
              key={pane}
              type="button"
              onClick={() => setRecordingPane(pane)}
              className={`flex-1 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                recordingPane === pane ? 'bg-ink text-white' : 'text-ink-muted'
              }`}
            >
              {pane === 'flow' ? COPY.classroomFlow.mobileFlow : COPY.classroomFlow.mobileTranscript}
            </button>
          ))}
        </div>
      </div>

      {recordingPane === 'flow' ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-white">
          <ClassroomFlowCanvas
            flow={classroomFlow}
            newItemIds={classroomFlowNewIds}
            elapsedMs={elapsedSeconds * 1000}
            isUnderstanding={isUnderstandingClassroomFlow}
          />
        </div>
      ) : null}

      {/* 原话内容区 */}
      {/* LIVE strip（翻译开启时显示最近一句英文/中文） */}
      {recordingPane === 'transcript' && transMode !== 'off' && lastSeg && (
        <div className="flex-shrink-0 bg-paper/95 backdrop-blur border-b border-divider/60 px-4 py-1.5 z-10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[8px] font-bold text-vermilion bg-vermilion-mist px-1.5 py-0.5 rounded flex-shrink-0 m-rec-dot">LIVE</span>
            <p className="text-[11px] leading-snug text-ink-secondary truncate m-line-in">{lastSeg.text}</p>
          </div>
        </div>
      )}
      <div
        className={`${recordingPane === 'transcript' ? 'flex' : 'hidden'} flex-1 min-h-0 flex-col overflow-y-auto px-4 py-3 mm-mobile-scroll`}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {segments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center mb-4 overflow-hidden m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在听</p>
            <p className="text-[13px] text-ink-muted">同桌正在听这节课…</p>
            <p className="text-[11px] text-ink-muted/60 mt-2">老师开口后这里会出现文字</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2 px-1">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-pine">实时文字 · 正在生长</p>
              {sessionPhotos.length > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 font-mono text-[9px] text-vermilion">
                  <Camera size={10} strokeWidth={2} />
                  {sessionPhotos.length}
                </span>
              )}
            </div>
            {/* segments 和 photos 合并按时间排序，照片穿插在对应时间段的文字之间 */}
            {(() => {
              const timeline = buildClassroomTimeline(segments, sessionPhotos);
              return timeline.map((item, i) => {
                if (item.type === 'seg') {
                  const s = item.data;
                  return (
                    <div key={item.key} className="rounded-[14px] border border-divider/70 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] m-line-in" style={{ animationDelay: `${Math.min(i * 0.02, 0.2)}s` }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[9px] text-ink-muted/50">{fmtMs(s.startMs)}</span>
                        {s.speakerId ? (
                          <span className={`text-[9px] font-medium ${getSpeakerColorClass(s.speakerId)}`}>
                            {getSpeakerLabel(s.speakerId)}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[13px] leading-[1.6] text-ink-secondary">{s.text}</p>
                    </div>
                  );
                }
                // photo card — 大尺寸，自然穿插
                const ph = item.data;
                return (
                  <div key={item.key} className="rounded-[14px] border border-vermilion/30 bg-white p-2.5 m-card-in overflow-hidden">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Camera size={11} strokeWidth={2} className="text-vermilion" />
                      <span className="font-mono text-[9px] font-semibold text-vermilion">板书</span>
                      {ph.capturedAtMs != null && (
                        <span className="font-mono text-[9px] text-ink-muted ml-auto">{fmtMs(ph.capturedAtMs)}</span>
                      )}
                    </div>
                    <div className="relative w-full rounded-lg overflow-hidden bg-paper-warm ring-1 ring-divider">
                      {ph.previewUrl || ph.attachmentUrl ? (
                        <img src={ph.previewUrl || ph.attachmentUrl} alt={ph.title || '板书'} className="w-full max-h-48 object-cover" />
                      ) : (
                        <div className="flex h-24 w-full items-center justify-center"><Camera size={20} className="text-ink-muted" /></div>
                      )}
                      {ph.status === 'parsing' && (
                        <div className="absolute inset-0 bg-ink/40 flex items-center justify-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-white animate-pulse" />
                          <span className="font-mono text-[9px] text-white">识别中</span>
                        </div>
                      )}
                    </div>
                    {ph.fullText && ph.status === 'ready' && (
                      <p className="mt-1.5 text-[10px] leading-relaxed text-ink-muted line-clamp-2" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{ph.fullText}</p>
                    )}
                  </div>
                );
              });
            })()}
            {liveInterimText && (
              <div className="rounded-[14px] border border-dashed border-divider bg-canvas/40 p-2.5 m-growing">
                <p className="text-[13px] leading-[1.6] text-ink-muted/60 italic">{liveInterimText}</p>
              </div>
            )}
            {/* "正在生长"占位卡 — 课后整理时会补上 */}
            <div className="rounded-[14px] border border-dashed border-divider bg-canvas/40 p-3 m-growing">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[9px] font-semibold text-ink-muted bg-paper-warm px-1.5 py-0.5 rounded">待整理</span>
                <span className="font-mono text-[9px] text-ink-muted ml-auto">{fmtSec(elapsedSeconds)}</span>
              </div>
              <p className="text-[11px] text-ink-muted leading-relaxed">这段老师还在讲，课后整理笔记时会补上。</p>
            </div>
            <div className="h-20" />
          </div>
        )}
      </div>

      {/* 拍照 flash 白屏 */}
      {flash && <div className="absolute inset-0 z-50 bg-white pointer-events-none" style={{ opacity: 0.8, transition: 'opacity 0.15s' }} />}

      {/* 拍照悬浮按钮 */}
      <button type="button" aria-label={COPY.mobileHome.photo} onClick={() => triggerCamera(elapsedSeconds * 1000)}
        className="fixed bottom-[5.5rem] left-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-vermilion text-white shadow-card active:scale-90 transition lg:hidden relative">
        <Camera size={18} strokeWidth={2} />
        {photoCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-ink flex items-center justify-center border-2 border-paper">
            <span className="font-mono text-[9px] font-bold text-white">{photoCount}</span>
          </span>
        )}
      </button>

      {/* 问同学按钮 */}
      <button type="button" onClick={() => setClassmateSheet(true)}
        className="fixed bottom-[5.5rem] right-4 z-30 flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2.5 text-[12px] font-medium text-white shadow-card active:scale-95 transition m-fab-pulse lg:hidden">
        <div className="relative h-7 w-7 rounded-full overflow-hidden bg-pine-mist m-octo-breath">
          <img src="/images/octo-buddy/happy.png" alt="" className="h-full w-full object-cover" />
        </div>
        <span>问同学</span>
      </button>

      {/* 课中问同学底部 Sheet */}
      {classmateSheet && (
        <div className="absolute left-0 right-0 bottom-0 z-40 bg-white rounded-t-[24px] shadow-[0_-4px_24px_rgba(0,0,0,0.1)] flex flex-col overflow-hidden" style={{ height: '70vh' }}>
          <div className="flex justify-center pt-2.5 pb-1 cursor-grab" onClick={() => setClassmateSheet(false)}>
            <div className="h-1 w-9 rounded-full bg-divider" />
          </div>
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-divider/60">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-full bg-pine-mist overflow-hidden m-octo-breath"><img src="/images/octo-buddy/happy.png" alt="" className="h-full w-full object-cover" /></div>
              <span className="text-[12px] font-medium text-ink">课堂同桌</span>
              <span className="font-mono text-[9px] text-vermilion bg-vermilion-mist px-1.5 py-0.5 rounded">听课中</span>
            </div>
            <button aria-label={COPY.mobileJourney.collapseClassmate} onClick={() => setClassmateSheet(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted"><ChevronDown size={14} strokeWidth={2} /></button>
          </div>
          {/* Suggestion chips */}
          <div className="flex-shrink-0 px-3 py-2 border-b border-divider/40">
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-muted mb-1.5 px-1">同桌觉得你可能想问</p>
            <div className="flex gap-1.5 flex-wrap">
              <button className="rounded-full bg-pine-mist px-3 py-1.5 text-[11.5px] font-medium text-pine active:scale-95" onClick={() => p.onQuickAsk?.('刚才那段没听清，能帮我再讲一下吗？')}>刚才那段没听清</button>
              <button className="rounded-full bg-pine-mist px-3 py-1.5 text-[11.5px] font-medium text-pine active:scale-95" onClick={() => p.onQuickAsk?.('帮我总结一下刚才讲的内容')}>帮我总结一下</button>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button className="rounded-full bg-paper-warm px-2.5 py-1 text-[10.5px] font-medium text-ink-secondary active:scale-95" onClick={() => p.onQuickAsk?.('这段我没跟上，帮我补一下')}>我没跟上</button>
              <button className="inline-flex items-center gap-1 rounded-full bg-vermilion-mist px-2.5 py-1 text-[10.5px] font-medium text-vermilion active:scale-95" onClick={() => toast.success(`已记下 ${fmtSec(elapsedSeconds)}，课后整理时会标注`)}><MapPin size={10} />记一下</button>
            </div>
          </div>
          {/* AI 对话内容 */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {p.classmateContent ?? (
              <div className="flex flex-col items-center justify-center h-full">
                <div className="h-12 w-12 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-3 animate-pulse m-octo-breath">
                  <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
                </div>
                <p className="text-[12px] text-ink-muted">同桌加载中…</p>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex-shrink-0 bg-canvas px-8 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
        {demoFinished ? (
          <p className="mb-2 text-center text-[12px] font-medium text-pine">{COPY.mobileHome.demoFinished}</p>
        ) : null}
        <button onClick={finishLesson}
          className="flex w-full items-center justify-center gap-2.5 rounded-full bg-ink py-3.5 text-[13.5px] font-medium text-white active:scale-[0.995] transition">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          {p.demoMode ? COPY.mobileHome.demoFinish : COPY.mobileJourney.finishLesson}
        </button>
      </div>
    </div>
  );
}

// ═══ 整理态 ═══

function ProcessingScreen({ p }: { p: MobileAppShellProps }) {
  const { replace } = useMobileNav();
  const segments = useCaptureEditorStore(s => s.segments);
  const sessionId = useSessionStore(s => s.sessionId);
  const sourceItems = useCollectionStore(s => s.sourceItems);
  const digestImages = sourceItems.filter(i => i.type==='image'&&i.role==='support').map(i => ({ imageId:i.id, capturedAtMs:i.capturedAtMs??null, title:i.title, ocrText: i.fullText }));

  // 等待 segments 到来：录课停止后 handleRecordingStop 异步写入 segments，
  // 可能比 ProcessingScreen 渲染晚几百毫秒。超时 15s 后放弃。
  const [waitTimedOut, setWaitTimedOut] = useState(false);
  useEffect(() => {
    if (segments.length === 0) {
      const t = setTimeout(() => setWaitTimedOut(true), 15000);
      return () => clearTimeout(t);
    }
    setWaitTimedOut(false);
  }, [segments.length]);

  const { digest, loading } = useLessonDigest({
    sessionId, segments, images: digestImages,
    lessonTitle: p.selectedReviewItem?.title,
    enabled: segments.length > 0,
  });

  // digest 加载完成 → 自动跳到 review。
  // 没有语音时留在当前页给出明确结果，不把用户送进永久 loading 的空复习页。
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (waitTimedOut) return;
    if (!loading && (digest || segments.length > 0)) {
      setDone(true);
      const t = setTimeout(() => replace('review'), done ? 600 : 1500);
      return () => clearTimeout(t);
    }
  }, [loading, digest, segments.length, replace, done, waitTimedOut]);

  const progress = done ? 100 : segments.length > 0 ? Math.min(95, 30 + segments.length * 3) : 10;
  const statusText = waitTimedOut
    ? COPY.mobileJourney.noSpeechStatus
    : done
      ? COPY.mobileJourney.processingDone
      : loading
        ? (segments.length > 0 ? COPY.mobileJourney.buildingNotes : COPY.mobileJourney.readingTranscript)
        : COPY.mobileJourney.waitingTranscript;

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-paper relative overflow-hidden m-page-in">
      {/* 脉冲环 */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="absolute w-32 h-32 rounded-full border border-pine/20 m-pulse-ring" />
        <div className="absolute w-32 h-32 rounded-full border border-pine/15 m-pulse-ring" style={{ animationDelay: '0.7s' }} />
        <div className="absolute w-32 h-32 rounded-full border border-pine/10 m-pulse-ring" style={{ animationDelay: '1.4s' }} />
      </div>

      {/* 轨道粒子 + Octo */}
      <div className="relative flex items-center justify-center mb-8">
        <div className="absolute w-2 h-2 rounded-full bg-pine m-orbit-1" />
        <div className="absolute w-1.5 h-1.5 rounded-full bg-vermilion m-orbit-2" />
        <div className="absolute w-1.5 h-1.5 rounded-full bg-pine/60 m-orbit-3" />
        <div className="relative h-20 w-20 rounded-full bg-pine-mist flex items-center justify-center m-octo-breath overflow-hidden">
          <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
        </div>
      </div>

      <div className="text-center px-8 mb-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-pine mb-2">{COPY.mobileJourney.processingEyebrow}</p>
        <h1 className="font-serif text-[24px] leading-[1.2] tracking-[-0.02em] text-ink mb-3">{COPY.mobileJourney.processingTitleLead}<em className="text-vermilion">{COPY.mobileJourney.processingTitleAccent}</em></h1>
        <p className="text-[12.5px] text-ink-muted mb-4">{statusText}</p>
        <div className="w-[260px] mx-auto">
          <div className="h-1.5 rounded-full bg-divider overflow-hidden">
            <div className="h-full rounded-full bg-pine transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="font-mono text-[9px] text-ink-muted">{Math.floor(progress)}%</span>
            <span className="font-mono text-[9px] text-ink-muted">{loading ? COPY.mobileJourney.processingEstimate : done ? COPY.mobileJourney.done : waitTimedOut ? COPY.mobileJourney.originalPreserved : COPY.mobileJourney.waiting}</span>
          </div>
        </div>
      </div>

      {/* 预览卡（完成后出现） */}
      {done && digest && digest.sections[0] && (
        <div className="m-card-settle w-[300px] rounded-[18px] bg-white border border-divider p-3.5 shadow-soft">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[9px] font-semibold text-pine bg-pine-mist px-1.5 py-0.5 rounded">01</span>
            <p className="text-[12px] font-semibold text-ink truncate">{digest.sections[0].heading}</p>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-muted">{digest.sections[0].text.slice(0, 80)}…</p>
        </div>
      )}

      {/* 跳过 / 完成按钮 */}
      {!done ? (
        <div className="absolute bottom-[max(env(safe-area-inset-bottom),2rem)] left-0 right-0 text-center">
          <button className="text-[11px] text-ink-muted/70 underline" onClick={() => replace('home')}>{COPY.mobileJourney.leaveWhileProcessing}</button>
        </div>
      ) : (
        <button onClick={() => replace('review')}
          className="absolute bottom-[max(env(safe-area-inset-bottom),5rem)] left-0 right-0 mx-auto w-[280px] rounded-full bg-ink py-3 text-[13px] font-medium text-white transition-opacity duration-500">
          {COPY.mobileJourney.openNotes}
        </button>
      )}
    </div>
  );
}

// ═══ 复习态 ═══

function ReviewScreen({ p }: { p: MobileAppShellProps }) {
  const { pop, push, reviewContext, resetToHome } = useMobileNav();
  const [digestView, setDigestView] = useState(true);
  const [sheetHeight, setSheetHeight] = useState<'collapsed' | 'half' | 'full'>('collapsed');
  const [playerCollapsed, setPlayerCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const handledEvidenceFocusRef = useRef<string | null>(null);
  const segments = useCaptureEditorStore(s => s.segments);
  const sessionId = useSessionStore(s => s.sessionId);
  const sourceItems = useCollectionStore(s => s.sourceItems);
  const digestImages = sourceItems.filter(i => i.type==='image'&&i.role==='support').map(i => ({ imageId:i.id, capturedAtMs:i.capturedAtMs??null, title:i.title, ocrText: i.fullText }));
  const { digest, loading: digestLoading } = useLessonDigest({ sessionId, segments, images: digestImages, lessonTitle: reviewContext?.title||p.selectedReviewItem?.title, enabled: digestView && segments.length>0 });
  const getImageUrl = useCallback((id:string) => { const i = sourceItems.find(s=>s.id===id); return i?.previewUrl||i?.attachmentUrl; }, [sourceItems]);
  const getOrig = useCallback((sMs:number,eMs:number) => { const c = segments.filter(s=>s.startMs>=sMs&&s.startMs<=eMs).map(s=>s.text).join(' '); return c||undefined; }, [segments]);
  const selectedItem = p.selectedReviewItem;
  const isArticleReview = reviewContext?.contentType === 'article'
    || selectedItem?.type === 'document'
    || selectedItem?.type === 'text'
    || selectedItem?.type === 'image';
  const articleSourceLabel = getProvenanceSourceLabel(selectedItem?.provenance);
  const { assessment: workshopReadiness } = useWorkshopReadiness({
    transcript: segments,
    contextTitle: reviewContext?.title || selectedItem?.title,
    contextType: p.demoMode
      ? 'demo'
      : reviewContext?.contentType || selectedItem?.type || 'review',
    activeAnchorCount: 0,
  });
  const allowedWorkshopApps = new Set(
    workshopReadiness?.allowedAppKeys ?? WORKSHOP_APP_CATALOG.map((app) => app.key),
  );
  const articleStateLabel = selectedItem?.provenance?.contentState === 'complete'
    ? COPY.sourceState.complete
    : selectedItem?.provenance?.contentState === 'partial'
      ? COPY.sourceState.partial
      : selectedItem?.provenance?.contentState === 'link-only'
        ? COPY.sourceState.linkOnly
        : selectedItem?.provenance?.contentState === 'failed'
          ? COPY.sourceState.failed
          : selectedItem?.provenance?.contentState === 'extracting'
            ? COPY.sourceState.extracting
            : '';
  const [restoreTimedOut, setRestoreTimedOut] = useState(false);
  const focusedTranscriptStartMs = useMemo(() => {
    const focusTimestampMs = reviewContext?.focusTimestampMs;
    if (focusTimestampMs == null || segments.length === 0) return null;
    return segments.reduce((closest, segment) => (
      Math.abs(segment.startMs - focusTimestampMs) < Math.abs(closest.startMs - focusTimestampMs)
        ? segment
        : closest
    )).startMs;
  }, [reviewContext?.focusTimestampMs, segments]);

  useEffect(() => {
    const focusTimestampMs = reviewContext?.focusTimestampMs;
    if (focusTimestampMs == null || focusedTranscriptStartMs == null) return undefined;
    const focusKey = `${sessionId}:${focusTimestampMs}`;
    if (handledEvidenceFocusRef.current === focusKey) return undefined;
    handledEvidenceFocusRef.current = focusKey;
    setDigestView(false);
    const timer = window.setTimeout(() => {
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-transcript-start-ms="${focusedTranscriptStartMs}"]`,
      );
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [focusedTranscriptStartMs, reviewContext?.focusTimestampMs, sessionId]);

  useEffect(() => {
    if (isArticleReview || segments.length > 0) {
      setRestoreTimedOut(false);
      return;
    }
    const timeout = setTimeout(() => setRestoreTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [isArticleReview, segments.length, sessionId]);

  const audioStateLabel = segments.length > 0
    ? p.demoMode
      ? COPY.mobileHome.demoReviewStatus
      : COPY.mobileJourney.understood
    : restoreTimedOut
      ? COPY.mobileJourney.originalPreserved
      : COPY.mobileJourney.processingEyebrow;

  // mini-player 滚动折叠
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setPlayerCollapsed(el.scrollTop > 60);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#FAF7F2] relative m-page-in">
      {/* 顶栏 */}
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60 z-20">
        <div className="flex items-center gap-3">
          <button aria-label={COPY.navigation.back} onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{reviewContext?.title||p.selectedReviewItem?.title||'课堂笔记'}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted font-mono">
              {selectedItem?.addedAt ? `${new Date(selectedItem.addedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})} · ` : ''}
              {articleSourceLabel ? `${articleSourceLabel} · ` : ''}
              {isArticleReview
                ? articleStateLabel || COPY.sourceReader.saved
                : p.totalDuration > 0
                  ? `${fmtMs(p.totalDuration)} · ${audioStateLabel}`
                  : audioStateLabel}
            </p>
          </div>
        </div>
      </div>

      {/* Mini player（滚动时折叠） */}
      {p.totalDuration>0 && (
        <div className={`flex-shrink-0 bg-paper px-4 py-2 border-b border-divider/60 z-10 transition-all duration-300 overflow-hidden ${playerCollapsed ? 'm-mini-player-collapsed' : ''}`}>
          <div className="flex items-center gap-3 rounded-2xl bg-paper-warm/70 px-3 py-2 ring-[0.5px] ring-divider">
            <button aria-label={p.isPlaying ? COPY.mobileJourney.pauseAudio : COPY.mobileJourney.playAudio} onClick={p.onPlayPause} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white active:scale-90 transition">
              {p.isPlaying ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20" /></svg>
              )}
            </button>
            <span className="font-mono text-[11px] font-medium tabular-nums text-ink-secondary">{fmtMs(p.currentTime)}</span>
            <div className="relative h-1.5 flex-1 rounded-full bg-divider cursor-pointer"
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); p.onSeek(((e.clientX-r.left)/r.width)*p.totalDuration); }}>
              <div className="absolute left-0 top-0 h-full rounded-full bg-pine" style={{ width: `${p.totalDuration>0?(p.currentTime/p.totalDuration)*100:0}%` }} />
              <div className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-pine border-2 border-paper shadow-soft"
                style={{ left: `calc(${p.totalDuration>0?(p.currentTime/p.totalDuration)*100:0}% - 6px)` }} />
            </div>
            <span className="font-mono text-[11px] text-ink-muted">{fmtMs(p.totalDuration)}</span>
          </div>
        </div>
      )}

      {/* 笔记 / 转录 切换 */}
      {segments.length>0 && (
        <div className="flex-shrink-0 flex items-center gap-1 px-4 py-2 border-b border-divider/60 bg-paper">
          <div className="inline-flex rounded-full bg-paper-warm p-0.5">
            <button onClick={() => setDigestView(true)} className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${digestView?'bg-white text-ink shadow-soft':'text-ink-muted'}`}>笔记</button>
            <button onClick={() => setDigestView(false)} className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${!digestView?'bg-white text-ink shadow-soft':'text-ink-muted'}`}>转录</button>
          </div>
        </div>
      )}

      {/* 主内容区 */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-28 mm-mobile-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
        {isArticleReview ? (
          <article className="m-card-in rounded-[18px] border border-divider bg-white px-4 py-5">
            <div className="mb-4 border-b border-divider/70 pb-4">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-pine">
                {[articleSourceLabel, articleStateLabel].filter(Boolean).join(' · ') || COPY.sourceReader.saved}
              </p>
              <h1 className="mt-2 font-serif text-[25px] leading-[1.25] tracking-[-0.02em] text-ink">
                {selectedItem?.title || COPY.sourceReader.untitled}
              </h1>
              {selectedItem?.provenance?.author && (
                <p className="mt-2 text-[11px] text-ink-muted">{selectedItem.provenance.author}</p>
              )}
              {selectedItem?.attachmentUrl?.startsWith('http') && (
                <a
                  href={selectedItem.attachmentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-pine"
                >
                  {COPY.sourceReader.openOriginal}<ExternalLink size={11} />
                </a>
              )}
            </div>
            {selectedItem?.imageUrls?.slice(0, 4).map((url) => (
              <img key={url} src={url} alt="" className="mb-4 w-full rounded-xl border border-divider object-cover" />
            ))}
            {selectedItem?.previewUrl && selectedItem.type === 'image' && (
              <img src={selectedItem.previewUrl} alt="" className="mb-4 w-full rounded-xl border border-divider object-contain" />
            )}
            <p className="whitespace-pre-wrap text-[14px] leading-[1.9] text-ink-secondary">
              {selectedItem?.fullText || selectedItem?.preview || COPY.sourceReader.noBody}
            </p>
          </article>
        ) : digestView && segments.length>0 ? (
          digestLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-4 animate-pulse m-octo-breath">
                <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
              </div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在整理</p>
              <p className="text-[12px] text-ink-muted">同桌正在把这节课整理成笔记…</p>
            </div>
          ) : digest ? (
            <div className="space-y-4">
              {/* Digest 卡片 */}
              <LessonDigestCard
                digest={digest}
                onSeek={ms => p.onSeek(ms)}
                getImageUrl={getImageUrl}
                getOriginalTranscript={getOrig}
                onMarkConfusion={() => { setSheetHeight('half'); toast.success('已标记，同桌会帮你讲这段'); }}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-[12px] text-ink-muted mb-3">笔记生成失败</p>
              <button onClick={() => setDigestView(false)} className="rounded-full bg-paper-warm px-3 py-1.5 text-[11px] font-medium text-ink-secondary">查看转录原文</button>
            </div>
          )
        ) : segments.length>0 ? (
          <div className="space-y-2">
            {segments.map(s => (
              <div
                key={s.id}
                data-transcript-start-ms={s.startMs}
                className={`rounded-[14px] border p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-colors ${focusedTranscriptStartMs === s.startMs ? 'border-pine/35 bg-pine-fog' : 'border-divider/70 bg-white'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-[9px] text-ink-muted/50">{fmtMs(s.startMs)}</span>
                  {s.speakerId ? (
                    <span className={`text-[9px] font-medium ${getSpeakerColorClass(s.speakerId)}`}>
                      {getSpeakerLabel(s.speakerId)}
                    </span>
                  ) : null}
                  <button onClick={() => p.onSeek(s.startMs)} className="font-mono text-[9px] text-pine active:scale-95">▶</button>
                </div>
                <p className="text-[13px] leading-[1.6] text-ink-secondary">{s.text}</p>
              </div>
            ))}
          </div>
        ) : restoreTimedOut ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-14 w-14 rounded-full bg-paper-warm flex items-center justify-center overflow-hidden mb-3 m-octo-breath">
              <img src="/images/octo-buddy/idle.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="text-[14px] font-medium text-ink mb-1">{COPY.mobileJourney.noSpeechTitle}</p>
            <p className="max-w-[260px] text-[12px] leading-relaxed text-ink-muted">{COPY.mobileJourney.noSpeechBody}</p>
            <button onClick={resetToHome} className="mt-5 rounded-full bg-ink px-5 py-2.5 text-[12px] font-medium text-white active:scale-95 transition">
              {COPY.mobileJourney.backHome}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-14 w-14 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-3 animate-pulse m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在加载</p>
            <p className="text-[12px] text-ink-muted">{COPY.mobileJourney.restoringTranscript}</p>
          </div>
        )}
      </div>

      {/* 应用矩阵入口 */}
      {segments.length > 0 && workshopReadiness?.status !== 'not_ready' && allowedWorkshopApps.size > 0 && (
        <div className="absolute left-0 right-0 z-30 flex items-center gap-2 px-4 py-2 bg-paper/95 backdrop-blur-sm border-t border-divider/60"
          style={{ bottom: sheetHeight === 'collapsed' ? '52px' : sheetHeight === 'half' ? '55vh' : '92vh', transition: 'bottom 0.3s cubic-bezier(0.32, 0.72, 0, 1)' }}>
          {allowedWorkshopApps.has('flashcards') ? <button onClick={() => push('flashcards')} className="flex items-center gap-1.5 rounded-full bg-pine-mist px-3 py-1.5 text-[11px] font-medium text-pine active:scale-95 transition">
            <Zap size={12} strokeWidth={2} />闪卡
          </button> : null}
          {allowedWorkshopApps.has('quiz') ? <button onClick={() => push('quiz')} className="flex items-center gap-1.5 rounded-full bg-paper-warm px-3 py-1.5 text-[11px] font-medium text-ink-secondary active:scale-95 transition">
            <Brain size={12} strokeWidth={2} />测验
          </button> : null}
          {allowedWorkshopApps.has('cheatsheet') ? <button onClick={() => push('cheatsheet')} className="flex items-center gap-1.5 rounded-full bg-paper-warm px-3 py-1.5 text-[11px] font-medium text-ink-secondary active:scale-95 transition">
            <FileText size={12} strokeWidth={2} />速查表
          </button> : null}
          <div className="flex-1" />
          <button onClick={() => push('apps')} className="flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-white active:scale-95 transition">
            <Layers size={12} strokeWidth={2} />更多
          </button>
        </div>
      )}

      {/* 底部 AI 同桌 Sheet（可拖拽三档 snap） */}
      <MobileReviewSheet
        visible={true}
        previewText={p.reviewSheetPreview || '有问题随时问我'}
        avatar={
          <div className="h-8 w-8 rounded-full bg-pine-mist overflow-hidden m-octo-breath flex-shrink-0">
            <img src="/images/octo-buddy/happy.png" alt="" className="h-full w-full object-cover" />
          </div>
        }
        initialHeight="collapsed"
        onStateChange={setSheetHeight}
      >
        {p.reviewSheetContent ?? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-[12px] text-ink-muted">同桌加载中…</p>
          </div>
        )}
      </MobileReviewSheet>
    </div>
  );
}

// ═══ 应用矩阵 ═══

function AppsScreen({ p: _p }: { p: MobileAppShellProps }) {
  const { pop, push, reviewContext } = useMobileNav();
  const iconByKey: Record<WorkshopAppKey, React.ReactNode> = {
    flashcards: <Zap size={18} strokeWidth={2} />,
    quiz: <Brain size={18} strokeWidth={2} />,
    cheatsheet: <FileText size={18} strokeWidth={2} />,
    mindmap: <Layers size={18} strokeWidth={2} />,
    'audio-overview': <Headphones size={18} strokeWidth={2} />,
    infographic: <ImageIcon size={18} strokeWidth={2} />,
  };
  const recommendation = recommendWorkshopApp({
    activeAnchorCount: 0,
    difficultyCount: 0,
    segmentCount: _p.segments.length,
  });
  const { assessment } = useWorkshopReadiness({
    transcript: _p.segments,
    contextTitle: reviewContext?.title || _p.selectedReviewItem?.title,
    contextType: _p.demoMode
      ? 'demo'
      : reviewContext?.contentType || _p.selectedReviewItem?.type || 'review',
    activeAnchorCount: 0,
  });
  const allowed = new Set(assessment?.allowedAppKeys ?? WORKSHOP_APP_CATALOG.map((app) => app.key));
  const recommendedKey = resolveMobileWorkshopRecommendation(assessment, recommendation.key);
  const apps = sortMobileWorkshopApps(
    WORKSHOP_APP_CATALOG.filter((app) => allowed.has(app.key)),
    recommendedKey,
  );
  const blockedTitle = assessment?.reason === 'not_learning'
    ? COPY.apps.matrix.notLearningTitle
    : assessment?.reason === 'unreliable_transcript'
      ? COPY.apps.matrix.unreliableTitle
      : COPY.apps.matrix.insufficientTitle;
  const blockedBody = assessment?.reason === 'not_learning'
    ? COPY.apps.matrix.notLearningBody
    : assessment?.reason === 'unreliable_transcript'
      ? COPY.apps.matrix.unreliableBody
      : COPY.apps.matrix.insufficientBody;
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center gap-3">
          <button aria-label={COPY.navigation.back} onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div>
            <p className="text-[16px] font-semibold leading-tight text-ink">{COPY.apps.matrix.mobileTitle}</p>
            <p className="mt-1 text-[12px] text-ink-muted">{COPY.apps.matrix.contextBasis(_p.segments.length, 0, 0)}</p>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 mm-mobile-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
        {assessment?.status === 'not_ready' ? (
          <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">{blockedBody}</p>
        ) : null}
        {assessment?.status === 'not_ready' ? (
          <div className="rounded-[18px] border border-divider bg-white px-4 py-5">
            <p className="text-[15px] font-semibold text-ink">{blockedTitle}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-2.5">
          {apps.map((app, i) => (
            (() => {
              const isRecommended = app.key === recommendedKey;
              return (
            <button key={app.key} onClick={() => push(app.key)}
              className={`rounded-[18px] border bg-white px-4 text-left active:scale-[0.99] transition m-card-in ${isRecommended ? 'border-pine/35 py-4 shadow-soft' : 'min-h-[74px] py-3'}`}
              style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="flex items-center gap-3.5">
                <div className={`flex flex-shrink-0 items-center justify-center rounded-[13px] bg-pine-mist text-pine ${isRecommended ? 'h-11 w-11' : 'h-10 w-10'}`}>{iconByKey[app.key]}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-[12px] font-semibold text-pine">{app.learningAction}</p>
                    {isRecommended ? <span className="flex-shrink-0 rounded-full bg-vermilion-mist px-2 py-0.5 text-[11px] font-semibold text-vermilion">{COPY.apps.matrix.recommended}</span> : null}
                  </div>
                  <p className="mt-0.5 text-[15px] font-semibold leading-tight text-ink">{app.name}</p>
                  {isRecommended ? <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-ink-muted">{app.bestFor}</p> : null}
                </div>
                <ChevronRight size={16} className="flex-shrink-0 text-ink-muted" />
              </div>
            </button>
              );
            })()
          ))}
        </div>
      </div>
    </div>
  );
}

function CatalogAppScreen({ p, appKey }: { p: MobileAppShellProps; appKey: WorkshopAppKey }) {
  const { pop, popTo, reviewContext } = useMobileNav();
  const app = getWorkshopAppByKey(appKey)!;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 border-b border-divider/60 bg-paper px-4 pb-2.5 pt-[max(env(safe-area-inset-top),12px)]">
        <div className="flex items-center justify-between">
          <button aria-label={COPY.navigation.back} onClick={() => pop()} className="-ml-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-muted">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="text-center">
            <p className="text-[15px] font-semibold text-ink">{app.name}</p>
            <p className="mt-1 text-[12px] text-ink-muted">{app.learningAction}</p>
          </div>
          <div className="w-8" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <MobileAppRunner
          appKey={appKey}
          sessionId={p.sessionId || 'mobile-session'}
          segments={p.segments}
          contextTitle={reviewContext?.title || p.selectedReviewItem?.title}
          dataSource={p.demoMode ? 'demo' : 'live'}
          onSeek={(ms) => {
            p.onSeek(ms);
            popTo('review', { focusTimestampMs: ms });
          }}
          onReturnToMatrix={pop}
        />
      </div>
    </div>
  );
}

// ═══ 课中问同学 ═══

function ClassmateScreen({ p }: { p: MobileAppShellProps }) {
  const { pop } = useMobileNav();
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center gap-3">
          <button aria-label={COPY.navigation.back} onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-pine-mist overflow-hidden m-octo-breath">
              <img src="/images/octo-buddy/happy.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="text-[15px] font-semibold text-ink">课堂同桌</p>
            <span className="font-mono text-[9px] text-vermilion bg-vermilion-mist px-1.5 py-0.5 rounded">听课中</span>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {p.classmateContent ?? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-4 animate-pulse m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="text-[12px] text-ink-muted">同桌加载中…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ 今日情报（个人上下文 + 目标驱动） ═══

function EchoScreen({ p }: { p: MobileAppShellProps }) {
  const { pop } = useMobileNav();
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#FAF7F2] m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center gap-3">
          <button aria-label={COPY.navigation.back} onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-pine-mist overflow-hidden m-octo-breath">
              <img src="/images/octo-buddy/happy.png" alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-ink">今日情报</p>
              <p className="mt-0.5 text-[9px] text-ink-muted">由你的收藏与目标决定</p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-20 mm-mobile-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
        <CrossCourseFeedPanel
          localCaptures={p.collectionFeedItems}
          onAddContext={() => {
            pop();
            window.requestAnimationFrame(() => p.composerRef.current?.focus());
          }}
          onOpenCapture={(captureId) => {
            const item = p.collectionFeedItems.find((capture) => capture.id === captureId);
            if (item) p.onOpenReview(item);
          }}
          onAskTutor={(text) => p.onQuickAsk?.(text)}
        />
      </div>
    </div>
  );
}

// ═══ 路由 ═══

function ScreenRouter({ p }: { p: MobileAppShellProps }) {
  const { currentScreen, push, replace, resetTo } = useMobileNav();
  const learning = useLearningContext();
  const [hasEnteredEmptyHome, setHasEnteredEmptyHome] = useState(false);
  const hasAutoStartedDemoRef = useRef(false);
  const { autoStartDemo, onStartDemo } = p;
  useEffect(() => {
    if (!autoStartDemo || !onStartDemo || hasAutoStartedDemoRef.current) return;
    hasAutoStartedDemoRef.current = true;
    void onStartDemo()
      .then(() => resetTo('recording'))
      .catch(() => {
        hasAutoStartedDemoRef.current = false;
        toast.error(COPY.mobileHome.demoFailed);
      });
  }, [autoStartDemo, onStartDemo, resetTo]);
  const hasImmediateLearningContext = p.collectionFeedItems.length > 0 || p.workspaceEchoes.length > 0;
  const hasKnownLearningContext = hasImmediateLearningContext
    || learning.memories.some((memory) => memory.status === 'active')
    || learning.recentActivities.length > 0
    || learning.activeThread?.status === 'active';
  if (currentScreen === 'home' && !hasImmediateLearningContext && !learning.hydrated) {
    return (
      <div className="flex flex-1 items-center justify-center bg-paper" aria-busy="true">
        <span className="h-10 w-10 animate-pulse rounded-[14px] bg-pine-mist" aria-hidden />
      </div>
    );
  }
  if (currentScreen === 'home' && !hasKnownLearningContext && !p.isRecording && !hasEnteredEmptyHome) {
    return (
      <MobileFirstLearningScreen
        onStartRecording={() => {
          void p.onStartRecording().then((started) => {
            if (started) push('recording');
          });
        }}
        onAddMaterial={() => p.onOpenFilePicker('all')}
        onAsk={p.onOpenSearch}
        onTryDemo={p.onStartDemo ? () => {
          void p.onStartDemo?.()
            .then(() => push('recording'))
            .catch(() => toast.error(COPY.mobileHome.demoFailed));
        } : undefined}
        onBrowse={() => setHasEnteredEmptyHome(true)}
      />
    );
  }
  switch (currentScreen) {
    case 'home': return <HomeScreen p={p} />;
    case 'recording': return <RecordingScreen p={p} />;
    case 'processing': return <ProcessingScreen p={p} />;
    case 'review': return <ReviewScreen p={p} />;
    case 'flashcards': return <CatalogAppScreen p={p} appKey="flashcards" />;
    case 'quiz': return <CatalogAppScreen p={p} appKey="quiz" />;
    case 'cheatsheet': return <CatalogAppScreen p={p} appKey="cheatsheet" />;
    case 'mindmap': return <CatalogAppScreen p={p} appKey="mindmap" />;
    case 'audio-overview': return <CatalogAppScreen p={p} appKey="audio-overview" />;
    case 'infographic': return <CatalogAppScreen p={p} appKey="infographic" />;
    case 'apps': return <AppsScreen p={p} />;
    case 'classmate': return <ClassmateScreen p={p} />;
    case 'echo': return <EchoScreen p={p} />;
    case 'empty': return (
      <MobileFirstLearningScreen
        onStartRecording={() => {
          void p.onStartRecording().then((started) => {
            if (started) push('recording');
          });
        }}
        onAddMaterial={() => p.onOpenFilePicker('all')}
        onAsk={p.onOpenSearch}
        onTryDemo={p.onStartDemo ? () => {
          void p.onStartDemo?.()
            .then(() => push('recording'))
            .catch(() => toast.error(COPY.mobileHome.demoFailed));
        } : undefined}
        onBrowse={() => { setHasEnteredEmptyHome(true); replace('home'); }}
      />
    );
    default: return <HomeScreen p={p} />;
  }
}

export function MobileAppShell(props: MobileAppShellProps) {
  const demoAudioRef = useRef<HTMLAudioElement | null>(null);
  const [demoCurrentTime, setDemoCurrentTime] = useState(0);
  const [demoDuration, setDemoDuration] = useState(0);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const demoProps = props.demoMode ? {
    ...props,
    currentTime: demoCurrentTime,
    totalDuration: demoDuration,
    isPlaying: demoPlaying,
    onPlayPause: () => {
      const audio = demoAudioRef.current;
      if (!audio) return;
      if (audio.paused) {
        void audio.play().catch(() => toast.error(COPY.mobileHome.demoFailed));
      } else {
        audio.pause();
      }
    },
  } : props;

  return (
    <MobileAppNavigatorProvider>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {props.demoMode ? (
          <audio
            ref={demoAudioRef}
            src={props.demoAudioUrl || '/demo-audio.mp3'}
            preload="metadata"
            className="sr-only"
            aria-hidden
            onLoadedMetadata={(event) => setDemoDuration(event.currentTarget.duration * 1000)}
            onTimeUpdate={(event) => setDemoCurrentTime(event.currentTarget.currentTime * 1000)}
            onPlay={() => setDemoPlaying(true)}
            onPause={() => setDemoPlaying(false)}
            onEnded={() => setDemoPlaying(false)}
          />
        ) : null}
        <ScreenRouter p={demoProps} />
        {props.children}
      </div>
    </MobileAppNavigatorProvider>
  );
}

export default MobileAppShell;
