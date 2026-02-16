'use client';

import { useMemo, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';

interface MindmapWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
}

interface BranchNode {
  id: string;
  title: string;
  points: string[];
  startMs?: number;
}

interface MindmapPayload {
  root?: string;
  branches?: Array<{ title?: string; points?: string[]; startMs?: number }>;
}

function normalizeBranches(result: AppExecutionResult | null): { root: string; branches: BranchNode[] } {
  if (!result) return { root: '课堂知识结构', branches: [] };
  const payload = (result.render?.payload || {}) as MindmapPayload;
  const payloadBranches = Array.isArray(payload.branches)
    ? payload.branches
        .map((branch, index) => ({
          id: `payload-branch-${index + 1}`,
          title: typeof branch.title === 'string' ? branch.title.trim() : `分支 ${index + 1}`,
          points: Array.isArray(branch.points)
            ? branch.points.map((point) => (typeof point === 'string' ? point.trim() : '')).filter(Boolean)
            : [],
          startMs: typeof branch.startMs === 'number' ? branch.startMs : undefined,
        }))
        .filter((branch) => branch.title)
    : [];

  if (payloadBranches.length > 0) {
    return {
      root: typeof payload.root === 'string' && payload.root.trim() ? payload.root.trim() : result.render?.title || '课堂知识结构',
      branches: payloadBranches,
    };
  }

  const cards = result.cards.filter((card) => card.meta?.cardKind === 'mindmap');
  return {
    root: result.render?.title || '课堂知识结构',
    branches: cards.map((card, index) => ({
      id: card.id,
      title: card.title || `分支 ${index + 1}`,
      points: Array.isArray(card.meta?.points)
        ? card.meta.points.map((point) => (typeof point === 'string' ? point : '')).filter(Boolean)
        : [],
      startMs: card.citations?.[0]?.startMs,
    })),
  };
}

function splitColumns(branches: BranchNode[]): { left: BranchNode[]; right: BranchNode[] } {
  const left: BranchNode[] = [];
  const right: BranchNode[] = [];
  branches.forEach((branch, index) => {
    if (index % 2 === 0) left.push(branch);
    else right.push(branch);
  });
  return { left, right };
}

export function MindmapWindow({ result, transcript, onSeek }: MindmapWindowProps) {
  const mapData = useMemo(() => normalizeBranches(result), [result]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!result) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">正在生成思维导图...</div>;
  }

  if (mapData.branches.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">未获得可展示导图，请重新生成。</div>;
  }

  const visibleBranches = focusedId ? mapData.branches.filter((branch) => branch.id === focusedId) : mapData.branches;
  const { left, right } = splitColumns(visibleBranches);

  return (
    <section className="space-y-4" data-testid="mindmap-window">
      <header className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Mindmap</p>
        <h2 className="mt-1 text-2xl font-semibold text-slate-900">{mapData.root}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => setFocusedId(null)}
          >
            查看全图
          </button>
          {focusedId ? (
            <button
              type="button"
              className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100"
              onClick={() => setFocusedId(null)}
            >
              取消聚焦
            </button>
          ) : null}
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 md:p-6">
        <div className="mb-5 flex justify-center">
          <div className="max-w-xl rounded-2xl border border-blue-200 bg-blue-50 px-6 py-4 text-center shadow-sm">
            <p className="text-xs uppercase tracking-wide text-blue-600">核心主题</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{mapData.root}</p>
          </div>
        </div>

        <div className="hidden gap-6 md:grid md:grid-cols-[1fr_auto_1fr]">
          <div className="space-y-4">
            {left.map((branch, index) => {
              const sourceCard = result.cards.find((card) => card.id === branch.id) || result.cards[index];
              const citation = sourceCard?.citations?.[0];
              const isExpanded = expanded[branch.id] ?? true;

              return (
                <article key={branch.id} className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="absolute -right-5 top-1/2 h-px w-5 -translate-y-1/2 bg-blue-200" />
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{branch.title}</h3>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={() => setExpanded((prev) => ({ ...prev, [branch.id]: !isExpanded }))}
                      >
                        {isExpanded ? '收起' : '展开'}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={() => setFocusedId(branch.id)}
                      >
                        聚焦
                      </button>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                      {branch.points.map((point) => (
                        <li key={`${branch.id}-${point}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 leading-6">
                          {point}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {citation ? <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} /> : null}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="flex items-stretch justify-center">
            <div className="w-px bg-blue-100" />
          </div>

          <div className="space-y-4">
            {right.map((branch, index) => {
              const sourceCard = result.cards.find((card) => card.id === branch.id) || result.cards[index];
              const citation = sourceCard?.citations?.[0];
              const isExpanded = expanded[branch.id] ?? true;

              return (
                <article key={branch.id} className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <span className="absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2 bg-blue-200" />
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">{branch.title}</h3>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={() => setExpanded((prev) => ({ ...prev, [branch.id]: !isExpanded }))}
                      >
                        {isExpanded ? '收起' : '展开'}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={() => setFocusedId(branch.id)}
                      >
                        聚焦
                      </button>
                    </div>
                  </div>
                  {isExpanded ? (
                    <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                      {branch.points.map((point) => (
                        <li key={`${branch.id}-${point}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 leading-6">
                          {point}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {citation ? <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} /> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 md:hidden">
          {visibleBranches.map((branch, index) => {
            const sourceCard = result.cards.find((card) => card.id === branch.id) || result.cards[index];
            const citation = sourceCard?.citations?.[0];
            const isExpanded = expanded[branch.id] ?? true;

            return (
              <article key={branch.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{branch.title}</h3>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                      onClick={() => setExpanded((prev) => ({ ...prev, [branch.id]: !isExpanded }))}
                    >
                      {isExpanded ? '收起' : '展开'}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                      onClick={() => setFocusedId(branch.id)}
                    >
                      聚焦
                    </button>
                  </div>
                </div>
                {isExpanded ? (
                  <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
                    {branch.points.map((point) => (
                      <li key={`${branch.id}-${point}`} className="rounded-lg bg-slate-50 px-2.5 py-1.5 leading-6">
                        {point}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {citation ? <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} /> : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
