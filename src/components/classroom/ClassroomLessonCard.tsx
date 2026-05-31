'use client';

/**
 * ClassroomLessonCard — 一张"课"的卡片（v7 · 双签名色 + AI 在场轻信号）
 *
 * 设计宪法（v7）落地：
 *   1. featured（最新一张 ready 卡）= shadow-soft + 极淡 pine ring + ai-breath 微光带
 *      —— 让"刚酿好的那节课"有 AI 在场的轻信号，但不喧闹
 *   2. StatusDot：
 *      - recording → vermilion + rec-pulse-v7（朱批"此刻"）
 *      - processing → pine + 慢呼吸（AI 在酿，墨绿信号）
 *      - ready → pine 实点（已沉淀，主签名色）
 *      - failed → vermilion 实点（朱批提醒，不是灰色）
 *      - upcoming → ink-muted（未到，克制）
 *   3. 数字资产化：keyPoints / 时间 → JetBrains Mono tabular-nums
 *   4. tags 用 pine + vermilion 双签名色家族化（不再 warning-yellow）
 *   5. action label = mono uppercase 0.06em（"已就绪 / 没做好"被资产化为状态标记）
 *   6. hover：edge ring 收紧到 pine（"AI 同学想被翻看"），不是普通灰边变深
 */

import React from 'react';
import { ChevronRight, Sparkles, FileText, Check } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import type { Lesson } from './types';

export interface ClassroomLessonCardProps {
  lesson: Lesson;
  onClick: () => void;
  /** 最新一张 ready 卡：surface-ai 微光带 + 强调标题 */
  featured?: boolean;
}

/** 左侧状态小点（v7：双签名色家族 + 呼吸光环） */
function StatusDot({ lesson }: { lesson: Lesson }) {
  switch (lesson.status) {
    case 'recording':
      // 此刻 = 朱批红 + 录音脉搏
      return (
        <span className="relative mt-[7px] flex h-2.5 w-2.5 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-vermilion opacity-55" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-vermilion" />
        </span>
      );
    case 'processing':
      // AI 在酿 = 墨绿主签名 + 慢呼吸（不是灰色，让"理解中"被看见）
      return (
        <span
          className="relative mt-[7px] flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-pine"
          style={{
            boxShadow: '0 0 0 0 rgba(45,79,62,0.45)',
            animation: 'rec-pulse-v7 2.4s ease-in-out infinite',
          }}
          aria-label="AI 正在理解这节课"
        />
      );
    case 'failed':
      // 没做好 = 朱批提醒（不是灰色，让用户看见需要他注意）
      return (
        <span className="mt-[7px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-vermilion/65" />
      );
    case 'upcoming':
      return (
        <span className="mt-[7px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-ink-muted/40" />
      );
    case 'ready':
    default:
      // 已沉淀 = pine 主签名色（v7：墨松绿 = AI 沉淀的视觉信号）
      return (
        <span className="mt-[7px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-pine/75" />
      );
  }
}

/** 时间 · 时长 · 状态（主副信息行） */
function MetaLine({ lesson, featured }: { lesson: Lesson; featured?: boolean }) {
  const parts: React.ReactNode[] = [];

  // time = mono tabular-nums，作为引用资产
  parts.push(
    <span key="t" className="font-mono tabular-nums text-ink-secondary">
      {lesson.time}
    </span>
  );

  if (lesson.status === 'upcoming') {
    parts.push(<span key="up">即将开始</span>);
  } else if (lesson.status === 'recording') {
    // 朱批红 + serif italic（录音中是"此刻"语义）
    parts.push(
      <span key="r" className="font-serif italic font-medium text-vermilion">
        正在录音
      </span>
    );
  } else if (lesson.status === 'processing') {
    // 墨绿 + serif italic（AI 在酿）
    parts.push(
      <span key="p" className="font-serif italic text-pine">
        正在理解…
      </span>
    );
  } else {
    if (lesson.durationMin) {
      parts.push(<span key="d" className="font-mono tabular-nums">{lesson.durationMin} 分钟</span>);
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

/** 底部徽标：回声 / 已复习 / 关联资料（v7 双签名色家族化） */
function TagLine({ lesson }: { lesson: Lesson }) {
  const tags: React.ReactNode[] = [];

  if (lesson.status === 'ready' && lesson.hasEcho) {
    // Sparkles → pine（v7：AI 已酿好的产物 = 墨绿沉淀信号）
    tags.push(
      <span key="echo" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <Sparkles size={12} strokeWidth={1.8} className="text-pine" />
        {COPY.lesson.summaryReady}
      </span>
    );
  }
  if (lesson.status === 'ready' && lesson.keyPoints && lesson.keyPoints > 0) {
    tags.push(
      <span key="kp" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <span className="font-mono tabular-nums font-medium text-pine">{lesson.keyPoints}</span>
        <span className="text-ink-muted">{COPY.lesson.keyPoints}</span>
      </span>
    );
  }
  if (lesson.reviewed) {
    tags.push(
      <span key="rev" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <Check size={12} strokeWidth={2} className="text-pine" />
        {COPY.lesson.reviewed}
      </span>
    );
  }
  if (lesson.linkedMaterials && lesson.linkedMaterials > 0) {
    tags.push(
      <span key="mat" className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
        <FileText size={12} strokeWidth={1.7} className="text-ink-muted" />
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

  // featured: 更大的垂直内边距 + 更大的标题字号 + shadow-soft + 极淡 pine ring（AI 在场轻信号）
  const paddingClass = featured ? 'px-6 py-5' : 'px-6 py-4';
  const titleClass = featured
    ? 'text-[18px] font-semibold tracking-[-0.02em] text-ink leading-snug'
    : 'text-[15px] font-medium tracking-[-0.012em] text-ink leading-snug';

  // featured 用 surface-ai 灵感的 ring + shadow（不喧闹但能看见）
  const variantClass = featured
    ? 'bg-card shadow-soft ring-1 ring-pine/15 hover:ring-pine/40 hover:shadow-card'
    : 'bg-card border border-divider hover:border-pine/40 hover:shadow-soft';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex w-full items-start gap-4 rounded-2xl text-left transition-all duration-200 active:scale-[0.998] ${variantClass} ${paddingClass} ${opacityClass}`}
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

      {/* action label：mono uppercase 0.06em，被资产化的状态 */}
      <div className="mt-[2px] flex flex-shrink-0 items-center gap-1.5">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted transition-colors group-hover:text-pine">
          {actionLabel}
        </span>
        {lesson.status === 'ready' || lesson.status === 'failed' ? (
          <ChevronRight
            size={15}
            strokeWidth={1.7}
            className="text-ink-muted transition-all duration-150 group-hover:text-pine group-hover:translate-x-0.5"
          />
        ) : null}
      </div>
    </button>
  );
}

export default ClassroomLessonCard;
