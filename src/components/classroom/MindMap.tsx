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
 * 设计系统：零渐变、零阴影、纯平涂。
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
  const base =
    'group relative inline-flex flex-col items-start transition-all duration-500';

  const sizing =
    tier === 'center'
      ? 'px-5 py-3 rounded-2xl'
      : tier === 'branch'
        ? 'px-4 py-2 rounded-xl'
        : 'px-3 py-1.5 rounded-lg';

  const surface =
    tier === 'center'
      ? 'bg-ink text-white ring-0'
      : tier === 'branch'
        ? 'bg-white text-ink ring-[0.5px] ring-[#232322]/[0.12]'
        : 'bg-white text-ink-secondary ring-[0.5px] ring-[#232322]/[0.06]';

  const labelSize =
    tier === 'center'
      ? 'text-[14.5px] font-medium tracking-[-0.01em]'
      : tier === 'branch'
        ? 'text-[13px] font-medium tracking-[-0.005em]'
        : 'text-[12px] font-normal';

  const anim = isNew
    ? 'animate-[mindGrow_520ms_cubic-bezier(0.2,0.8,0.2,1)]'
    : '';

  const showTime = tier !== 'center' && node.anchorMs > 0;
  const clickable = showTime && onAnchorClick !== undefined;

  const handleClick = () => {
    if (!clickable) return;
    onAnchorClick(node.anchorMs);
  };

  return (
    <div className={`${base} ${anim}`}>
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
        className={`${sizing} ${surface} ${
          clickable ? 'cursor-pointer hover:ring-[#232322]/[0.22]' : ''
        }`}
      >
        <span className={labelSize}>{node.label}</span>
        {tier === 'center' && node.detail && (
          <span className="mt-1 text-[11.5px] leading-relaxed text-white/70">
            {node.detail}
          </span>
        )}
        {showTime && (
          <span className="absolute -bottom-4 left-2 font-mono text-[10px] tabular-nums text-ink-muted/60 opacity-0 group-hover:opacity-100 transition">
            {formatAt(node.anchorMs)}
          </span>
        )}
      </div>
      {/* 新节点 2s 内的柔和呼吸光（用 ring 渐隐模拟，不用 shadow） */}
      {isNew && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] ring-[1.5px] ring-[#232322]/[0.14] animate-[mindPulse_1400ms_ease-out_forwards]"
          style={{ borderRadius: tier === 'center' ? 16 : tier === 'branch' ? 12 : 8 }}
        />
      )}
      {/* 未使用字段防 tslint 警告 */}
      <span className="hidden" aria-hidden>
        {elapsedMs}
      </span>
    </div>
  );
}

// ── 预热态占位 ─────────────────────────────────────────────────────

function Dormant({ elapsedMs }: { elapsedMs: number }) {
  const sec = Math.floor(elapsedMs / 1000);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-10 pb-24 text-center">
      <div className="relative flex h-12 w-12 items-center justify-center">
        <span className="absolute h-3 w-3 rounded-full bg-ink" />
        <span className="absolute h-8 w-8 rounded-full ring-[0.5px] ring-[#232322]/[0.12] animate-[mindBreath_2600ms_ease-in-out_infinite]" />
        <span className="absolute h-12 w-12 rounded-full ring-[0.5px] ring-[#232322]/[0.06] animate-[mindBreath_3400ms_ease-in-out_infinite]" />
      </div>
      <p className="mt-6 text-[14px] font-medium tracking-[-0.005em] text-ink">
        我在听这节课
      </p>
      <p className="mt-2 max-w-[22rem] text-[12.5px] leading-relaxed text-ink-muted">
        {sec < 90
          ? '等老师讲到正题，我会从这里长出一棵小树。'
          : '正在整理第一段理解……'}
      </p>
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

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-10 pb-10 lg:px-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
        {/* 中心节点 */}
        <NodeChip
          node={root}
          tier="center"
          isNew={newNodeIds.has(root.id)}
          elapsedMs={elapsedMs}
        />

        {/* 中心 → 分支 连线区 */}
        <div className="relative w-full">
          {/* 竖直小线段：中心节点向下延伸 */}
          <div className="mx-auto h-6 w-px bg-[#E9E9E7]" />
        </div>

        {/* 分支行：横向排布 */}
        <div className="flex w-full flex-wrap items-start justify-center gap-x-6 gap-y-8">
          {branches.map((b) => {
            const leaves = leavesByBranch.get(b.id) ?? [];
            return (
              <div
                key={b.id}
                className="flex min-w-[110px] max-w-[200px] flex-col items-center"
              >
                {/* 分支节点 */}
                <NodeChip
                  node={b}
                  tier="branch"
                  isNew={newNodeIds.has(b.id)}
                  onAnchorClick={onAnchorClick}
                  elapsedMs={elapsedMs}
                />

                {/* 分支 → 叶子 连线 */}
                {leaves.length > 0 && (
                  <div className="mx-auto h-5 w-px bg-[#E9E9E7]" />
                )}

                {/* 叶子列 */}
                <div className="flex flex-col items-center gap-2">
                  {leaves.map((l, i) => (
                    <React.Fragment key={l.id}>
                      <NodeChip
                        node={l}
                        tier="leaf"
                        isNew={newNodeIds.has(l.id)}
                        onAnchorClick={onAnchorClick}
                        elapsedMs={elapsedMs}
                      />
                      {i < leaves.length - 1 && (
                        <span className="h-2 w-px bg-[#E9E9E7]/70" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MindMap;
