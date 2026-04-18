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
        <span className="relative mt-[7px] flex h-2 w-2 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D96B6B] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D96B6B]" />
        </span>
      );
    case 'processing':
      return (
        <span className="mt-[7px] flex h-2 w-2 flex-shrink-0 animate-pulse-slow rounded-full bg-[#A3A39E]" />
      );
    case 'upcoming':
      return (
        <span className="mt-[7px] flex h-2 w-2 flex-shrink-0 rounded-full bg-[#E8C547]" />
      );
    case 'ready':
    default:
      return (
        <span className="mt-[7px] flex h-2 w-2 flex-shrink-0 rounded-full bg-[#D0D0CC]" />
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
    parts.push(<span key="r" className="text-[#B78900]">正在录音</span>);
  } else if (lesson.status === 'processing') {
    parts.push(<span key="p">正在理解…</span>);
  } else {
    if (lesson.durationMin) {
      parts.push(<span key="d">{lesson.durationMin} 分钟</span>);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-muted ${featured ? 'text-[12.5px] mt-1.5' : 'text-[12px] mt-0.5'}`}>
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
      <span key="echo" className="inline-flex items-center gap-1 text-[11px] text-ink-secondary">
        <Sparkles size={10.5} strokeWidth={1.8} className="text-[#B78900]" />
        回声
      </span>
    );
  }
  if (lesson.status === 'ready' && lesson.keyPoints && lesson.keyPoints > 0) {
    tags.push(
      <span key="kp" className="inline-flex items-center gap-1 text-[11px] text-ink-secondary">
        <span className="tabular-nums font-medium">{lesson.keyPoints}</span>
        <span className="text-ink-muted">重点</span>
      </span>
    );
  }
  if (lesson.reviewed) {
    tags.push(
      <span key="rev" className="inline-flex items-center gap-1 text-[11px] text-ink-secondary">
        <Check size={11} strokeWidth={2} />
        已复习
      </span>
    );
  }
  if (lesson.linkedMaterials && lesson.linkedMaterials > 0) {
    tags.push(
      <span key="mat" className="inline-flex items-center gap-1 text-[11px] text-ink-secondary">
        <FileText size={10.5} strokeWidth={1.7} />
        {lesson.linkedMaterials}
      </span>
    );
  }

  if (tags.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
      {tags}
    </div>
  );
}

export function ClassroomLessonCard({ lesson, onClick, featured = false }: ClassroomLessonCardProps) {
  const opacityClass = lesson.status === 'upcoming' ? 'opacity-80' : 'opacity-100';

  // featured: 更大的垂直内边距 + 更大的标题字号
  const paddingClass = featured ? 'px-6 py-5' : 'px-6 py-3.5';
  const titleClass = featured
    ? 'text-[17px] font-semibold tracking-[-0.015em] text-ink leading-snug'
    : 'text-[14.5px] font-medium tracking-[-0.005em] text-ink leading-snug';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-start gap-3.5 rounded-xl bg-white text-left ring-[0.5px] ring-[#232322]/[0.06] transition-all duration-150 hover:ring-[#232322]/[0.16] hover:-translate-y-[0.5px] ${paddingClass} ${opacityClass}`}
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

      {/* 右：箭头（ready 态才显示） */}
      {lesson.status === 'ready' ? (
        <ChevronRight
          size={15}
          strokeWidth={1.7}
          className="mt-[3px] flex-shrink-0 text-[#D0D0CC] transition-all duration-150 group-hover:text-[#787774] group-hover:translate-x-[1px]"
        />
      ) : null}
    </button>
  );
}

export default ClassroomLessonCard;
