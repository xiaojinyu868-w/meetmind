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

  // ── center：纯文字双行，去掉黑胶囊 ────────────────────────────────
  if (tier === 'center') {
    return (
      <div className={`group flex flex-col items-center text-center ${anim}`}>
        <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-muted">
          本节主题
        </span>
        <span className="mt-1.5 text-[17px] font-semibold tracking-[-0.015em] text-ink">
          {node.label}
        </span>
        {node.detail && (
          <span className="mt-1.5 max-w-[26rem] text-[12.5px] leading-[1.55] text-ink-secondary">
            {node.detail}
          </span>
        )}
        {/* 未使用字段防 lint */}
        <span className="hidden" aria-hidden>{elapsedMs}</span>
      </div>
    );
  }

  // ── branch：白底 + 极细边，承载"枝"的结构感 ───────────────────────
  if (tier === 'branch') {
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
            'inline-flex items-center gap-1.5',
            'px-3.5 py-1.5 rounded-[10px]',
            'bg-white ring-[0.5px] ring-[#232322]/[0.14]',
            'text-[13px] font-medium tracking-[-0.005em] text-ink',
            clickable ? 'cursor-pointer transition hover:ring-[#232322]/[0.28]' : '',
          ].join(' ')}
        >
          <span>{node.label}</span>
        </div>
        {showTime && (
          <span className="absolute -bottom-4 left-1 font-mono text-[10px] tabular-nums text-ink-muted/70 opacity-0 group-hover:opacity-100 transition">
            {formatAt(node.anchorMs)}
          </span>
        )}
        {isNew && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[10px] ring-[1.5px] ring-[#232322]/[0.18] animate-[mindPulse_1400ms_ease-out_forwards]"
          />
        )}
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
        <span className="absolute -bottom-3.5 left-4 font-mono text-[10px] tabular-nums text-ink-muted/60 opacity-0 group-hover:opacity-100 transition">
          {formatAt(node.anchorMs)}
        </span>
      )}
      {isNew && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[6px] ring-[1px] ring-[#232322]/[0.10] animate-[mindPulse_1400ms_ease-out_forwards]"
        />
      )}
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
        {sec < 30
          ? '再等一会儿——老师进入正题我就开始画这节课的小树。'
          : sec < 60
            ? '正在整理第一段理解……'
            : '还在等一段能理出结构的内容，别急，马上就来。'}
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

  // 骨架连线用 CSS 实现足够，不引入 SVG：
  //   - 中心到分支：中心底部出一根短竖线 → 水平 T 形横梁（只在有 ≥2 个分支时绘制）→ 每个分支头上方一根短竖线
  //   - 分支到叶子：分支底部一根竖线延伸进入叶列，叶列整体左侧一根淡色垂直引导线
  const hasMultiBranch = branches.length >= 2;

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-12 pb-12 lg:px-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
        {/* 中心节点 */}
        <NodeChip
          node={root}
          tier="center"
          isNew={newNodeIds.has(root.id)}
          elapsedMs={elapsedMs}
        />

        {/* 中心 → 分支：竖线 + T 形横梁 */}
        <div className="mt-5 h-5 w-px bg-divider" aria-hidden />
        {hasMultiBranch && (
          <div
            aria-hidden
            // 横梁宽度按分支数量 × 最小栏宽粗略估算；用 max-w 兜住上限
            className="h-px w-full max-w-[560px] bg-divider"
            style={{
              width: `${Math.min(branches.length * 140, 560)}px`,
            }}
          />
        )}

        {/* 分支行：横向排布 */}
        <div className="flex w-full flex-wrap items-start justify-center gap-x-10 gap-y-10">
          {branches.map((b) => {
            const leaves = leavesByBranch.get(b.id) ?? [];
            return (
              <div
                key={b.id}
                className="flex min-w-[120px] max-w-[220px] flex-col items-center"
              >
                {/* 横梁 → 分支头 的短竖线（只在多分支时有横梁，单分支时已经有中心下来的主竖线） */}
                {hasMultiBranch && <div className="h-4 w-px bg-divider" aria-hidden />}

                {/* 分支节点 */}
                <NodeChip
                  node={b}
                  tier="branch"
                  isNew={newNodeIds.has(b.id)}
                  onAnchorClick={onAnchorClick}
                  elapsedMs={elapsedMs}
                />

                {/* 分支 → 叶子 */}
                {leaves.length > 0 && (
                  <>
                    <div className="mt-3 h-3 w-px bg-divider" aria-hidden />
                    {/* 叶子列：整体左侧一根淡色垂直引导线，叶子以缩进方式挂在上面 */}
                    <div className="relative mt-0.5 flex flex-col items-start gap-1.5 pl-4">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute left-0 top-1 bottom-1 w-px bg-[#E9E9E7]/70"
                      />
                      {leaves.map((l) => (
                        <React.Fragment key={l.id}>
                          <NodeChip
                            node={l}
                            tier="leaf"
                            isNew={newNodeIds.has(l.id)}
                            onAnchorClick={onAnchorClick}
                            elapsedMs={elapsedMs}
                          />
                        </React.Fragment>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MindMap;
