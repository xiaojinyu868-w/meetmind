'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, FileText, Globe } from 'lucide-react';
import type { Citation } from '@/types/dify';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const SUPPORT_CITATION_ID_REGEX = /^support-(\d+)$/i;
const SUPPORT_CITATION_TITLE_REGEX = /(?:导入资料|资料)\s*(\d+)/;

export interface ResolvedCitation {
  citation: Citation;
  index: number;
  title: string;
  snippet: string;
  href?: string;
  sourceLabel: string;
}

function normalizeCitationText(value?: string, fallback = ''): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function normalizeCitationHref(value?: string): string | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) return undefined;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return undefined;
}

function getNextAvailableIndex(usedIndexes: Set<number>): number {
  let candidate = 1;
  while (usedIndexes.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export function getCitationSourceLabel(sourceType?: Citation['source_type']): string {
  switch (sourceType) {
    case 'knowledge_base':
      return '增强资料';
    case 'web':
      return '网页参考';
    case 'transcript':
      return '课堂内容';
    default:
      return '资料引用';
  }
}

export function resolveCitations(citations?: Citation[]): ResolvedCitation[] {
  const items = (citations || []).filter(Boolean);
  const usedIndexes = new Set<number>();

  return items.map((citation, listIndex) => {
    const fallbackSnippet = normalizeCitationText(citation.snippet);
    const title = normalizeCitationText(
      citation.title,
      fallbackSnippet || `资料来源 ${listIndex + 1}`
    );

    const preferredIndexes: number[] = [];

    const idMatch = citation.id?.match(SUPPORT_CITATION_ID_REGEX);
    if (idMatch) {
      const parsedIndex = Number.parseInt(idMatch[1], 10);
      if (Number.isFinite(parsedIndex) && parsedIndex > 0) {
        preferredIndexes.push(parsedIndex);
      }
    }

    const titleMatch = citation.title?.match(SUPPORT_CITATION_TITLE_REGEX);
    if (titleMatch) {
      const parsedIndex = Number.parseInt(titleMatch[1], 10);
      if (Number.isFinite(parsedIndex) && parsedIndex > 0) {
        preferredIndexes.push(parsedIndex);
      }
    }

    preferredIndexes.push(listIndex + 1);

    let index = preferredIndexes.find((candidate) => !usedIndexes.has(candidate));
    if (!index) {
      index = getNextAvailableIndex(usedIndexes);
    }

    usedIndexes.add(index);

    return {
      citation,
      index,
      title,
      snippet: fallbackSnippet,
      href: normalizeCitationHref(citation.url),
      sourceLabel: getCitationSourceLabel(citation.source_type),
    };
  });
}

function CitationSourceIcon({ sourceType }: { sourceType?: Citation['source_type'] }) {
  if (sourceType === 'web') {
    return <Globe size={14} strokeWidth={1.8} />;
  }

  if (sourceType === 'knowledge_base') {
    return <BookOpen size={14} strokeWidth={1.8} />;
  }

  return <FileText size={14} strokeWidth={1.8} />;
}

interface CitationDetailSheetProps {
  citations?: Citation[];
  activeIndex: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectIndex: (index: number) => void;
}

export function CitationDetailSheet({
  citations,
  activeIndex,
  open,
  onOpenChange,
  onSelectIndex,
}: CitationDetailSheetProps) {
  const resolvedCitations = useMemo(() => resolveCitations(citations), [citations]);
  const activeCitation = resolvedCitations.find((item) => item.index === activeIndex) || resolvedCitations[0] || null;

  useEffect(() => {
    if (!resolvedCitations.length) {
      if (open) onOpenChange(false);
      return;
    }

    if (activeIndex === null || !resolvedCitations.some((item) => item.index === activeIndex)) {
      onSelectIndex(resolvedCitations[0].index);
    }
  }, [activeIndex, onOpenChange, onSelectIndex, open, resolvedCitations]);

  if (!resolvedCitations.length || !activeCitation) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-none border-l-0 bg-white p-0 sm:max-w-[420px] sm:border-l sm:rounded-l-[28px]"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-divider px-5 pb-4 pt-5 text-left">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-ink-muted">
              <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-full border border-divider bg-paper-warm px-2 font-semibold text-ink-secondary">
                {activeCitation.index}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-vermilion-fog px-2.5 py-1 font-medium text-vermilion-deep">
                <CitationSourceIcon sourceType={activeCitation.citation.source_type} />
                {activeCitation.sourceLabel}
              </span>
            </div>
            <SheetTitle className="pr-8 text-[17px] leading-6 text-ink">
              {activeCitation.title}
            </SheetTitle>
          </SheetHeader>

          {resolvedCitations.length > 1 ? (
            <div className="border-b border-divider px-5 py-3">
              <div className="flex flex-wrap gap-2">
                {resolvedCitations.map((item) => {
                  const isActive = item.index === activeCitation.index;
                  return (
                    <button
                      key={`${item.index}-${item.title}`}
                      type="button"
                      onClick={() => onSelectIndex(item.index)}
                      className={[
                        'inline-flex h-8 min-w-[32px] items-center justify-center rounded-full border px-3 text-xs font-semibold transition-all',
                        isActive
                          ? 'border-ink bg-ink text-white shadow-sm'
                          : 'border-divider bg-white text-ink-secondary hover:border-divider hover:text-ink',
                      ].join(' ')}
                      aria-pressed={isActive}
                      title={item.title}
                    >
                      {item.index}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="rounded-[22px] border border-divider bg-paper-warm/80 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                摘要片段
              </div>
              {activeCitation.snippet ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-ink-secondary">
                  {activeCitation.snippet}
                </p>
              ) : (
                <p className="text-sm leading-6 text-ink-muted">
                  这条引用没有返回摘要片段，但你仍然可以根据标题和来源类型继续定位原文。
                </p>
              )}
            </div>

            {activeCitation.href ? (
              <a
                href={activeCitation.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-divider bg-white px-3.5 py-2 text-sm font-medium text-ink-secondary transition-colors hover:border-divider hover:text-ink"
              >
                <ExternalLink size={14} strokeWidth={1.8} />
                打开原文
              </a>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function CitationQuickAccess({
  citations,
  label = '引用资料',
  hint = '点数字查看详情',
  className = '',
}: {
  citations?: Citation[];
  label?: string;
  hint?: string;
  className?: string;
}) {
  const resolvedCitations = useMemo(() => resolveCitations(citations), [citations]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(resolvedCitations[0]?.index ?? null);

  useEffect(() => {
    if (!resolvedCitations.length) {
      setActiveIndex(null);
      setOpen(false);
      return;
    }

    if (activeIndex === null || !resolvedCitations.some((item) => item.index === activeIndex)) {
      setActiveIndex(resolvedCitations[0].index);
    }
  }, [activeIndex, resolvedCitations]);

  if (!resolvedCitations.length) return null;

  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <span className="text-[11px] font-medium text-ink-muted">{label}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {resolvedCitations.map((item) => (
            <button
              key={`${item.index}-${item.title}`}
              type="button"
              onClick={() => {
                setActiveIndex(item.index);
                setOpen(true);
              }}
              className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full border border-divider bg-white px-2 text-[11px] font-semibold text-ink-secondary transition-all hover:border-divider hover:text-ink"
              title={item.title}
              aria-label={`资料${item.index}：${item.title}`}
            >
              {item.index}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-muted">{hint}</span>
      </div>

      <CitationDetailSheet
        citations={citations}
        activeIndex={activeIndex}
        open={open}
        onOpenChange={setOpen}
        onSelectIndex={setActiveIndex}
      />
    </>
  );
}
