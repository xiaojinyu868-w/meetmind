'use client';

/**
 * MindMap — 录课中「生长中的思维导图」主画布
 *
 * 设计意图：
 *   把之前一排排并列的"理解卡片"换成一棵纵向展开的小树。
 *   - 顶部：中心节点（课程/本段主题）
 *   - 中层：2-5 个一级分支，横向排布（右边最新）
 *   - 底层：每个分支下方垂直挂叶子
 *   - 连线：SVG path 从中心节点流向分支，再从分支流向叶子
 *
 * 生长动画：
 *   新进来的节点会被标记在 newNodeIds 里，节点自身做 fade + scale(0.88→1)
 *   进入；对应的连线 stroke-dashoffset 随动。2 秒后回归常态。
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）。
 */

import React, { useMemo } from 'react';
import type { MindMapNode, MindMapTree } from '@/hooks/useClassroomMindMap';

export interface MindMapProps {
  tree: MindMapTree;
  /** 最近一次 diff 中新增的节点 id（用于进入动画） */
  newNodeIds: Set<string>;
  /** 录音已进行的毫秒数（预热态文案使用） */
  elapsedMs: number;
  /** 点击某节点上的时间戳 → 回跳录音位置（可选） */
  onAnchorClick?: (anchorMs: number) => void;
}

// ── 时间工具 ─────────────────────────────────────────────────────────

function formatAt(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ── 单节点 ──────────────────────────────────────────────────────────
//
// 视觉层级的原则：
//   center  = 根（安静，不是最醒目的色块）。纯文字，双行：上方小标、下方主标。
//   branch  = 枝（白底 + 极细边）。唯一承载"卡片感"的一层，用来组织叶子。
//   leaf    = 叶（纯文字 + 前导 tick 点）。叶是枝头的字，不是小卡片。

type NodeTier = 'center' | 'branch' | 'leaf';

function NodeChip({
  node,
  tier,
  isNew,
  onAnchorClick,
  elapsedMs,
}: {
  node: MindMapNode;
  tier: NodeTier;
  isNew: boolean;
  onAnchorClick?: (ms: number) => void;
  elapsedMs: number;
}) {
  const anim = isNew
    ? 'animate-[mindGrow_520ms_cubic-bezier(0.2,0.8,0.2,1)]'
    : '';

  const showTime = tier !== 'center' && node.anchorMs > 0;
  const clickable = showTime && onAnchorClick !== undefined;

  const handleClick = () => {
    if (!clickable) return;
    onAnchorClick(node.anchorMs);
  };

  // ── center：课堂结构的当前核心 ────────────────────────────────
  if (tier === 'center') {
    return (
      <div className={`group flex flex-col items-start text-left ${anim}`}>
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          本节主题
        </span>
        <span className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-ink">
          {node.label}
        </span>
        {node.detail && (
          <span className="mt-2 max-w-[34rem] text-[13px] leading-[1.65] text-ink-secondary">
            {node.detail}
          </span>
        )}
        {/* 未使用字段防 lint */}
        <span className="hidden" aria-hidden>{elapsedMs}</span>
      </div>
    );
  }

  // ── leaf：纯文字 + 前导 tick 点，叶是枝头的字 ─────────────────────
  return (
    <div className={`group relative ${anim}`}>
      <div
        onClick={handleClick}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : -1}
        onKeyDown={(e) => {
          if (!clickable) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onAnchorClick?.(node.anchorMs);
          }
        }}
        className={[
          'inline-flex items-center gap-2 px-0.5 py-1 rounded-[6px]',
          'text-[12.5px] leading-[1.35] text-ink-secondary',
          clickable
            ? 'cursor-pointer transition hover:text-ink'
            : '',
        ].join(' ')}
      >
        <span
          aria-hidden
          className="inline-block h-[3px] w-[3px] rounded-full bg-ink-muted/70 transition group-hover:bg-ink"
        />
        <span>{node.label}</span>
      </div>
      {showTime && (
        <span className="absolute -bottom-4 left-4 font-mono text-[11px] tabular-nums text-ink-muted/70 opacity-0 transition group-hover:opacity-100">
          {formatAt(node.anchorMs)}
        </span>
      )}
      {isNew && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[6px] border border-[#1C1B19]/10 animate-[mindPulse_1400ms_ease-out_forwards]"
        />
      )}
    </div>
  );
}

// ── 预热态占位 ─────────────────────────────────────────────────────

function Dormant({ elapsedMs }: { elapsedMs: number }) {
  const sec = Math.floor(elapsedMs / 1000);
  const phase = sec < 30 ? '听清开场' : sec < 60 ? '抓第一条主线' : '等待稳定结构';
  const body = sec < 30
    ? '老师进入正题后，这里会从一句句话里长出结构。'
    : sec < 60
      ? '我正在把刚才的内容压成第一层脉络。'
      : '再等一段更稳定的讲解，就能画出可点击的小树。';

  return (
    <div className="flex h-full flex-col px-6 py-6 text-left lg:px-8">
      <div className="rounded-[24px] border border-divider bg-[#F2EDE3] px-5 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">课堂结构</p>
            <h2 className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-ink">我在听这节课</h2>
          </div>
          <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-divider bg-white">
            <span className="absolute h-8 w-8 rounded-full border border-[#1C1B19]/10 animate-[mindBreath_2600ms_ease-in-out_infinite]" />
            <span className="h-3 w-3 rounded-full bg-ink" />
          </div>
        </div>
        <p className="mt-3 max-w-[32rem] text-[13px] leading-[1.75] text-ink-secondary">
          {body}
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {['听清开场', '抓主线', '长成小树'].map((item, index) => {
            const active = item === phase || (phase === '等待稳定结构' && index === 2);
            const done = (sec >= 30 && index === 0) || (sec >= 60 && index === 1);
            return (
              <div
                key={item}
                className={`rounded-2xl border px-3 py-3 ${
                  active ? 'border-ink bg-white' : done ? 'border-divider bg-white' : 'border-divider bg-canvas'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-ink' : done ? 'bg-ink-muted' : 'bg-divider'}`} />
                  <span className="text-[12px] font-medium text-ink-secondary">{item}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid flex-1 content-start gap-3 sm:grid-cols-2">
        <div className="rounded-[20px] border border-dashed border-divider bg-white px-4 py-4">
          <p className="text-[12px] font-medium text-ink-muted">现在适合</p>
          <p className="mt-2 text-[14px] leading-[1.7] text-ink-secondary">继续听；哪里没跟上，直接问右边的同学。</p>
        </div>
        <div className="rounded-[20px] border border-dashed border-divider bg-white px-4 py-4">
          <p className="text-[12px] font-medium text-ink-muted">等结构出现后</p>
          <p className="mt-2 text-[14px] leading-[1.7] text-ink-secondary">点任意节点，就能跳回左边那一句课堂文字。</p>
        </div>
      </div>
    </div>
  );
}

// ── 主画布 ─────────────────────────────────────────────────────────

export function MindMap({
  tree,
  newNodeIds,
  elapsedMs,
  onAnchorClick,
}: MindMapProps) {
  const { root, branches, leavesByBranch } = useMemo(() => {
    const root = tree.nodes.find((n) => n.parentId === null) ?? null;
    const branchArr = root
      ? tree.nodes
          .filter((n) => n.parentId === root.id)
          .sort((a, b) => a.anchorMs - b.anchorMs)
      : [];
    const leafMap = new Map<string, MindMapNode[]>();
    for (const b of branchArr) {
      const leaves = tree.nodes
        .filter((n) => n.parentId === b.id)
        .sort((a, b) => a.anchorMs - b.anchorMs);
      leafMap.set(b.id, leaves);
    }
    return { root, branches: branchArr, leavesByBranch: leafMap };
  }, [tree]);

  // 判定"预热态"：没有 root，或者只有一个"正在识别…"占位
  const isDormant =
    !root ||
    branches.length === 0 ||
    (branches.length === 0 && /^正在/.test(root.label));

  if (isDormant || !root) {
    return (
      <div className="flex-1 overflow-y-auto">
        <Dormant elapsedMs={elapsedMs} />
      </div>
    );
  }

  const focusRows = branches.slice(-4).map((branch) => {
    const leaves = leavesByBranch.get(branch.id) ?? [];
    return {
      id: branch.id,
      title: branch.label,
      detail: leaves.slice(-2).map((leaf) => leaf.label).join(' · ') || branch.detail || '正在补充细节',
      anchorMs: branch.anchorMs,
    };
  });

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 py-5 lg:px-6">
      <div className="rounded-[24px] border border-divider bg-[#F2EDE3] px-5 py-5">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0 flex-1">
            <NodeChip
              node={root}
              tier="center"
              isNew={newNodeIds.has(root.id)}
              elapsedMs={elapsedMs}
            />
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1 text-right">
            <span className="text-[12px] font-medium text-ink-muted">已形成</span>
            <span className="font-mono text-[18px] font-medium tabular-nums text-ink">
              {branches.length}
            </span>
            <span className="text-[12px] text-ink-muted">条主线</span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid flex-1 content-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {branches.map((branch) => {
          const leaves = leavesByBranch.get(branch.id) ?? [];
          const clickable = branch.anchorMs > 0 && onAnchorClick !== undefined;
          return (
            <section
              key={branch.id}
              className={`rounded-[22px] border bg-white px-4 py-4 ${
                newNodeIds.has(branch.id) ? 'border-ink animate-[mindGrow_520ms_cubic-bezier(0.2,0.8,0.2,1)]' : 'border-divider'
              }`}
            >
              <button
                type="button"
                onClick={() => clickable && onAnchorClick?.(branch.anchorMs)}
                className={`w-full text-left ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">{branch.label}</p>
                    {branch.detail ? (
                      <p className="mt-1 text-[12.5px] leading-[1.55] text-ink-muted">{branch.detail}</p>
                    ) : null}
                  </div>
                  {branch.anchorMs > 0 ? (
                    <span className="font-mono text-[11px] tabular-nums text-ink-muted">{formatAt(branch.anchorMs)}</span>
                  ) : null}
                </div>
              </button>

              <div className="mt-3 space-y-1.5 border-t border-divider pt-3">
                {leaves.length > 0 ? (
                  leaves.map((leaf) => (
                    <NodeChip
                      key={leaf.id}
                      node={leaf}
                      tier="leaf"
                      isNew={newNodeIds.has(leaf.id)}
                      onAnchorClick={onAnchorClick}
                      elapsedMs={elapsedMs}
                    />
                  ))
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-ink-muted">这一条还在补细节。</p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {focusRows.length > 0 ? (
        <div className="mt-3 rounded-[20px] border border-divider bg-canvas px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[12px] font-medium text-ink-muted">最近主线</span>
            <span className="font-mono text-[12px] tabular-nums text-ink-muted">{formatAt(elapsedMs)}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {focusRows.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => item.anchorMs > 0 && onAnchorClick?.(item.anchorMs)}
                className="rounded-xl border border-divider bg-white px-3 py-2 text-left transition hover:border-ink-muted"
              >
                <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-muted">{item.detail}</p>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default MindMap;
