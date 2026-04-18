'use client';

/**
 * ClassroomLeftPanel — 课堂页左侧面板
 *
 * 承载课堂内容的两种视图态：
 *   - list：课堂列表（时间流：今天 / 昨天 / 更早）
 *   - recording：录课中（关键概念气泡 + 录音状态）
 *
 * detail（课堂详情/复习）不在这里——那是 viewMode='review'，
 * 由 page.tsx 顶层路由切到 DesktopVideoReviewLayout。
 *
 * v3 产品决策（顶级 HCI 视角）：
 *   1. 「正在录音」的课从列表里抽出，升级为**列表顶部置顶的活动条**
 *      → 进行中的任务 > 历史；用户眼球第一眼就看到它
 *   2. 底部「开始录一节课」按钮 sticky，永远可达——全局主 CTA 不允许被滚走
 *   3. 空态文案更有"邀请感"，说清楚第一步做什么
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

  // 按日期倒序
  const sorted = Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  return sorted.map(([date, items]) => ({
    label: date === today ? '今天' : date === yest ? '昨天' : formatShortDate(date),
    items,
  }));
}

function formatShortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)} 月 ${Number(d)} 日`;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/**
 * ActiveLessonPill — 正在录音的置顶活动条。
 * 视觉上比任何列表卡都"重"——暖黄底、脉动红点、带计时器、带停止按钮。
 * 它是此刻全页面最重要的东西。
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
    <div className="mb-5">
      <div className="relative overflow-hidden rounded-2xl bg-[#FDF3C0] px-5 py-4 ring-[0.5px] ring-[#8B6914]/15">
        <div className="flex items-center gap-4">
          {/* 左：状态徽标 */}
          <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/70 text-[#8B6914] ring-[0.5px] ring-[#8B6914]/10">
            <Mic size={19} strokeWidth={1.7} />
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D96B6B] opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#D96B6B]" />
            </span>
          </div>

          {/* 中：主标题 + 状态 */}
          <button
            type="button"
            onClick={onFocus}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">
              {lesson.title || '正在录一节课'}
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-[12.5px] text-[#8B6914]">
              <span className="font-mono tabular-nums">{formatSeconds(seconds)}</span>
              <span className="text-[#8B6914]/45">·</span>
              <span>正在听</span>
            </p>
          </button>

          {/* 右：停止按钮（主动作） */}
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
            <Square size={13} strokeWidth={2} fill="currentColor" />
          </button>
        </div>

        {/* 底部微提示：告诉用户点击中间可以看细节 */}
        <button
          type="button"
          onClick={onFocus}
          className="mt-3 block w-full text-left text-[11.5px] text-[#8B6914]/75 hover:text-[#8B6914] transition"
        >
          点开看实时转录 →
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FDF3C0] text-[#8B6914]">
        <Mic size={20} strokeWidth={1.6} />
      </div>
      <p className="mt-5 text-[15px] font-medium tracking-[-0.01em] text-ink">
        录下第一节课，我开始陪你
      </p>
      <p className="mt-1.5 max-w-[20rem] text-center text-[13px] leading-relaxed text-ink-muted">
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
        <EmptyState onStart={onStart} />
        <StickyStartBar onStart={onStart} primary />
      </>
    );
  }

  // 今天占位（有活动课或今天已有课则跳过）
  const today = new Date().toISOString().split('T')[0];
  const hasToday = groups.some((g) => g.label === '今天');
  const showTodayPlaceholder = !hasToday && !activeLesson;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 pt-6 pb-4">
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

          {/* 2. 今天占位（只在没课也没录音时显示） */}
          {showTodayPlaceholder && (
            <div className="mb-5">
              <div className="flex items-center gap-1.5 px-1 pb-2 text-[11px] font-medium tracking-wide text-ink-muted">
                <span className="inline-flex h-1 w-1 rounded-full bg-ink-muted/60" />
                <span>今天</span>
              </div>
              <div className="rounded-xl border border-dashed border-[#E2E2DE] bg-canvas/40 px-4 py-3.5 text-[13.5px] text-ink-muted">
                今天还没有课
              </div>
            </div>
          )}

          {/* 3. 历史分组 */}
          <div className="flex flex-col">
            {groups.map((g) => (
              <div key={g.label} className="mb-5 last:mb-0">
                <div className="flex items-center gap-1.5 px-1 pb-2 text-[11px] font-medium tracking-wide text-ink-muted">
                  <span className="inline-flex h-1 w-1 rounded-full bg-ink-muted/60" />
                  <span>{g.label}</span>
                  <span className="text-ink-muted/50">· {g.items.length} 节课</span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {g.items.map((l) => (
                    <ClassroomLessonCard
                      key={l.id}
                      lesson={l}
                      onClick={() => onOpen(l.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 底部常驻"开始录课"按钮——主 CTA，视觉权重最高 */}
      <StickyStartBar onStart={onStart} primary={!activeLesson} disabled={!!activeLesson} />
    </>
  );
}

/**
 * StickyStartBar — 底部常驻的主 CTA。
 *   primary=true：暖黄填充 + 深色字，最高权重（空态 / 列表态无录音时）
 *   disabled=true：已经在录一节课了，按钮变灰，提示"正在录一节课"
 */
function StickyStartBar({
  onStart,
  primary = true,
  disabled = false,
}: {
  onStart: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex-shrink-0 border-t border-[#E9E9E7]/70 bg-canvas px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-3">
      <div className="mx-auto w-full max-w-2xl">
        {disabled ? (
          <div className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#F0F0ED] py-3.5 text-[13.5px] text-ink-muted">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[#D96B6B] animate-pulse" />
            正在录一节课
          </div>
        ) : primary ? (
          <button
            type="button"
            onClick={onStart}
            className="group flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[#FDF3C0] py-4 text-[14.5px] font-medium text-ink ring-[0.5px] ring-[#8B6914]/20 transition hover:ring-[#8B6914]/40 active:scale-[0.995]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-white transition group-hover:opacity-90">
              <Mic size={14} strokeWidth={2} />
            </span>
            开始录一节课
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3.5 text-[14px] font-medium text-ink ring-[0.5px] ring-[#232322]/[0.08] transition hover:ring-[#232322]/[0.2] active:scale-[0.995]"
          >
            <Mic size={15} strokeWidth={1.7} className="text-[#8B6914]" />
            开始录一节课
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
  // 从 lessons 里拆出"正在录音"那一条，置顶展示；列表里排除它避免重复
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
      {/* 两种视图态同一个容器内淡入，保证"同一个空间的时态变化" */}
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
            onFocusRecording={onFocusRecording ?? (() => { /* noop: 外部未挂就点不了 */ })}
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
