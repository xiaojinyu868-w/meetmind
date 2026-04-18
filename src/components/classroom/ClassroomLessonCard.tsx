'use client';

/**
 * ClassroomLessonCard — 一张"课"的卡片
 *
 * 根据课的四种时态呈现不同的视觉重量：
 *   upcoming（课前）：轻、左侧小竖线暖黄提示"即将开始"
 *   recording（课中）：红点脉动、边缘微微染一点暖黄
 *   processing（酿造中）：克制、ink-muted 全色，"正在理解…"
 *   ready（已理解）：最实、有重点数 + 回声徽标
 *
 * 不同时态的卡片组合在一起，构成"今天的学习"的真实快照。
 *
 * 设计系统：零渐变、零阴影、纯平涂；ring-[0.5px] 代替边框避免厚重感。
 */

import React from 'react';
import {
  Mic, ChevronRight, BookOpen, Sparkles, CircleDot, FileText, Check,
} from 'lucide-react';
import type { Lesson } from './types';

export interface ClassroomLessonCardProps {
  lesson: Lesson;
  onClick: () => void;
}

/** 根据状态选的左侧图标容器 */
function StatusBadge({ lesson }: { lesson: Lesson }) {
  switch (lesson.status) {
    case 'recording':
      return (
        <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#FDF3C0] text-[#8B6914]">
          <Mic size={18} strokeWidth={1.6} />
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#D96B6B] animate-pulse" />
        </div>
      );
    case 'processing':
      return (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#F0F0EE] text-[#A3A39E]">
          <CircleDot size={18} strokeWidth={1.6} className="animate-pulse-slow" />
        </div>
      );
    case 'upcoming':
      return (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#FDF3C0]/50 text-[#8B6914]">
          <BookOpen size={18} strokeWidth={1.6} />
        </div>
      );
    case 'ready':
    default:
      return (
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#F7F7F5] text-[#787774]">
          <BookOpen size={18} strokeWidth={1.6} />
        </div>
      );
  }
}

/** 副信息行：时间、时长、重点数 */
function MetaLine({ lesson }: { lesson: Lesson }) {
  const parts: React.ReactNode[] = [<span key="time">{lesson.time}</span>];

  if (lesson.status === 'upcoming') {
    parts.push(<span key="up" className="text-[#8B6914]">即将开始</span>);
  } else if (lesson.status === 'recording') {
    parts.push(<span key="r" className="font-medium text-[#8B6914]">正在录音</span>);
  } else if (lesson.status === 'processing') {
    parts.push(<span key="p">正在理解…</span>);
  } else {
    if (lesson.durationMin) {
      parts.push(<span key="d">{lesson.durationMin} 分钟</span>);
    }
    if (lesson.keyPoints && lesson.keyPoints > 0) {
      parts.push(<span key="kp">{lesson.keyPoints} 个重点</span>);
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ink-muted">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-ink-muted/50">·</span>}
          {p}
        </React.Fragment>
      ))}
    </div>
  );
}

/** 底部徽标行：回声/已复习/关联资料 */
function TagLine({ lesson }: { lesson: Lesson }) {
  const tags: React.ReactNode[] = [];

  if (lesson.status === 'ready' && lesson.hasEcho) {
    tags.push(
      <span key="echo" className="inline-flex items-center gap-1 text-[11px] text-[#787774]">
        <Sparkles size={11} strokeWidth={1.6} className="text-[#8B6914]" />
        回声已生成
      </span>
    );
  }
  if (lesson.reviewed) {
    tags.push(
      <span key="rev" className="inline-flex items-center gap-1 text-[11px] text-[#787774]">
        <Check size={11} strokeWidth={2} />
        已复习
      </span>
    );
  }
  if (lesson.linkedMaterials && lesson.linkedMaterials > 0) {
    tags.push(
      <span key="mat" className="inline-flex items-center gap-1 text-[11px] text-[#787774]">
        <FileText size={11} strokeWidth={1.6} />
        {lesson.linkedMaterials} 份资料
      </span>
    );
  }

  if (tags.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {tags}
    </div>
  );
}

export function ClassroomLessonCard({ lesson, onClick }: ClassroomLessonCardProps) {
  // 已理解的课最"实"；课前态最"虚"
  const opacityClass =
    lesson.status === 'upcoming' ? 'opacity-85' : 'opacity-100';
  // 录音中态卡片左侧多一条暖黄条，强调"此刻正在发生"
  const accent = lesson.status === 'recording'
    ? 'before:absolute before:left-0 before:top-3 before:bottom-3 before:w-0.5 before:rounded-full before:bg-[#FDF3C0] before:content-[""]'
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-start gap-4 rounded-2xl bg-white px-5 py-4 text-left ring-[0.5px] ring-[#232322]/[0.06] transition-colors hover:ring-[#232322]/[0.14] ${opacityClass} ${accent}`}
    >
      <StatusBadge lesson={lesson} />

      {/* 中：信息 */}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink leading-snug truncate">
          {lesson.title}
        </p>
        <MetaLine lesson={lesson} />
        <TagLine lesson={lesson} />
      </div>

      {/* 右：箭头（未理解的课不显示，避免"勾引你点进去什么都没有"） */}
      {lesson.status === 'ready' ? (
        <ChevronRight
          size={16}
          className="mt-1 flex-shrink-0 text-[#D0D0CC] transition-colors group-hover:text-[#787774]"
        />
      ) : null}
    </button>
  );
}

export default ClassroomLessonCard;
