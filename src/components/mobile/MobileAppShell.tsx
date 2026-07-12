'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { MobileAppNavigatorProvider, useMobileNav } from './MobileAppNavigator';
import { MobileCollectionCard } from './MobileCollectionCard';
import { MobileReviewSheet } from './MobileReviewSheet';
import { LessonDigestCard } from '@/components/LessonDigestCard';
import { useLessonDigest } from '@/hooks/useLessonDigest';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useSessionStore } from '@/stores/session-store';
import { useCollectionStore } from '@/stores/collection-store';
import { toast } from 'sonner';
import { Mic, Camera, Edit3, Paperclip, ChevronRight, ChevronDown, Layers, Zap, FileText, Brain, Search, Star, MapPin } from 'lucide-react';
import type { SourceIngestItem } from '@/types/page-types';
import type { TranscriptSegment } from '@/types';
import { getSpeakerLabel, getSpeakerColorClass } from '@/lib/services/asr/diarization-service';
import { CrossCourseFeedPanel } from '@/components/CrossCourseFeedPanel';

export interface MobileAppShellProps {
  children?: React.ReactNode;
  collectionFeedItems: SourceIngestItem[];
  workspaceEchoes: Array<{ id: string; title: string; body: string; chips?: string[]; takeaway?: string; createdAt?: string }>;
  onStartRecording: () => void;
  onOpenFilePicker: (mode: 'audio' | 'support' | 'all') => void;
  onOpenReview: (item: SourceIngestItem) => void;
  composerText: string;
  onComposerChange: (text: string) => void;
  onComposerSubmit: () => void;
  onComposerPaste: (e: React.ClipboardEvent) => void;
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
  flashcardsContent?: React.ReactNode;
  quizContent?: React.ReactNode;
  cheatsheetContent?: React.ReactNode;
  mindmapContent?: React.ReactNode;
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
}

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function fmtSec(sec: number) { return fmtMs(sec * 1000); }

// ── 拍照 input ──

function useCameraCapture(onCaptured: (file: File, capturedAtMs: number) => void) {
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
        if (files && files.length > 0) onCaptured(files[0], capturedAtMsRef.current);
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
  const grouped = useMemo(() => groupByDate(p.collectionFeedItems), [p.collectionFeedItems]);

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
            <div>
              <p className="text-[13px] font-semibold text-ink leading-tight">MeetMind</p>
              <p className="font-mono text-[9px] text-ink-muted">{new Date().toLocaleDateString('zh-CN',{month:'numeric',day:'numeric',weekday:'short'})}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted" onClick={() => p.onOpenSearch?.()}>
              <Search size={16} strokeWidth={2} />
            </button>
            <button className="h-7 w-7 rounded-full bg-paper-warm ring-1 ring-divider flex items-center justify-center text-[10px] font-medium text-ink-muted overflow-hidden active:scale-95 transition" onClick={() => p.onOpenProfile?.()}>
              {p.userAvatar ? <img src={p.userAvatar} alt="" className="h-full w-full object-cover" /> : (p.userNickname?.[0] || '林')}
            </button>
          </div>
        </div>
      </div>

      {/* 可滚动区 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-20 mm-mobile-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
        <h1 className="font-serif text-[24px] leading-[1.15] tracking-[-0.02em] text-ink mb-3">今天学点什么？</h1>

        {/* 采集三按钮 */}
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          <button type="button" onClick={() => { p.onStartRecording(); push('recording'); }}
            className="col-span-3 flex items-center gap-3 rounded-[18px] bg-white border-2 border-vermilion/20 p-3.5 text-left active:scale-[0.98] transition m-card-in">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-vermilion-mist">
              <Mic size={18} strokeWidth={2} className="text-vermilion" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-vermilion">录一节课</p>
              <p className="text-[11px] text-ink-muted mt-0.5">课堂 · 讲座 · 随时听</p>
            </div>
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-vermilion" />
            </span>
          </button>
          <button type="button" onClick={() => triggerCamera(0)}
            className="rounded-[16px] bg-white border border-divider p-3 text-center active:scale-95 transition m-card-in">
            <div className="flex h-9 w-9 mx-auto items-center justify-center rounded-full bg-vermilion-mist mb-1.5">
              <Camera size={16} strokeWidth={2} className="text-vermilion" />
            </div>
            <p className="text-[12px] font-semibold text-ink">拍一下</p>
          </button>
          <button type="button" onClick={() => p.composerRef.current?.focus()}
            className="col-span-2 rounded-[16px] bg-white border border-divider p-3 flex items-center gap-2.5 text-left active:scale-[0.98] transition m-card-in">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-pine-mist">
              <Edit3 size={16} strokeWidth={2} className="text-pine" />
            </div>
            <div><p className="text-[12px] font-semibold text-ink">速记一句</p><p className="text-[10px] text-ink-muted">想法 · 疑问 · 课后笔记</p></div>
          </button>
        </div>

        {/* 今日情报：整理只是入口，还会给出上下文关联和外部发现。 */}
        {(echo || p.collectionFeedItems.length > 0) && (
          <div className="mb-4 m-card-in cursor-pointer" onClick={() => push('echo')}>
            <div className="rounded-[18px] border border-pine/20 bg-pine-mist/50 p-4 shadow-soft active:scale-[0.99] transition">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="h-7 w-7 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden m-octo-breath flex-shrink-0">
                  <img src="/images/octo-buddy/happy.png" alt="" className="h-full w-full object-cover" />
                </div>
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-pine">今日情报</span>
                <span className="font-mono text-[9px] text-ink-muted ml-auto">{echo?.createdAt ? new Date(echo.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}) : new Date().toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})}</span>
              </div>
              <p className="text-[13px] font-semibold leading-[1.5] text-ink mb-1.5" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {echo?.title || '你收集的内容正在形成新线索'}
              </p>
              <p className="text-[12px] leading-[1.65] text-ink-secondary" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {echo?.body
                  ? `${echo.body.slice(0, 200)}${echo.body.length > 200 ? '…' : ''}`
                  : `基于 ${p.collectionFeedItems.length} 条收藏和你的目标，寻找值得继续看的内外部信息。`}
              </p>
              {echo?.takeaway && (
                <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-vermilion-mist/50 px-2.5 py-1.5">
                  <span className="font-mono text-[9px] font-semibold text-vermilion flex-shrink-0">带走</span>
                  <p className="text-[11px] leading-relaxed text-ink-secondary">{echo.takeaway}</p>
                </div>
              )}
              <p className="mt-2.5 text-[11px] font-medium text-pine flex items-center gap-1">
                查看今日情报 <ChevronRight size={10} strokeWidth={2.5} />
              </p>
            </div>
          </div>
        )}

        {/* 收集流 — 按日期分组 */}
        <div className="flex items-baseline gap-2 px-1 pb-2.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">最近</span>
          <span className="font-mono text-[10px] text-ink-muted/70">{String(p.collectionFeedItems.length).padStart(2,'0')}</span>
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
            <p className="text-[12px] text-ink-muted">还没有内容。录一节课或速记一句开始吧。</p>
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
                      if (item.reviewable) {
                        p.onOpenReview(item);
                        push('review',{sessionId:item.sessionId||'',contentType:item.type==='video'?'video':item.type==='image'?'article':'audio',title:item.title});
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
          <button className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted flex-shrink-0" onClick={() => p.onOpenFilePicker('all')}>
            <Paperclip size={16} strokeWidth={2} />
          </button>
          <div className="flex-1 rounded-full bg-canvas px-3.5 py-2">
            <textarea ref={p.composerRef as React.RefObject<HTMLTextAreaElement>} rows={1} value={p.composerText}
              placeholder="发一句想法，贴个链接…"
              className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-muted outline-none resize-none"
              onChange={e => p.onComposerChange(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); p.onComposerSubmit(); toast.success('已记录'); } }}
              onPaste={p.onComposerPaste}
            />
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted flex-shrink-0" onClick={() => p.onOpenFilePicker('audio')}>
            <Mic size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══ 录课态 ═══

function RecordingScreen({ p }: { p: MobileAppShellProps }) {
  const { pop, push, replace } = useMobileNav();
  const segments = useCaptureEditorStore(s => s.segments);
  const liveInterimText = useCaptureEditorStore(s => s.liveInterimText);
  const sessionPhotos = useCollectionStore(s => s.sourceItems).filter(i => i.type === 'image' && i.role === 'support' && (!i.sessionId || i.sessionId === p.sessionId));
  const photoCount = sessionPhotos.length;
  const [flash, setFlash] = useState(false);
  const [classmateSheet, setClassmateSheet] = useState(false);
  const [transMode, setTransMode] = useState<'off' | 'en-zh' | 'zh-en'>('off');
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
  useEffect(() => {
    if (!p.isRecording) { setRecordingSeconds(0); return; }
    const startAt = Date.now();
    setRecordingSeconds(0);
    const t = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - startAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [p.isRecording]);

  // 拍照
  const { trigger: triggerCamera, inputEl: cameraInput } = useCameraCapture((file, capturedAtMs) => {
    p.onPhotoCaptured(file, capturedAtMs);
    // flash 动画
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    toast.success(`已拍下板书 · 锚点 ${fmtSec(recordingSeconds)}`, { duration: 2200 });
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-canvas m-page-in">
      {cameraInput}
      {/* 顶栏 */}
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60 z-20">
        <div className="flex items-center gap-2.5">
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="flex items-center gap-1.5">
            <span className="m-rec-dot h-2 w-2 rounded-full bg-vermilion" />
            <span className="font-mono text-[14px] font-semibold tabular-nums text-ink">{fmtSec(recordingSeconds)}</span>
          </div>
          {/* 波形条 */}
          <div className="flex items-center gap-[2px] h-5">
            <div className="m-wave-bar w-[3px] bg-vermilion rounded-full" style={{ animationDelay: '0s' }} />
            <div className="m-wave-bar w-[3px] bg-vermilion rounded-full" style={{ animationDelay: '0.1s' }} />
            <div className="m-wave-bar w-[3px] bg-vermilion rounded-full" style={{ animationDelay: '0.2s' }} />
            <div className="m-wave-bar w-[3px] bg-vermilion/60 rounded-full" style={{ animationDelay: '0.3s' }} />
          </div>
          <div className="flex-1" />
          <button onClick={cycleTrans} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium transition ${transMode !== 'off' ? 'bg-ink text-white' : 'text-ink-muted'}`}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h7M9 3v2c0 4.418-2.686 8-6 8" /></svg>
            <span>{transLabels[transIdx].label}</span>
          </button>
          <button onClick={() => { p.onStopRecording(); replace('processing'); }} className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white active:scale-90 transition">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          </button>
        </div>
      </div>

      {/* 转录内容区 */}
      {/* LIVE strip（翻译开启时显示最近一句英文/中文） */}
      {transMode !== 'off' && lastSeg && (
        <div className="flex-shrink-0 bg-paper/95 backdrop-blur border-b border-divider/60 px-4 py-1.5 z-10">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[8px] font-bold text-vermilion bg-vermilion-mist px-1.5 py-0.5 rounded flex-shrink-0 m-rec-dot">LIVE</span>
            <p className="text-[11px] leading-snug text-ink-secondary truncate m-line-in">{lastSeg.text}</p>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 mm-mobile-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
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
                <span className="font-mono text-[9px] text-vermilion ml-auto">📷 {sessionPhotos.length}</span>
              )}
            </div>
            {/* segments 和 photos 合并按时间排序，照片穿插在对应时间段的文字之间 */}
            {(() => {
              const recentSegs = segments.slice(-15).filter((s, i, arr) => {
                // 文本级去重：如果和前一条标准化文本相同，跳过
                if (i === 0) return true;
                const prev = arr[i - 1];
                const a = s.text.trim().replace(/[\s,，。.!！？？、的了的了]/g, '');
                const b = prev.text.trim().replace(/[\s,，。.!！？？、的了的了]/g, '');
                return a !== b;
              });
              type TimelineItem = { type: 'seg'; data: TranscriptSegment; key: string } | { type: 'photo'; data: typeof sessionPhotos[0]; key: string };
              const timeline: TimelineItem[] = [];
              for (const s of recentSegs) timeline.push({ type: 'seg', data: s, key: s.id });
              for (const ph of sessionPhotos) {
                const ts = ph.capturedAtMs ?? 0;
                if (ts === 0) { timeline.push({ type: 'photo', data: ph, key: ph.id }); continue; }
                // 找到第一条 startMs > capturedAtMs 的 segment，把照片插在它前面
                const idx = timeline.findIndex(it => it.type === 'seg' && it.data.startMs > ts);
                if (idx === -1) timeline.push({ type: 'photo', data: ph, key: ph.id });
                else timeline.splice(idx, 0, { type: 'photo', data: ph, key: ph.id });
              }
              return timeline.slice(-20).map((item, i) => {
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
                      {ph.capturedAtMs != null && ph.capturedAtMs > 0 && (
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
                <span className="font-mono text-[9px] text-ink-muted ml-auto">{fmtSec(recordingSeconds)}</span>
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
      <button type="button" onClick={() => triggerCamera(recordingSeconds * 1000)}
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
            <button onClick={() => setClassmateSheet(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted"><ChevronDown size={14} strokeWidth={2} /></button>
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
              <button className="rounded-full bg-vermilion-mist px-2.5 py-1 text-[10.5px] font-medium text-vermilion active:scale-95" onClick={() => toast.success(`已记下 ${fmtSec(recordingSeconds)}，课后整理时会标注`)}>📍 记一下</button>
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
        <button onClick={() => { p.onStopRecording(); replace('processing'); }}
          className="flex w-full items-center justify-center gap-2.5 rounded-full bg-ink py-3.5 text-[13.5px] font-medium text-white active:scale-[0.995] transition">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          结束这节课
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

  // digest 加载完成 → 自动跳到 review
  // 或者 segments 超时为空 → 直接去 review 让用户看到兜底空态
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (waitTimedOut) {
      // segments 等了 15s 还没来 → 录课可能没产生任何转录，直接去 review
      const t = setTimeout(() => replace('review'), 600);
      return () => clearTimeout(t);
    }
    if (!loading && (digest || segments.length > 0)) {
      setDone(true);
      const t = setTimeout(() => replace('review'), done ? 600 : 1500);
      return () => clearTimeout(t);
    }
  }, [loading, digest, segments.length, replace, done, waitTimedOut]);

  const progress = done ? 100 : segments.length > 0 ? Math.min(95, 30 + segments.length * 3) : 10;
  const statusText = waitTimedOut ? '录音处理超时，直接查看…' : done ? '整理完成' : loading ? (segments.length > 0 ? '正在生成分段笔记…' : '正在读转录原文…') : '等待转录完成…';

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
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-pine mb-2">正在整理</p>
        <h1 className="font-serif text-[24px] leading-[1.2] tracking-[-0.02em] text-ink mb-3">把这节课<em className="text-vermilion">听懂</em></h1>
        <p className="text-[12.5px] text-ink-muted mb-4">{statusText}</p>
        <div className="w-[260px] mx-auto">
          <div className="h-1.5 rounded-full bg-divider overflow-hidden">
            <div className="h-full rounded-full bg-pine transition-all duration-700" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="font-mono text-[9px] text-ink-muted">{Math.floor(progress)}%</span>
            <span className="font-mono text-[9px] text-ink-muted">{loading ? '约 1 分钟' : done ? '完成' : waitTimedOut ? '超时' : '等待中…'}</span>
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
          <button className="text-[11px] text-ink-muted/60 underline" onClick={() => replace('review')}>先去做别的 →</button>
        </div>
      ) : (
        <button onClick={() => replace('review')}
          className="absolute bottom-[max(env(safe-area-inset-bottom),5rem)] left-0 right-0 mx-auto w-[280px] rounded-full bg-ink py-3 text-[13px] font-medium text-white transition-opacity duration-500">
          笔记整理好了，去看看 →
        </button>
      )}
    </div>
  );
}

// ═══ 复习态 ═══

function ReviewScreen({ p }: { p: MobileAppShellProps }) {
  const { pop, push, reviewContext } = useMobileNav();
  const [digestView, setDigestView] = useState(true);
  const [sheetHeight, setSheetHeight] = useState<'collapsed' | 'half' | 'full'>('collapsed');
  const [playerCollapsed, setPlayerCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const segments = useCaptureEditorStore(s => s.segments);
  const sessionId = useSessionStore(s => s.sessionId);
  const sourceItems = useCollectionStore(s => s.sourceItems);
  const digestImages = sourceItems.filter(i => i.type==='image'&&i.role==='support').map(i => ({ imageId:i.id, capturedAtMs:i.capturedAtMs??null, title:i.title, ocrText: i.fullText }));
  const { digest, loading: digestLoading } = useLessonDigest({ sessionId, segments, images: digestImages, lessonTitle: reviewContext?.title||p.selectedReviewItem?.title, enabled: digestView && segments.length>0 });
  const getImageUrl = useCallback((id:string) => { const i = sourceItems.find(s=>s.id===id); return i?.previewUrl||i?.attachmentUrl; }, [sourceItems]);
  const getOrig = useCallback((sMs:number,eMs:number) => { const c = segments.filter(s=>s.startMs>=sMs&&s.startMs<=eMs).map(s=>s.text).join(' '); return c||undefined; }, [segments]);

  // mini-player 滚动折叠
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setPlayerCollapsed(el.scrollTop > 60);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const sheetHeightPx = sheetHeight === 'collapsed' ? '56px' : sheetHeight === 'half' ? '340px' : '60vh';

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#FAF7F2] relative m-page-in">
      {/* 顶栏 */}
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60 z-20">
        <div className="flex items-center gap-3">
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{reviewContext?.title||p.selectedReviewItem?.title||'课堂笔记'}</p>
            <p className="mt-0.5 text-[11px] text-ink-muted font-mono">
              {p.selectedReviewItem?.addedAt ? `${new Date(p.selectedReviewItem.addedAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})} · ` : ''}{p.totalDuration>0?`${fmtMs(p.totalDuration)} · `:''}已理解
            </p>
          </div>
        </div>
      </div>

      {/* Mini player（滚动时折叠） */}
      {p.totalDuration>0 && (
        <div className={`flex-shrink-0 bg-paper px-4 py-2 border-b border-divider/60 z-10 transition-all duration-300 overflow-hidden ${playerCollapsed ? 'm-mini-player-collapsed' : ''}`}>
          <div className="flex items-center gap-3 rounded-2xl bg-paper-warm/70 px-3 py-2 ring-[0.5px] ring-divider">
            <button onClick={p.onPlayPause} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white active:scale-90 transition">
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
        {digestView && segments.length>0 ? (
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
              {/* 课堂总结标题 */}
              <div className="m-card-in">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine">课堂总结</p>
                <h1 className="mt-1.5 font-serif text-[26px] leading-[1.15] tracking-[-0.02em] text-ink">
                  {reviewContext?.title||p.selectedReviewItem?.title||'课堂笔记'}
                </h1>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
                  本节课共 {segments.length} 段转录，已整理为 {digest.sections.length} 个知识点。
                </p>
              </div>
              {/* Digest 卡片 */}
              <LessonDigestCard
                digest={digest}
                onSeek={ms => p.onSeek(ms)}
                getImageUrl={getImageUrl}
                getOriginalTranscript={getOrig}
                onMarkConfusion={() => { setSheetHeight('half'); toast.success('已标记，同桌会帮你讲这段'); }}
              />
              {/* AI 建议卡 */}
              <div className="m-card-in rounded-[20px] border border-pine/15 bg-pine-mist/20 p-4">
                <div className="flex items-start gap-2.5 mb-3">
                  <div className="h-7 w-7 flex-shrink-0 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden m-octo-breath">
                    <img src="/images/octo-buddy/happy.png" alt="" className="h-full w-full object-cover" />
                  </div>
                  <p className="text-[12px] leading-relaxed text-ink">
                    这节课已整理完毕。可以试试下面的应用加深理解。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button onClick={() => push('flashcards')} className="rounded-2xl border border-divider bg-white p-3 text-left active:scale-[0.98] transition">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Zap size={13} strokeWidth={2} className="text-pine" />
                      <span className="text-[12px] font-medium text-ink">练闪卡</span>
                    </div>
                    <p className="text-[10.5px] text-ink-muted">核心概念</p>
                  </button>
                  <button onClick={() => push('cheatsheet')} className="rounded-2xl border border-divider bg-white p-3 text-left active:scale-[0.98] transition">
                    <div className="flex items-center gap-2 mb-0.5">
                      <FileText size={13} strokeWidth={2} className="text-pine" />
                      <span className="text-[12px] font-medium text-ink">速查表</span>
                    </div>
                    <p className="text-[10.5px] text-ink-muted">一页纸复习</p>
                  </button>
                </div>
              </div>
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
              <div key={s.id} className="rounded-[14px] border border-divider/70 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
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
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-14 w-14 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-3 animate-pulse m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在加载</p>
            <p className="text-[12px] text-ink-muted">正在恢复这节课的转录内容…</p>
          </div>
        )}
      </div>

      {/* 应用矩阵入口 */}
      {segments.length > 0 && (
        <div className="absolute left-0 right-0 z-30 flex items-center gap-2 px-4 py-2 bg-paper/95 backdrop-blur-sm border-t border-divider/60"
          style={{ bottom: sheetHeight === 'collapsed' ? '52px' : sheetHeight === 'half' ? '55vh' : '92vh', transition: 'bottom 0.3s cubic-bezier(0.32, 0.72, 0, 1)' }}>
          <button onClick={() => push('flashcards')} className="flex items-center gap-1.5 rounded-full bg-pine-mist px-3 py-1.5 text-[11px] font-medium text-pine active:scale-95 transition">
            <Zap size={12} strokeWidth={2} />闪卡
          </button>
          <button onClick={() => push('quiz')} className="flex items-center gap-1.5 rounded-full bg-paper-warm px-3 py-1.5 text-[11px] font-medium text-ink-secondary active:scale-95 transition">
            <Brain size={12} strokeWidth={2} />测验
          </button>
          <button onClick={() => push('cheatsheet')} className="flex items-center gap-1.5 rounded-full bg-paper-warm px-3 py-1.5 text-[11px] font-medium text-ink-secondary active:scale-95 transition">
            <FileText size={12} strokeWidth={2} />速查表
          </button>
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

// ═══ 闪卡全屏 ═══

function FlashcardsScreen({ p }: { p: MobileAppShellProps }) {
  const { pop, reviewContext } = useMobileNav();
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center justify-between">
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <div className="text-center">
            <p className="text-[13px] font-semibold text-ink">闪卡练习</p>
            {reviewContext?.title && <p className="font-mono text-[9px] text-ink-muted">{reviewContext.title}</p>}
          </div>
          <div className="w-8" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {p.flashcardsContent ?? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-4 animate-pulse m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在生成</p>
            <p className="text-[12px] text-ink-muted">闪卡生成中…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ 测验全屏 ═══

function QuizScreen({ p }: { p: MobileAppShellProps }) {
  const { pop } = useMobileNav();
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center justify-between">
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <p className="text-[13px] font-semibold text-ink">随堂测验</p>
          <div className="w-8" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {p.quizContent ?? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-4 animate-pulse m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在生成</p>
            <p className="text-[12px] text-ink-muted">测验生成中…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ 速查表全屏 ═══

function CheatsheetScreen({ p }: { p: MobileAppShellProps }) {
  const { pop } = useMobileNav();
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center justify-between">
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <p className="text-[13px] font-semibold text-ink">考试速查表</p>
          <div className="w-8" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {p.cheatsheetContent ?? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-4 animate-pulse m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在生成</p>
            <p className="text-[12px] text-ink-muted">速查表生成中…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ 思维导图全屏 ═══

function MindmapScreen({ p }: { p: MobileAppShellProps }) {
  const { pop } = useMobileNav();
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center justify-between">
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <p className="text-[13px] font-semibold text-ink">思维导图</p>
          <div className="w-8" />
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {p.mindmapContent ?? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="h-16 w-16 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden mb-4 animate-pulse m-octo-breath">
              <img src="/images/octo-buddy/thinking.png" alt="" className="h-full w-full object-cover" />
            </div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-pine mb-1">正在生成</p>
            <p className="text-[12px] text-ink-muted">思维导图生成中…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ 应用矩阵 ═══

function AppsScreen({ p: _p }: { p: MobileAppShellProps }) {
  const { pop, push } = useMobileNav();
  const apps: Array<{ key: string; name: string; icon: React.ReactNode; desc: string }> = [
    { key: 'flashcards', name: '闪卡', icon: <Zap size={18} strokeWidth={2} className="text-pine" />, desc: '记忆卡片' },
    { key: 'quiz', name: '测验', icon: <Brain size={18} strokeWidth={2} className="text-pine" />, desc: '随堂自测' },
    { key: 'cheatsheet', name: '速查表', icon: <FileText size={18} strokeWidth={2} className="text-pine" />, desc: '一页纸' },
    { key: 'mindmap', name: '思维导图', icon: <Layers size={18} strokeWidth={2} className="text-pine" />, desc: '知识结构' },
  ];
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper m-page-in">
      <div className="flex-shrink-0 bg-paper px-4 pt-[max(env(safe-area-inset-top),12px)] pb-2.5 border-b border-divider/60">
        <div className="flex items-center gap-3">
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
            <ChevronRight size={18} strokeWidth={2} className="rotate-180" />
          </button>
          <p className="text-[15px] font-semibold text-ink">应用</p>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 mm-mobile-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="grid grid-cols-2 gap-3">
          {apps.map((app, i) => (
            <button key={app.key} onClick={() => push(app.key as any)}
              className="rounded-[16px] bg-white border border-divider p-3 text-left active:scale-[0.98] transition m-card-in"
              style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pine-mist mb-2">{app.icon}</div>
              <p className="text-[13px] font-semibold text-ink">{app.name}</p>
              <p className="text-[10px] text-ink-muted mt-0.5">{app.desc}</p>
            </button>
          ))}
        </div>
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
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
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
          <button onClick={() => pop()} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted -ml-1">
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

// ═══ 空课堂 ═══

function EmptyScreen({ p }: { p: MobileAppShellProps }) {
  const { push } = useMobileNav();
  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-paper px-8 m-page-in">
      <div className="relative h-24 w-24 mb-6">
        <div className="absolute inset-0 rounded-full bg-pine-mist flex items-center justify-center overflow-hidden m-octo-breath">
          <img src="/images/octo-buddy/idle.png" alt="" className="h-full w-full object-cover" />
        </div>
      </div>
      <h1 className="font-serif text-[26px] leading-[1.15] tracking-[-0.02em] text-ink text-center mb-2">录第一节课<em className="text-vermilion">试试</em></h1>
      <p className="text-[13px] text-ink-muted text-center leading-relaxed mb-8 max-w-[260px]">打开麦克风录一节课，同桌帮你听懂、整理成笔记。</p>
      <button onClick={() => { p.onStartRecording(); push('recording'); }}
        className="flex w-full max-w-[280px] items-center justify-center gap-2.5 rounded-full bg-ink py-3.5 text-[14px] font-medium text-white active:scale-[0.98] transition">
        <Mic size={16} strokeWidth={2} />录一节课
      </button>
      <button onClick={() => push('home')} className="mt-3 text-[12px] text-ink-muted underline">已有内容，进入 →</button>
    </div>
  );
}

// ═══ 路由 ═══

function ScreenRouter({ p }: { p: MobileAppShellProps }) {
  const { currentScreen } = useMobileNav();
  if (currentScreen==='home' && p.collectionFeedItems.length===0 && !p.isRecording) return <EmptyScreen p={p} />;
  switch (currentScreen) {
    case 'home': return <HomeScreen p={p} />;
    case 'recording': return <RecordingScreen p={p} />;
    case 'processing': return <ProcessingScreen p={p} />;
    case 'review': return <ReviewScreen p={p} />;
    case 'flashcards': return <FlashcardsScreen p={p} />;
    case 'quiz': return <QuizScreen p={p} />;
    case 'cheatsheet': return <CheatsheetScreen p={p} />;
    case 'mindmap': return <MindmapScreen p={p} />;
    case 'apps': return <AppsScreen p={p} />;
    case 'classmate': return <ClassmateScreen p={p} />;
    case 'echo': return <EchoScreen p={p} />;
    case 'empty': return <EmptyScreen p={p} />;
    default: return <HomeScreen p={p} />;
  }
}

export function MobileAppShell(props: MobileAppShellProps) {
  return (
    <MobileAppNavigatorProvider>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <ScreenRouter p={props} />
        {props.children}
      </div>
    </MobileAppNavigatorProvider>
  );
}

export default MobileAppShell;
