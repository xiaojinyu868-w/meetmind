'use client';

/**
 * ClassroomLessonCard — 一张"课"的卡片（v4 · 编辑器感）
 *
 * 设计决策：
 *   1. featured 模式：最新一张 ready 卡 2 倍留白 + 加重点数强调
 *   2. 去除 Badge 背景色块——改成左侧小点（类似 Things 的 checkbox 圆）
 *   3. 时间和元信息排版重构：time 用稍大字号，其他元素更弱
 *   4. hover 效果：ring 变深 + 极细微上浮 1px（不用 shadow）
 *   5. 减色：除了 recording 态的红点脉动，其他全部黑白灰
 *
 * 设计系统：零渐变、零阴影、纯平涂
 */

import React from 'react';
import { ChevronRight, Sparkles, FileText, Check } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import type { Lesson } from './types';

export interface ClassroomLessonCardProps {
  lesson: Lesson;
  onClick: () => void;
  /** 最新一张 ready 卡：更大呼吸 + 强调重点数 */
  featured?: boolean;
}

/** 左侧状态小点（取代原来的 StatusBadge 色块，更克制） */
function StatusDot({ lesson }: { lesson: Lesson }) {
  switch (lesson.status) {
    case 'recording':
      return (
        <span className="relative mt-[7px] flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-500 opacity-50" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-danger-500" />
        </span>
      );
    case 'processing':
      return (
        <span className="mt-[7px] flex h-2.5 w-2.5 flex-shrink-0 animate-pulse-slow rounded-full bg-ink-muted" />
      );
    case 'failed':
      return (
        <span className="mt-[7px] flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-ink-muted" />
      );
    case 'upcoming':
      return (
        <span className="mt-[7px] flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-sand-dark" />
      );
    case 'ready':
    default:
      return (
        <span className="mt-[7px] flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-divider" />
      );
  }
}

/** 时间 · 时长 · 状态（主副信息行） */
function MetaLine({ lesson, featured }: { lesson: Lesson; featured?: boolean }) {
  const parts: React.ReactNode[] = [];

  // time 作为主锚点——稍大，tabular-nums
  parts.push(
    <span key="t" className="font-mono tabular-nums text-ink-secondary">
      {lesson.time}
    </span>
  );

  if (lesson.status === 'upcoming') {
    parts.push(<span key="up">即将开始</span>);
  } else if (lesson.status === 'recording') {
    parts.push(<span key="r" className="font-medium text-warning-700">正在录音</span>);
  } else if (lesson.status === 'processing') {
    parts.push(<span key="p">正在理解…</span>);
  } else {
    if (lesson.durationMin) {
      parts.push(<span key="d">{lesson.durationMin} 分钟</span>);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-muted ${featured ? 'mt-2 text-[13px]' : 'mt-1 text-[12.5px]'}`}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-ink-muted/40">·</span>}
          {p}
        </React.Fragment>
      ))}
    </div>
  );
}

/** 底部徽标：回声 / 已复习 / 关联资料 */
function TagLine({ lesson }: { lesson: Lesson }) {
  const tags: React.ReactNode[] = [];

  if (lesson.status === 'ready' && lesson.hasEcho) {
    tags.push(
      <span key="echo" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <Sparkles size={12} strokeWidth={1.8} className="text-warning-700" />
        {COPY.lesson.summaryReady}
      </span>
    );
  }
  if (lesson.status === 'ready' && lesson.keyPoints && lesson.keyPoints > 0) {
    tags.push(
      <span key="kp" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <span className="tabular-nums font-medium">{lesson.keyPoints}</span>
        <span className="text-ink-muted">{COPY.lesson.keyPoints}</span>
      </span>
    );
  }
  if (lesson.reviewed) {
    tags.push(
      <span key="rev" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <Check size={12} strokeWidth={2} />
        {COPY.lesson.reviewed}
      </span>
    );
  }
  if (lesson.linkedMaterials && lesson.linkedMaterials > 0) {
    tags.push(
      <span key="mat" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <FileText size={12} strokeWidth={1.7} />
        {COPY.lesson.materials(lesson.linkedMaterials)}
      </span>
    );
  }

  if (tags.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {tags}
    </div>
  );
}

function lessonActionLabel(lesson: Lesson): string {
  if (lesson.status === 'ready') return lesson.reviewed ? COPY.lesson.actionReviewed : COPY.lesson.actionReady;
  if (lesson.status === 'failed') return COPY.lesson.actionFailed;
  if (lesson.status === 'processing') return COPY.lesson.actionProcessing;
  if (lesson.status === 'upcoming') return COPY.lesson.actionUpcoming;
  return '';
}

export function ClassroomLessonCard({ lesson, onClick, featured = false }: ClassroomLessonCardProps) {
  const opacityClass = lesson.status === 'upcoming' ? 'opacity-80' : 'opacity-100';
  const actionLabel = lessonActionLabel(lesson);

  // featured: 更大的垂直内边距 + 更大的标题字号
  const paddingClass = featured ? 'px-6 py-5' : 'px-6 py-4';
  const titleClass = featured
    ? 'text-[18px] font-semibold tracking-[-0.02em] text-ink leading-snug'
    : 'text-[15px] font-medium tracking-[-0.01em] text-ink leading-snug';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-start gap-4 rounded-2xl border border-divider bg-white text-left transition-colors duration-150 hover:border-ink-muted ${paddingClass} ${opacityClass}`}
    >
      <StatusDot lesson={lesson} />

      {/* 中：信息块 */}
      <div className="min-w-0 flex-1">
        <p className={`truncate ${titleClass}`}>
          {lesson.title}
        </p>
        <MetaLine lesson={lesson} featured={featured} />
        <TagLine lesson={lesson} />
      </div>

      <div className="mt-[2px] flex flex-shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-muted transition-colors group-hover:text-ink-secondary">
        <span>{actionLabel}</span>
        {lesson.status === 'ready' || lesson.status === 'failed' ? (
          <ChevronRight
            size={16}
            strokeWidth={1.7}
            className="text-ink-muted transition-colors duration-150 group-hover:text-ink-secondary"
          />
        ) : null}
      </div>
    </button>
  );
}

export default ClassroomLessonCard;
