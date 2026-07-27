'use client';

/**
 * TeachBackQuadrantMap — 讲给同桌听的结果揭示仪式。
 *
 * 不讲「报告」，讲「位置」：每个讲述目标是一枚棋子，按 自信 × 有据
 * 落进四象限地图——右上「讲透了」、左上「挣扎着讲通了」、
 * 左下「自己知道卡住了」、右下「盲区」。盲区落地后朱批轻脉冲，
 * 它是这个产品存在的理由。没讲到的目标不进地图，在下方单列。
 */

import type { TeachBackEvaluationItem, TeachBackQuadrant } from '@/lib/ai-native/types';
import { COPY } from '@/lib/ui/copy';

interface TeachBackQuadrantMapProps {
  items: TeachBackEvaluationItem[];
}

interface CellDef {
  key: TeachBackQuadrant;
  label: string;
  chipClass: string;
  cellClass: string;
  pulse?: boolean;
}

/** 行=有据（上：讲对 / 下：讲错），列=自信（左：不确定 / 右：自信） */
const CELLS: Record<'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight', CellDef> = {
  topLeft: {
    key: 'productive-struggle',
    label: COPY.apps.teachBack.quadrantStruggle,
    chipClass: 'border-pine/35 bg-pine-mist/40 text-pine',
    cellClass: 'bg-pine-fog/40',
  },
  topRight: {
    key: 'mastery',
    label: COPY.apps.teachBack.quadrantMastery,
    chipClass: 'border-pine/45 bg-pine-mist text-pine',
    cellClass: 'bg-pine-fog',
  },
  bottomLeft: {
    key: 'aware-gap',
    label: COPY.apps.teachBack.quadrantGap,
    chipClass: 'border-divider bg-paper-warm text-ink-secondary',
    cellClass: 'bg-paper-warm/50',
  },
  bottomRight: {
    key: 'blind-spot',
    label: COPY.apps.teachBack.quadrantBlindSpot,
    chipClass: 'border-vermilion/45 bg-vermilion-mist text-vermilion',
    cellClass: 'bg-vermilion-fog/50',
    pulse: true,
  },
};

function Chip({ item, cell, order }: { item: TeachBackEvaluationItem; cell: CellDef; order: number }) {
  return (
    <span
      className={`tbq-chip inline-flex max-w-full items-center rounded-lg border px-2 py-1 text-[11.5px] font-medium leading-4 ${cell.chipClass} ${cell.pulse ? 'tbq-chip-pulse' : ''}`}
      style={{ animationDelay: `${0.25 + order * 0.18}s` }}
      title={item.point}
    >
      <span className="truncate">{item.point}</span>
    </span>
  );
}

function QuadrantCell({ cell, items, orderStart }: { cell: CellDef; items: TeachBackEvaluationItem[]; orderStart: number }) {
  return (
    <div className={`flex min-h-[86px] flex-col gap-1.5 rounded-xl border border-divider/60 p-2.5 ${cell.cellClass}`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide opacity-80" style={{ color: 'inherit' }}>
        {cell.label}{items.length > 0 ? ` · ${items.length}` : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <Chip key={item.targetId} item={item} cell={cell} order={orderStart + index} />
        ))}
      </div>
    </div>
  );
}

export function TeachBackQuadrantMap({ items }: TeachBackQuadrantMapProps) {
  const byQuadrant = (key: TeachBackQuadrant) => items.filter((item) => item.quadrant === key);
  const uncovered = items.filter((item) => item.quadrant === null);

  const struggleItems = byQuadrant('productive-struggle');
  const masteryItems = byQuadrant('mastery');
  const gapItems = byQuadrant('aware-gap');
  const blindItems = byQuadrant('blind-spot');
  const orderTr = struggleItems.length;
  const orderBl = orderTr + masteryItems.length;
  const orderBr = orderBl + gapItems.length;

  return (
    <div className="rounded-2xl border border-divider bg-card p-4">
      {/* 纵轴标签 */}
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="font-mono text-[10px] uppercase tracking-caps text-ink-muted">有据 · 讲对了 ↑</p>
        <p className="font-mono text-[10px] uppercase tracking-caps text-ink-muted">自信 →</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <QuadrantCell cell={CELLS.topLeft} items={struggleItems} orderStart={0} />
        <QuadrantCell cell={CELLS.topRight} items={masteryItems} orderStart={orderTr} />
        <QuadrantCell cell={CELLS.bottomLeft} items={gapItems} orderStart={orderBl} />
        <QuadrantCell cell={CELLS.bottomRight} items={blindItems} orderStart={orderBr} />
      </div>
      <p className="px-1 pt-2 text-right font-mono text-[10px] uppercase tracking-caps text-ink-muted">讲错了 ↓</p>

      {uncovered.length > 0 ? (
        <div className="mt-3 border-t border-divider/60 pt-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
            {COPY.apps.teachBack.quadrantUncovered} · {uncovered.length}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {uncovered.map((item, index) => (
              <span
                key={item.targetId}
                className="tbq-chip inline-flex max-w-full items-center rounded-lg border border-dashed border-divider px-2 py-1 text-[11.5px] leading-4 text-ink-muted"
                style={{ animationDelay: `${0.25 + (items.length - uncovered.length + index) * 0.18}s` }}
                title={item.point}
              >
                <span className="truncate">{item.point}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .tbq-chip {
          opacity: 0;
          transform: translateY(-10px) scale(0.92);
          animation: tbqChipLand 420ms cubic-bezier(0.22, 1.4, 0.36, 1) forwards;
        }
        .tbq-chip-pulse {
          animation:
            tbqChipLand 420ms cubic-bezier(0.22, 1.4, 0.36, 1) forwards,
            tbqBlindPulse 2.6s ease-in-out 1s infinite;
        }
        @keyframes tbqChipLand {
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes tbqBlindPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(196, 94, 76, 0); }
          50% { box-shadow: 0 0 0 4px rgba(196, 94, 76, 0.14); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tbq-chip, .tbq-chip-pulse { animation: none; opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}

export default TeachBackQuadrantMap;
