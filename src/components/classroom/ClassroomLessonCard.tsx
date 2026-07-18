'use client';

/**
 * ClassroomLessonCard — 一张"课"的卡片（v7 R9-2 大改版）
 *
 * 用户反馈整改（按 8 条意见）：
 *   #4 之前标题被截断，没法"扫一眼知道价值" → 加摘要行（用 keyPoints/材料/echo 组合）
 *      + line-clamp-2 让长标题至少能展示两行
 *   #5 状态（"整理中"）和操作（"继续复习"/"再看一遍"）混在同一位置 → 拆开：
 *      左边显示内容、右边专门做"状态徽章 OR 操作按钮"
 *   #6 "正在理解..." 太抽象 → 状态文案优先用 lesson.statusText（数据层可塞精确态：
 *      正在转写 / 正在生成总结 / 正在整理重点）
 *
 * 视觉规则（v7 双签名色 + 信息层级清晰）：
 *   - StatusDot 双签名色家族：recording=vermilion ping / processing=pine 慢呼吸 /
 *     ready=pine 实点 / failed=vermilion / upcoming=ink-muted
 *   - 状态徽章（小标签 pill 风格）：text-[11px] mono 中性色
 *   - 操作按钮（pine ring + chevron）：让"继续复习"看起来像可点的真按钮
 *
 * 标题编辑：双击标题或点铅笔图标 → inline input → Enter/blur 保存，Escape 取消
 */

import React, { useState, useRef, useEffect } from 'react';
import { ChevronRight, Sparkles, Check, Pencil } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import type { Lesson } from './types';

export interface ClassroomLessonCardProps {
  lesson: Lesson;
  onClick: () => void;
  /** 最新一张 ready 卡：surface-ai 微光带 + 强调标题 */
  featured?: boolean;
  /** 重命名回调（双击标题或点铅笔图标触发） */
  onRename?: (id: string, title: string) => void;
}

/** 左侧状态小点（v7：双签名色家族 + 呼吸光环） */
function StatusDot({ lesson }: { lesson: Lesson }) {
  switch (lesson.status) {
    case 'recording':
      return (
        <span className="relative mt-[7px] flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-55" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-vermilion" />
        </span>
      );
    case 'processing':
      return (
        <span
          className="relative mt-[7px] flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-pine"
          style={{
            boxShadow: '0 0 0 0 rgba(45,79,62,0.45)',
            animation: 'rec-pulse-v7 1.6s ease-in-out infinite',
          }}
          aria-label="AI 正在理解这节课"
        />
      );
    case 'ready':
      return <span className="mt-[7px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-pine" aria-hidden />;
    case 'failed':
      return <span className="mt-[7px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-vermilion" aria-hidden />;
    default:
      return <span className="mt-[7px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-ink-muted/35" aria-hidden />;
  }
}

/** 时间 · 时长 · 已复习（基础 meta） */
function MetaLine({ lesson }: { lesson: Lesson }) {
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-muted">
      <span className="font-mono tabular-nums">{lesson.time}</span>
      {lesson.durationMin ? (
        <>
          <span className="text-ink-muted/40">·</span>
          <span className="font-mono tabular-nums">{lesson.durationMin} 分钟</span>
        </>
      ) : null}
      {lesson.reviewed ? (
        <>
          <span className="text-ink-muted/40">·</span>
          <span className="inline-flex items-center gap-1 text-pine">
            <Check size={11} strokeWidth={2.2} />
            {COPY.lesson.reviewed}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * SummaryLine — "扫一眼知道价值"的预览行
 *
 * 用 lesson 现有元数据组合（未来 lesson.summary 字段是真 AI 摘要时直接用它）
 */
function SummaryLine({ lesson }: { lesson: Lesson }) {
  const fragments: string[] = [];
  if (lesson.keyPoints && lesson.keyPoints > 0) {
    fragments.push(`${lesson.keyPoints} 个${COPY.lesson.keyPoints}`);
  }
  if (lesson.linkedMaterials && lesson.linkedMaterials > 0) {
    fragments.push(COPY.lesson.materials(lesson.linkedMaterials));
  }
  if (lesson.status === 'ready' && lesson.hasEcho && fragments.length === 0) {
    fragments.push(COPY.lesson.summaryReady);
  }
  if (fragments.length === 0) return null;

  return (
    <p className="mt-1 truncate text-[12.5px] text-ink-secondary leading-relaxed">
      {lesson.hasEcho ? (
        <Sparkles size={11} strokeWidth={1.8} className="inline-block mr-1 align-[-1px] text-pine" />
      ) : null}
      {fragments.map((f, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="text-ink-muted/45 mx-1.5">·</span> : null}
          <span>{f}</span>
        </React.Fragment>
      ))}
    </p>
  );
}

/** 状态徽章（小标签 pill）— 仅 non-ready 态显示，让位给 ActionButton */
function StatusBadge({ lesson }: { lesson: Lesson }) {
  if (lesson.status === 'recording') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-vermilion/10 px-2.5 py-1 text-[11px] font-medium text-vermilion whitespace-nowrap">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-55" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-vermilion" />
        </span>
        正在录
      </span>
    );
  }
  if (lesson.status === 'processing') {
    // 优先用 lesson.statusText 显示精确态（"正在转写" / "正在生成总结" / "正在整理重点"）
    const label = lesson.statusText?.trim() || '正在整理';
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-pine/10 px-2.5 py-1 text-[11px] font-medium text-pine whitespace-nowrap">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-pine"
          style={{
            boxShadow: '0 0 0 0 rgba(45,79,62,0.45)',
            animation: 'rec-pulse-v7 1.6s ease-in-out infinite',
          }}
          aria-hidden
        />
        {label}
      </span>
    );
  }
  if (lesson.status === 'failed') {
    return (
      <span className="inline-flex items-center rounded-full bg-paper-warm px-2.5 py-1 text-[11px] font-medium text-ink-muted whitespace-nowrap">
        {lesson.statusText?.trim() || '原声已保留'}
      </span>
    );
  }
  if (lesson.status === 'upcoming') {
    return (
      <span className="inline-flex items-center rounded-full bg-paper-warm px-2.5 py-1 text-[11px] font-medium text-ink-muted whitespace-nowrap">
        即将开始
      </span>
    );
  }
  return null;
}

/** 操作按钮（pine ring + chevron）— 仅 ready 态显示 */
function ActionButton({ lesson }: { lesson: Lesson }) {
  if (lesson.status !== 'ready') return null;
  const label = lesson.reviewed ? COPY.lesson.actionReviewed : COPY.lesson.actionReady;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-divider bg-card px-3 py-1.5 text-[12px] font-medium text-ink-secondary transition-all whitespace-nowrap group-hover:border-pine group-hover:text-pine group-hover:bg-pine/5">
      {label}
      <ChevronRight size={13} strokeWidth={1.8} className="transition-transform group-hover:translate-x-0.5" />
    </span>
  );
}

export function ClassroomLessonCard({ lesson, onClick, featured = false, onRename }: ClassroomLessonCardProps) {
  const opacityClass = lesson.status === 'upcoming' ? 'opacity-80' : 'opacity-100';
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // 时间只属于元信息，不冒充课程名称；未命名时 adapter 会用课堂证据或来源类型兜底。
  const displayTitle = lesson.title;

  const paddingClass = featured ? 'px-5 py-4' : 'px-5 py-3.5';
  const titleClass = featured
    ? 'text-[16px] font-semibold tracking-[-0.015em] text-ink leading-snug'
    : 'text-[14.5px] font-medium tracking-[-0.01em] text-ink leading-snug';

  const variantClass = featured
    ? 'bg-card shadow-soft ring-1 ring-pine/15 hover:ring-pine/40 hover:shadow-card'
    : 'bg-card border border-divider hover:border-pine/40 hover:shadow-soft';

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditValue(lesson.title);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== lesson.title && onRename) {
      onRename(lesson.id, trimmed);
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  if (editing) {
    return (
      <div className={`group relative flex w-full items-start gap-3 rounded-xl ${variantClass} ${paddingClass} ${opacityClass}`}>
        <StatusDot lesson={lesson} />
        <div className="min-w-0 flex-1">
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleEditKeyDown}
            className={`${titleClass} w-full rounded-md border border-pine/40 bg-white px-2 py-0.5 outline-none ring-2 ring-pine/10 focus:border-pine`}
            placeholder="给这节课起个名字"
          />
          <SummaryLine lesson={lesson} />
          <MetaLine lesson={lesson} />
        </div>
        <div className="flex flex-shrink-0 items-center self-center">
          <button
            type="button"
            onClick={commitEdit}
            className="inline-flex items-center gap-1 rounded-full border border-pine/30 bg-pine/5 px-3 py-1.5 text-[12px] font-medium text-pine transition hover:bg-pine/10"
          >
            <Check size={13} strokeWidth={2} />
            保存
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative flex w-full cursor-pointer items-start gap-3 rounded-xl text-left transition-all duration-200 active:scale-[0.998] ${variantClass} ${paddingClass} ${opacityClass}`}
    >
      <StatusDot lesson={lesson} />

      {/* 中：信息块（标题 line-clamp-2 + 摘要 + meta） */}
      <div className="min-w-0 flex-1">
        <div
          className={`${titleClass} line-clamp-2`}
          title={displayTitle}
          onDoubleClick={onRename ? startEditing : undefined}
        >
          {displayTitle}
          {onRename ? (
            <button
              type="button"
              onClick={startEditing}
              className="ml-1.5 inline-flex items-center align-[-1px] text-ink-muted/0 transition group-hover:text-ink-muted hover:text-pine"
              aria-label="重命名"
            >
              <Pencil size={11} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <SummaryLine lesson={lesson} />
        <MetaLine lesson={lesson} />
      </div>

      {/* 右：状态徽章 OR 操作按钮（拆开，类型一致） */}
      <div className="flex flex-shrink-0 items-center self-center">
        <StatusBadge lesson={lesson} />
        <ActionButton lesson={lesson} />
      </div>
    </div>
  );
}

export default ClassroomLessonCard;
