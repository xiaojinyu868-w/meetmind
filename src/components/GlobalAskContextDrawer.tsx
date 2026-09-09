'use client';

import type { ReactNode } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { LearningActivityEntry, LearningMemoryEntry, LearningThreadEntry } from '@/types/user';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import { resolveRecentLessons, topicLabel } from '@/components/global-ask-desk';

/**
 * GlobalAskContextDrawer — 「参考范围」：同学此刻手里有什么
 *
 * 之前是眉题 + 标题 + 系统口吻说明 + 三行计数（"1 份当前材料 / 24 条最近学习 / 1 条长期记忆"）+ 一块黑色大按钮。
 * 计数说明不了任何事——学生想知道的是"你到底看过我哪些东西"。现在每一行都是一件真实的东西：
 * 这节课的名字、收下的材料、最近上过的课、记住的理解、正在继续的目标。能点的就能点过去。
 * 全空时一句话说清楚。
 */

interface ContextSource {
  id: string;
  title: string;
}

interface GlobalAskContextDrawerProps {
  /** 当前打开的课堂（有转录时）；占位名也照实显示 */
  currentLessonTitle?: string;
  /** 会带进对话的材料（可点回原处） */
  sources: ContextSource[];
  /** 本次对话附上的文件 */
  attachedTitles: readonly string[];
  recentActivities: readonly LearningActivityEntry[];
  memories: readonly LearningMemoryEntry[];
  activeThread?: LearningThreadEntry;
  onClose: () => void;
  onOpenMemory: () => void;
  onOpenSource?: (sourceId: string) => void;
}

const RECENT_MAX = 4;
const MEMORY_MAX = 4;

function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const className = 'flex w-full items-center gap-2 py-1.5 text-left text-[13.5px] leading-6 text-ink';
  if (!onClick) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={onClick} className={`${className} group`}>
      <span className="min-w-0 flex-1 truncate transition group-hover:text-pine">{children}</span>
      <ChevronRight size={13} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="py-4">
      <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{title}</p>
      {children}
    </section>
  );
}

function More({ count }: { count: number }) {
  if (count <= 0) return null;
  return <p className="py-1 text-[12px] text-ink-muted">{GLOBAL_ASK_COPY.contextDrawerMore(count)}</p>;
}

export function GlobalAskContextDrawer({
  currentLessonTitle,
  sources,
  attachedTitles,
  recentActivities,
  memories,
  activeThread,
  onClose,
  onOpenMemory,
  onOpenSource,
}: GlobalAskContextDrawerProps) {
  const copy = GLOBAL_ASK_COPY;

  // 最近上过的课（应用活动归到它所属的课；与第一屏同一套解析）
  const recentTitles = resolveRecentLessons(recentActivities).map((lesson) => lesson.title);
  const activeMemories = memories.filter((memory) => memory.status === 'active' && memory.title.trim());
  const hasCurrent = Boolean(currentLessonTitle) || sources.length > 0 || attachedTitles.length > 0;
  const hasContext = hasCurrent || recentTitles.length > 0 || activeMemories.length > 0 || activeThread?.status === 'active';

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-ink/10" role="presentation" onMouseDown={onClose}>
      <aside
        className="flex h-full w-full max-w-[400px] flex-col border-l border-divider bg-paper"
        aria-label={copy.contextRailTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 px-6 pb-2 pt-5">
          <h2 className="text-[16px] font-semibold text-ink">{copy.contextRailTitle}</h2>
          <button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={copy.close}>
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 divide-y divide-divider overflow-y-auto px-6">
          {!hasContext ? <p className="py-6 text-[13.5px] leading-6 text-ink-secondary">{copy.contextEmpty}</p> : null}

          {hasCurrent ? (
            <Section title={copy.contextDrawerCurrent}>
              {currentLessonTitle ? <Row>{copy.contextDrawerLessonTranscript(currentLessonTitle)}</Row> : null}
              {sources.map((source) => (
                <Row key={source.id} onClick={onOpenSource ? () => onOpenSource(source.id) : undefined}>{source.title}</Row>
              ))}
              {attachedTitles.map((title) => (
                <Row key={`attached:${title}`}>{copy.contextDrawerAttached(title)}</Row>
              ))}
            </Section>
          ) : null}

          {recentTitles.length > 0 ? (
            <Section title={copy.contextDrawerRecent}>
              {recentTitles.slice(0, RECENT_MAX).map((title) => <Row key={title}>{title}</Row>)}
              <More count={recentTitles.length - RECENT_MAX} />
            </Section>
          ) : null}

          {activeMemories.length > 0 ? (
            <Section title={copy.contextDrawerMemory}>
              {activeMemories.slice(0, MEMORY_MAX).map((memory) => (
                <Row key={memory.id} onClick={onOpenMemory}>{topicLabel(memory.title)}</Row>
              ))}
              <More count={activeMemories.length - MEMORY_MAX} />
            </Section>
          ) : null}

          {activeThread?.status === 'active' ? (
            <Section title={copy.contextActiveThread}>
              <Row>{activeThread.title}</Row>
              {activeThread.lastSummary ? <p className="line-clamp-3 pb-1 text-[12px] leading-5 text-ink-muted">{activeThread.lastSummary}</p> : null}
            </Section>
          ) : null}
        </div>

        <div className="border-t border-divider px-6 py-4">
          <button type="button" onClick={onOpenMemory} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-pine underline-offset-4 hover:underline">
            {copy.memoryAction}
            <ChevronRight size={13} />
          </button>
          <p className="mt-1 text-[11.5px] leading-5 text-ink-muted">{copy.contextDrawerFoot}</p>
        </div>
      </aside>
    </div>
  );
}
