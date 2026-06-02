'use client';

/**
 * ClassroomLeftPanel — 课堂页左侧面板（v4 · 编辑器感排版）
 *
 * 设计目标：从"能用的 UI"升级到"有设计感的空间"。
 * 参考：Things 3 / Linear / Craft——不是 SaaS 管理后台，是一个会呼吸的笔记本。
 *
 * 关键设计决策：
 *   1. 顶部给一个页面大标题"课堂"+ 日期副文案，建立"我在哪儿"的视觉锚点
 *   2. 字号成倍数跳跃：32px 标题 / 16px 卡主标 / 12px Meta / 11px 标签
 *   3. 减色：只保留暖黄作为"正在发生"的唯一强调色，其他一切黑白灰
 *   4. 分组标签用 uppercase tracking 英式小标，不用圆点装饰
 *   5. 活动条改为 白底 + 左侧暖黄细柱 + 黑色主标——克制但焦点明确
 *   6. 主 CTA 改为 黑色主按钮 + 黄点——高级感（像 Linear）
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）
 */

import React, { useMemo } from 'react';
import { Mic, Square, Monitor, Headphones } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Lesson, ClassroomPaneState } from './types';
import { ClassroomLessonCard } from './ClassroomLessonCard';
import { ClassroomRecordingView } from './ClassroomRecordingView';
import { ClassroomHero } from './ClassroomHero';
import { loadDemoLesson } from './DemoLessonLoader';
import { useCaptureEditorActions } from '@/stores/capture-editor-store';
import { isWorkshopAppKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import type { MindMapTree } from '@/hooks/useClassroomMindMap';
import type { RecorderAudioSource } from '@/stores/capture-editor-store';
import type { TranscriptSegment } from '@/types';

/**
 * canCaptureSystemAudio — 浏览器是否能拿到电脑扬声器发出的声音
 *
 * 判据：
 *   - 必须存在 navigator.mediaDevices.getDisplayMedia（iOS Safari 直接没有）
 *   - UA 命中 iOS / Android → 即使 API 存在，浏览器也不会返回 audio track
 *     （Android Chrome 至今不给 system audio，iPadOS Safari 同样）
 *
 * 本函数只在客户端调用，SSR 时返回 false（picker 组件里已用 mounted 兜底）。
 */
function canCaptureSystemAudio(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    return false;
  }
  const ua = navigator.userAgent || '';
  // iOS（含 iPadOS 13+ 会伪装成 Mac，但 touch events + maxTouchPoints 可以识别）
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  if (isIOS || isAndroid) return false;
  return true;
}

export interface ClassroomLeftPanelProps {
  state: ClassroomPaneState;
  lessons: Lesson[];
  /** 点击课堂卡片（仅 ready 态会触发，由卡片内部保证） */
  onOpenLesson: (id: string) => void;
  /** 点击"开始录一节课" */
  onStartRecording: () => void;
  /** 录课中：停止录音。lessonId 传入对应 pill 的课堂 id，便于调用方判断这是真停还是幽灵清理。 */
  onStopRecording: (lessonId?: string) => void;
  /** 录课中：当前计时（秒） */
  recordingSeconds?: number;
  /** 录课中：AI 抓取的关键概念（占位；后续接 Recorder transcript） */
  liveConcepts?: Array<{ id: string; term: string; quote: string; at: number }>;
  /** 录课中：真实转录文本（拼接后整段） */
  transcriptText?: string;
  /** 录课中：真实转录 segments（用于 TranscriptFlowView 分段展示 + 滚定位） */
  segments?: TranscriptSegment[];
  /** 录课中：interim（正在跟读但未落定的文本） */
  interimText?: string;
  /** 录课中：最近 N 句已落定句子（用于 UnderstandingCanvas 下方脉络） */
  recentLines?: Array<{ id: string; text: string; startMs: number }>;
  /** 录课中：思维导图树 */
  mindMapTree?: MindMapTree;
  /** 录课中：最新一批新增节点 id */
  mindMapNewIds?: Set<string>;
  /** 录课中：点击节点跳转录音位置 */
  onMindMapAnchorClick?: (ms: number) => void;
  /** 录课中：由父组件驱动的"把这个 ms 对应段落滚入视野"信号 */
  scrollTarget?: { ms: number; nonce: number } | null;
  /** 点击活动条 → 进入录课态全屏视图 */
  onFocusRecording?: () => void;
  /** 试听课音频播放控制 */
  isDemoPlayback?: boolean;
  demoAudioPlaying?: boolean;
  demoAudioNeedsGesture?: boolean;
  onToggleDemoAudio?: () => void;
  /** 英文试听课默认开启 EN→中 */
  defaultTranslationMode?: 'off' | 'en-zh' | 'zh-en';
  /** 试听课听完后的课后引导 */
  isDemoComplete?: boolean;
  onReplayDemo?: () => void;
  onFinishDemo?: () => void;
  /**
   * 当前选择的录音来源（仅课堂页有意义；收集页一律麦克风）。
   * 由 page.tsx 从 capture-editor-store 注入。
   */
  audioSource?: RecorderAudioSource;
  /** 切换录音来源 */
  onChangeAudioSource?: (source: RecorderAudioSource) => void;
  /**
   * 打开一个 App 应用。hero 的能力预览卡被点击时，会先 loadDemoLesson 再
   * 延迟 320ms 调这个，让用户看到 demo 转录闪进来、再看到窗口冒出来。
   * 由 ClassroomView 从 onOpenApp 透传下来。
   */
  onOpenApp?: (appKey: WorkshopAppKey) => void;
}

function groupLessons(lessons: Lesson[]): Array<{ label: string; items: Lesson[] }> {
  const today = new Date().toISOString().split('T')[0];
  const yest = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  })();

  const map = new Map<string, Lesson[]>();
  for (const l of lessons) {
    const arr = map.get(l.date) ?? [];
    arr.push(l);
    map.set(l.date, arr);
  }

  const sorted = Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  return sorted.map(([date, items]) => ({
    label: date === today ? 'TODAY' : date === yest ? 'YESTERDAY' : formatShortDate(date),
    items,
  }));
}

function formatShortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function audioSourceLabel(source?: RecorderAudioSource): string {
  if (source === 'system') return COPY.recording.sourceSystem;
  if (source === 'mixed') return COPY.recording.sourceMixed;
  return COPY.recording.sourceMic;
}

/** 获取今天日期的中文展示："4 月 18 日 · 周六" */
function formatTodayLabel(): string {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const w = weekdays[now.getDay()];
  return `${m} 月 ${d} 日 · ${w}`;
}

/**
 * PageHeader — 紧凑课堂 hero（v7 Round 9-2 实用概览版）
 *
 * 用户反馈（按 8 条意见整改）：
 *   #1 之前像首页 banner，提供信息少 → 改成"待整理 · 待复习 · 已归档"实用概览
 *   #2 "今日"用 vermilion italic 装饰过强、和"课堂"被拆开 → 统一一行 "今日课堂"，
 *      不再拆开装饰；如果要轻强调，"课堂"用极淡 pine accent line（不是色彩）
 *   #3 主内容栏太窄（max-w-4xl） → 改 max-w-4xl 让标题不截断
 */
function PageHeader({ lessons = [] }: { lessons?: Lesson[] }) {
  // 用真实数据驱动概览数字
  const processingCount = lessons.filter((l) => l.status === 'processing').length;
  const pendingReviewCount = lessons.filter(
    (l) => l.status === 'ready' && !l.reviewed,
  ).length;
  const archivedCount = lessons.filter(
    (l) => l.status === 'ready' && l.reviewed,
  ).length;

  return (
    <div className="flex-shrink-0 px-8 pt-5 pb-4 lg:px-12 lg:pt-6">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-6">
        {/* 左：统一标题"今日课堂"，不再拆开 italic 朱批装饰 */}
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink leading-[1.2] whitespace-nowrap">
          今日课堂
        </h1>

        {/* 右：概览数字 — 真正的"扫一眼知道还有多少事要做" */}
        <div className="flex items-center gap-3 text-[12.5px] flex-shrink min-w-0 overflow-hidden">
          <span className="font-mono uppercase tracking-[0.04em] text-ink-muted whitespace-nowrap">
            {formatTodayLabel()}
          </span>

          {(processingCount > 0 || pendingReviewCount > 0 || archivedCount > 0) ? (
            <span className="h-3 w-px bg-divider flex-shrink-0" aria-hidden />
          ) : null}

          {processingCount > 0 ? (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-pine flex-shrink-0"
                style={{
                  boxShadow: '0 0 0 0 rgba(45,79,62,0.5)',
                  animation: 'rec-pulse-v7 1.6s ease-in-out infinite',
                }}
                aria-hidden
              />
              <span className="font-mono tabular-nums font-medium text-pine">{processingCount}</span>
              <span className="text-pine">待整理</span>
            </span>
          ) : null}

          {pendingReviewCount > 0 ? (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="font-mono tabular-nums font-medium text-vermilion">{pendingReviewCount}</span>
              <span className="text-vermilion">待复习</span>
            </span>
          ) : null}

          {archivedCount > 0 ? (
            <span className="flex items-center gap-1.5 whitespace-nowrap text-ink-muted">
              <span className="font-mono tabular-nums font-medium">{archivedCount}</span>
              <span>已归档</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * ActiveLessonPill — 正在录音的置顶活动条（v4 · 克制版）。
 * 不再用暖黄整片大色块。改成：白底 + 左侧 3px 暖黄细柱 + 黑色主标。
 * 让"正在发生"这件事有焦点，但不吵闹。
 */
function ActiveLessonPill({
  lesson,
  seconds,
  audioSource,
  onFocus,
  onStop,
}: {
  lesson: Lesson;
  seconds: number;
  audioSource?: RecorderAudioSource;
  onFocus: () => void;
  onStop: () => void;
}) {
  return (
    <div className="mb-8">
      <div className="relative overflow-hidden rounded-2xl bg-white px-6 py-5 ring-[0.5px] ring-[#1C1B19]/[0.08]">
        {/* 左侧强调细柱——只有 3px，但因为足够长，视觉上立刻抓住眼睛 */}
        <span className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full bg-[#B5483C]" />

        <div className="flex items-center gap-5 pl-2">
          {/* 红点脉动 + 计时器——用排版代替装饰 */}
          <div className="flex flex-shrink-0 items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B5483C] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#B5483C]" />
            </span>
            <span className="font-mono text-[17px] font-medium tabular-nums tracking-tight text-ink">
              {formatSeconds(seconds)}
            </span>
          </div>

          {/* 中：标题 + 状态 */}
          <button
            type="button"
            onClick={onFocus}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">
              {lesson.title || '正在录一节课'}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {COPY.recording.activeStatus(audioSourceLabel(audioSource))}
            </p>
          </button>

          {/* 右：停止按钮 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-ink text-white transition hover:opacity-85 active:scale-95"
            aria-label="停止录音"
            title="停止录音"
          >
            <Square size={12} strokeWidth={2} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SectionLabel — 日期分组的"英式小标"。
 * 参考 Linear / Things 的分组风格：uppercase + 大字间距 + 数字徽标。
 */
/**
 * SectionLabel — v7 col-head（章节小标）。
 *
 * 设计宪法：mono 字体 = 引用资产语言（章节名 / 数字 / 时间戳都属于"被引用"的内容）。
 * 用 JetBrains Mono + 0.08em letter-spacing 让分组本身被资产化，比 Inter 大写更有层级感。
 */
function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-3 px-1 pb-3">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {label}
      </span>
      <span className="font-mono text-[11px] font-medium tabular-nums text-ink-muted/70">
        {String(count).padStart(2, '0')}
      </span>
      <span className="ml-1 h-px flex-1 bg-divider-light" aria-hidden />
    </div>
  );
}

function EmptyState({
  onStart,
  onTryDemo,
  onCapabilityClick,
  audioSource,
  onChangeAudioSource,
}: {
  onStart: () => void;
  onTryDemo: () => void;
  onCapabilityClick?: (appKey: string) => void;
  audioSource?: RecorderAudioSource;
  onChangeAudioSource?: (source: RecorderAudioSource) => void;
}) {
  return (
    <ClassroomHero
      onTryDemo={onTryDemo}
      onStartRecording={onStart}
      onCapabilityClick={onCapabilityClick}
      audioSource={audioSource}
      onChangeAudioSource={onChangeAudioSource}
    />
  );
}

function ListView({
  activeLesson,
  activeSeconds,
  groups,
  onOpen,
  onStart,
  onTryDemo,
  onCapabilityClick,
  onFocusRecording,
  onStop,
  audioSource,
  onChangeAudioSource,
}: {
  activeLesson: Lesson | null;
  activeSeconds: number;
  groups: Array<{ label: string; items: Lesson[] }>;
  onOpen: (id: string) => void;
  onStart: () => void;
  onTryDemo: () => void;
  onCapabilityClick?: (appKey: string) => void;
  onFocusRecording: () => void;
  onStop: (lessonId?: string) => void;
  audioSource?: RecorderAudioSource;
  onChangeAudioSource?: (source: RecorderAudioSource) => void;
}) {
  const isTrulyEmpty = !activeLesson && groups.length === 0;

  if (isTrulyEmpty) {
    // 零存量态：hero 独占整个视图，不挂 PageHeader / sticky bar。
    // 录音来源必须在首屏可见，否则用户不知道可以录电脑声音。
    return (
      <EmptyState
        onStart={onStart}
        onTryDemo={onTryDemo}
        onCapabilityClick={onCapabilityClick}
        audioSource={audioSource}
        onChangeAudioSource={onChangeAudioSource}
      />
    );
  }

  return (
    <>
      <PageHeader lessons={groups.flatMap((g) => g.items)} />

      <div className="flex-1 overflow-y-auto px-8 pt-2 pb-4 lg:px-12">
        <div className="mx-auto w-full max-w-4xl">
          {/* 1. 正在录音的课 — 置顶活动条 */}
          {activeLesson && (
            <ActiveLessonPill
              lesson={activeLesson}
              seconds={activeSeconds}
              audioSource={audioSource}
              onFocus={onFocusRecording}
              onStop={() => onStop(activeLesson.id)}
            />
          )}

          {/* 2. 历史分组 */}
          <div className="flex flex-col gap-8">
            {groups.map((g, groupIdx) => (
              <div key={g.label}>
                <SectionLabel label={g.label} count={g.items.length} />
                <div className="flex flex-col gap-1.5">
                  {g.items.map((l, itemIdx) => (
                    <ClassroomLessonCard
                      key={l.id}
                      lesson={l}
                      onClick={() => onOpen(l.id)}
                      /* 最新一张（第一组第一张）用 featured 版式，有更大的呼吸 */
                      featured={groupIdx === 0 && itemIdx === 0 && l.status === 'ready'}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 底部留呼吸空间，避免最后一张卡贴着 sticky bar */}
          <div className="h-6" />
        </div>
      </div>

      {/* 底部常驻"开始录课"按钮 */}
      <StickyStartBar
        onStart={onStart}
        disabled={!!activeLesson}
        audioSource={audioSource}
        onChangeAudioSource={onChangeAudioSource}
      />
    </>
  );
}

/**
 * StickyStartBar — 底部常驻的主 CTA（v4 · 黑色主按钮 + 黄点）。
 * Linear / Things 级别的"高级感"来自于黑 + 一点有特征的颜色。
 * 不再用大片暖黄填充。
 *
 * v5（本次改动）：在主按钮上方插入一排「录音来源选择」——
 * 真实场景里同时有「线下讲堂」「在家看网课」两种情况，录音源必须先选对，
 * 否则再好的 ASR/降噪也没法救"麦克风根本没收到课"这种物理问题。
 */
function StickyStartBar({
  onStart,
  disabled = false,
  audioSource = 'mic',
  onChangeAudioSource,
}: {
  onStart: () => void;
  disabled?: boolean;
  audioSource?: RecorderAudioSource;
  onChangeAudioSource?: (source: RecorderAudioSource) => void;
}) {
  return (
    <div className="flex-shrink-0 bg-canvas px-8 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-4 lg:px-12">
      <div className="mx-auto w-full max-w-4xl">
        {disabled ? (
          <div className="flex w-full items-center justify-center gap-2.5 rounded-full bg-[#F0EBDF] py-3.5 text-[13px] text-ink-muted">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#B5483C] animate-pulse" />
            <span>正在录一节课</span>
          </div>
        ) : (
          <>
            {onChangeAudioSource ? (
              <AudioSourcePicker value={audioSource} onChange={onChangeAudioSource} />
            ) : null}
            <button
              type="button"
              onClick={onStart}
              className="group flex w-full items-center justify-center gap-2 rounded-full bg-ink py-3 text-[13.5px] font-medium text-white transition hover:bg-[#1a1a19] active:scale-[0.995]"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-50 group-hover:opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-vermilion" />
              </span>
              <Mic size={13} strokeWidth={2} />
              <span>开始录一节课</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * AudioSourcePicker — 三选一的录音来源。
 *
 * 放在"开始录一节课"按钮上方，分段式 segmented control 风格。
 * 默认高亮「两路都录」——因为这是最鲁棒的缺省（线上课 + 用户提问都能兜住）。
 *
 * 设计：
 *   - 用 hairline 分隔，不用阴影/渐变
 *   - 选中态仅用黑底白字表达，没有色块炫技
 *   - 每个选项下有一行极小的提示，告诉用户"这按钮对应什么物理场景"
 *
 * 为什么不做成下拉菜单：
 *   选项只有 3 个，信息密度允许平铺；
 *   下拉隐藏选项会让用户第一次用时发现不了"哦原来还能录电脑声音"。
 *   这个能力此刻是"救命稻草"，必须长在第一眼看得到的位置。
 */
function AudioSourcePicker({
  value,
  onChange,
}: {
  value: RecorderAudioSource;
  onChange: (source: RecorderAudioSource) => void;
}) {
  // ── 能力检测：手机浏览器（iOS/Android）拿不到电脑扬声器的声音 ──
  // 只在客户端首次挂载后计算一次——SSR 阶段默认"可以"，避免闪动。
  const [canSystem, setCanSystem] = React.useState(true);
  React.useEffect(() => {
    setCanSystem(canCaptureSystemAudio());
  }, []);

  // 如果当前持久化的 value 在此设备上不可用（比如用户在 PC 上选了 system 然后在手机上打开），
  // 自动把它拉回 mic。不做静默——在 render 里再给一行小字说明。
  React.useEffect(() => {
    if (!canSystem && value !== 'mic') {
      onChange('mic');
    }
  }, [canSystem, value, onChange]);

  const options: Array<{
    key: RecorderAudioSource;
    label: string;
    icon: LucideIcon;
    hint: string;
  }> = [
    {
      key: 'mic',
      label: '麦克风',
      icon: Mic,
      hint: '线下课',
    },
    {
      key: 'system',
      label: '电脑声音',
      icon: Monitor,
      hint: '在家听网课',
    },
    {
      key: 'mixed',
      label: '两路都录',
      icon: Headphones,
      hint: '网课＋自己提问',
    },
  ];

  // ── 手机端：只留麦克风，隐藏另外两档 ──
  //
  // taste：不要给用户看用不了的按钮。
  // 把"为什么只有这一档"的理由放在一行小字里说透，不装作一切正常，也不大喊大叫。
  if (!canSystem) {
    return (
      <div className="mb-3">
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2.5 ring-[0.5px] ring-[#1C1B19]/[0.08]">
          <Mic size={14} strokeWidth={2} className="text-ink" />
          <span className="text-[12.5px] font-medium text-ink">麦克风</span>
          <span className="text-[11px] text-ink-muted">· 手机端只支持这一档</span>
        </div>
        <p className="mt-2 px-1 text-[11px] leading-4 text-ink-muted">
          手机浏览器拿不到系统里其他 App 的声音。听网课时把手机靠近扬声器录就行。
        </p>
      </div>
    );
  }

  // ── 桌面端：segmented 三选一 ──
  return (
    <div className="mb-3">
      <div className="grid grid-cols-3 overflow-hidden rounded-2xl bg-white ring-[0.5px] ring-[#1C1B19]/[0.08]">
        {options.map((opt) => {
          const active = value === opt.key;
          const Icon = opt.icon;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={`flex flex-col items-center justify-center gap-1 px-2 py-2.5 text-[12px] transition ${
                active
                  ? 'bg-ink text-white'
                  : 'text-ink hover:bg-[#FAF7F2]'
              }`}
              aria-pressed={active}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Icon size={13} strokeWidth={2} />
                {opt.label}
              </span>
              <span
                className={`text-[10.5px] ${
                  active ? 'text-white/70' : 'text-ink-muted'
                }`}
              >
                {opt.hint}
              </span>
            </button>
          );
        })}
      </div>
      {/* 极轻的一行文字说明当前这档意味着什么——默认留白不喊话，只在电脑声音档位亮出提示 */}
      {value !== 'mic' ? (
        <p className="mt-2 px-1 text-[11px] leading-4 text-ink-muted">
          点"开始"后会弹出系统窗口，请勾选「分享系统音频」或「分享标签页音频」。
        </p>
      ) : null}
    </div>
  );
}

export function ClassroomLeftPanel({
  state,
  lessons,
  onOpenLesson,
  onStartRecording,
  onStopRecording,
  recordingSeconds = 0,
  liveConcepts = [],
  transcriptText,
  segments,
  interimText,
  recentLines,
  mindMapTree,
  mindMapNewIds,
  onMindMapAnchorClick,
  scrollTarget,
  onFocusRecording,
  isDemoPlayback,
  demoAudioPlaying,
  demoAudioNeedsGesture,
  onToggleDemoAudio,
  defaultTranslationMode,
  isDemoComplete,
  onReplayDemo,
  onFinishDemo,
  audioSource,
  onChangeAudioSource,
  onOpenApp,
}: ClassroomLeftPanelProps) {
  const { activeLesson, restLessons } = useMemo(() => {
    let active: Lesson | null = null;
    const rest: Lesson[] = [];
    for (const l of lessons) {
      if (l.status === 'recording' && !active) {
        active = l;
      } else {
        rest.push(l);
      }
    }
    return { activeLesson: active, restLessons: rest };
  }, [lessons]);

  const groups = useMemo(() => groupLessons(restLessons), [restLessons]);
  const captureActions = useCaptureEditorActions();

  /**
   * 点 "试听一节 demo 课"：把 fixture 里的 93s 英语听力灌入 capture store，
   * 然后立刻触发 onFocusRecording，让视图切到课堂详情（里面看到转录已经就绪）。
   * 这条路径完全不打 LLM，直到用户点了任何一个 chip。
   */
  const handleTryDemo = React.useCallback(() => {
    loadDemoLesson({ actions: captureActions });
    if (onFocusRecording) onFocusRecording();
  }, [captureActions, onFocusRecording]);

  /**
   * 点 hero 里的能力卡（速查表 / 闪卡 / 思维导图 / …）——
   * 先灌 demo 课堂，切到录课详情，再延迟 320ms 让对应的 app window 冒出来。
   * 不要立刻开，让用户看到转录先"闪进来"，再看到窗口——这是故事节奏。
   */
  const handleCapabilityClick = React.useCallback((appKey: string) => {
    loadDemoLesson({ actions: captureActions });
    if (onFocusRecording) onFocusRecording();
    if (onOpenApp && isWorkshopAppKey(appKey)) {
      const key: WorkshopAppKey = appKey;
      window.setTimeout(() => onOpenApp(key), 320);
    }
  }, [captureActions, onFocusRecording, onOpenApp]);

  return (
    <div className="relative flex h-full flex-col">
      <div
        key={state}
        className="flex h-full flex-col animate-[fadeIn_240ms_ease-out]"
      >
        {state === 'list' ? (
          <ListView
            activeLesson={activeLesson}
            activeSeconds={recordingSeconds}
            groups={groups}
            onOpen={onOpenLesson}
            onStart={onStartRecording}
            onTryDemo={handleTryDemo}
            onCapabilityClick={handleCapabilityClick}
            onFocusRecording={onFocusRecording ?? (() => { /* noop */ })}
            onStop={onStopRecording}
            audioSource={audioSource}
            onChangeAudioSource={onChangeAudioSource}
          />
        ) : (
          <ClassroomRecordingView
            seconds={recordingSeconds}
            concepts={liveConcepts}
            onStop={onStopRecording}
            transcriptText={transcriptText}
            segments={segments}
            interimText={interimText}
            recentLines={recentLines}
            mindMapTree={mindMapTree}
            mindMapNewIds={mindMapNewIds}
            onAnchorClick={onMindMapAnchorClick}
            scrollTarget={scrollTarget}
            isDemoPlayback={isDemoPlayback}
            demoAudioPlaying={demoAudioPlaying}
            demoAudioNeedsGesture={demoAudioNeedsGesture}
            onToggleDemoAudio={onToggleDemoAudio}
            defaultTranslationMode={defaultTranslationMode}
            isDemoComplete={isDemoComplete}
            onReplayDemo={onReplayDemo}
            onFinishDemo={onFinishDemo}
          />
        )}
      </div>
    </div>
  );
}

export default ClassroomLeftPanel;
