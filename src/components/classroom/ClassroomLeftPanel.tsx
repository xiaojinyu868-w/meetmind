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
 * 设计系统：零渐变、零阴影、纯平涂
 */

import React, { useMemo } from 'react';
import { Mic, Square } from 'lucide-react';
import type { Lesson, ClassroomPaneState } from './types';
import { ClassroomLessonCard } from './ClassroomLessonCard';
import { ClassroomRecordingView } from './ClassroomRecordingView';

export interface ClassroomLeftPanelProps {
  state: ClassroomPaneState;
  lessons: Lesson[];
  /** 点击课堂卡片（仅 ready 态会触发，由卡片内部保证） */
  onOpenLesson: (id: string) => void;
  /** 点击"开始录一节课" */
  onStartRecording: () => void;
  /** 录课中：停止录音 */
  onStopRecording: () => void;
  /** 录课中：当前计时（秒） */
  recordingSeconds?: number;
  /** 录课中：AI 抓取的关键概念（占位；后续接 Recorder transcript） */
  liveConcepts?: Array<{ id: string; term: string; quote: string; at: number }>;
  /** 录课中：真实转录文本（拼接后整段） */
  transcriptText?: string;
  /** 点击活动条 → 进入录课态全屏视图 */
  onFocusRecording?: () => void;
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
 * PageHeader — 页面顶部的大标题锚点。
 * 参考 Things 3 / Craft 的扉页手感：大字 + 小字副文案 + 极细分割线。
 */
function PageHeader() {
  return (
    <div className="flex-shrink-0 px-8 pt-10 pb-5 lg:px-12 lg:pt-12">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-muted/80">
          {formatTodayLabel()}
        </p>
        <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.025em] text-ink leading-[1.1]">
          课堂
        </h1>
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
  onFocus,
  onStop,
}: {
  lesson: Lesson;
  seconds: number;
  onFocus: () => void;
  onStop: () => void;
}) {
  return (
    <div className="mb-8">
      <div className="relative overflow-hidden rounded-2xl bg-white px-6 py-5 ring-[0.5px] ring-[#232322]/[0.08]">
        {/* 左侧强调细柱——只有 3px，但因为足够长，视觉上立刻抓住眼睛 */}
        <span className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full bg-[#E8C547]" />

        <div className="flex items-center gap-5 pl-2">
          {/* 红点脉动 + 计时器——用排版代替装饰 */}
          <div className="flex flex-shrink-0 items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D96B6B] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D96B6B]" />
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
              正在听 · 点开看实时转录
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
function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-3 px-1 pb-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-secondary">
        {label}
      </span>
      <span className="text-[11px] font-medium tabular-nums text-ink-muted/70">
        {count}
      </span>
    </div>
  );
}

function EmptyState({ onStart: _onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-20">
      <p className="text-[17px] font-medium tracking-[-0.01em] text-ink">
        录下第一节课
      </p>
      <p className="mt-2 max-w-[22rem] text-center text-[13.5px] leading-relaxed text-ink-muted">
        点下面那颗按钮就能录。录完之后，我会帮你整理重点、生成一张回声卡。
      </p>
    </div>
  );
}

function ListView({
  activeLesson,
  activeSeconds,
  groups,
  onOpen,
  onStart,
  onFocusRecording,
  onStop,
}: {
  activeLesson: Lesson | null;
  activeSeconds: number;
  groups: Array<{ label: string; items: Lesson[] }>;
  onOpen: (id: string) => void;
  onStart: () => void;
  onFocusRecording: () => void;
  onStop: () => void;
}) {
  const isTrulyEmpty = !activeLesson && groups.length === 0;

  if (isTrulyEmpty) {
    return (
      <>
        <PageHeader />
        <EmptyState onStart={onStart} />
        <StickyStartBar onStart={onStart} />
      </>
    );
  }

  return (
    <>
      <PageHeader />

      <div className="flex-1 overflow-y-auto px-8 pt-2 pb-4 lg:px-12">
        <div className="mx-auto w-full max-w-2xl">
          {/* 1. 正在录音的课 — 置顶活动条 */}
          {activeLesson && (
            <ActiveLessonPill
              lesson={activeLesson}
              seconds={activeSeconds}
              onFocus={onFocusRecording}
              onStop={onStop}
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
      <StickyStartBar onStart={onStart} disabled={!!activeLesson} />
    </>
  );
}

/**
 * StickyStartBar — 底部常驻的主 CTA（v4 · 黑色主按钮 + 黄点）。
 * Linear / Things 级别的"高级感"来自于黑 + 一点有特征的颜色。
 * 不再用大片暖黄填充。
 */
function StickyStartBar({
  onStart,
  disabled = false,
}: {
  onStart: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex-shrink-0 bg-canvas px-8 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-4 lg:px-12">
      <div className="mx-auto w-full max-w-2xl">
        {disabled ? (
          <div className="flex w-full items-center justify-center gap-2.5 rounded-full bg-[#F0F0ED] py-3.5 text-[13px] text-ink-muted">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#D96B6B] animate-pulse" />
            <span>正在录一节课</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="group flex w-full items-center justify-center gap-2.5 rounded-full bg-ink py-4 text-[14px] font-medium text-white transition hover:bg-[#1a1a19] active:scale-[0.995]"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#E8C547] opacity-50 group-hover:opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#E8C547]" />
            </span>
            <Mic size={14} strokeWidth={2} />
            <span>开始录一节课</span>
          </button>
        )}
      </div>
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
  onFocusRecording,
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
            onFocusRecording={onFocusRecording ?? (() => { /* noop */ })}
            onStop={onStopRecording}
          />
        ) : (
          <ClassroomRecordingView
            seconds={recordingSeconds}
            concepts={liveConcepts}
            onStop={onStopRecording}
            transcriptText={transcriptText}
          />
        )}
      </div>
    </div>
  );
}

export default ClassroomLeftPanel;
