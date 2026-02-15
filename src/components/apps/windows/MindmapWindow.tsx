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
          title: typeof branch.title === 'string' ? branch.title : `分支 ${index + 1}`,
          points: Array.isArray(branch.points)
            ? branch.points.map((point) => (typeof point === 'string' ? point : '')).filter(Boolean)
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

  return (
    <section className="space-y-4" data-testid="mindmap-window">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Root</p>
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
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {visibleBranches.map((branch, index) => {
          const sourceCard = result.cards.find((card) => card.id === branch.id) || result.cards[index];
          const citation = sourceCard?.citations?.[0];
          const isExpanded = expanded[branch.id] ?? true;
          return (
            <article key={branch.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">{branch.title}</h3>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={() => setExpanded((prev) => ({ ...prev, [branch.id]: !isExpanded }))}
                  >
                    {isExpanded ? '收起' : '展开'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={() => setFocusedId(branch.id)}
                  >
                    聚焦
                  </button>
                </div>
              </div>

              {isExpanded ? (
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  {branch.points.map((point) => (
                    <li key={`${branch.id}-${point}`} className="rounded-lg bg-slate-50 px-3 py-2">
                      {point}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {citation ? <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} /> : null}
                {typeof branch.startMs === 'number' ? (
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => onSeek?.(branch.startMs as number)}
                  >
                    回放分支来源
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
