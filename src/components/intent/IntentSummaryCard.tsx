'use client';

/**
 * IntentSummaryCard — AI 提炼的"我想要的"逐条确认卡片。
 *
 * 灵感来自 Elys 的"分身先行生成 → 人类逐条确认/撤回"：
 * AI 产出多个观察点，用户逐条选择"对"或"不对"。
 * - 对的 → 合并保存为 GoalEntry
 * - 不对的 → 作为反馈注入下一轮对话（让 AI 知道"这条不对"）
 */

import { useState } from 'react';
import { Check, X, RotateCcw } from 'lucide-react';

interface IntentSummaryCardProps {
  /** AI 提炼出的观察点列表 */
  points: string[];
  /** 已保存 */
  saved?: boolean;
  /** 保存接受的目标点 */
  onAccept: (params: { title: string; summary?: string; acceptedPoints: string[]; rejectedPoints: string[] }) => Promise<void> | void;
  /** 用户点"先放放" */
  onDismiss: () => void;
}

type PointState = 'pending' | 'accepted' | 'rejected';

export function IntentSummaryCard({
  points,
  saved = false,
  onAccept,
  onDismiss,
}: IntentSummaryCardProps) {
  const [states, setStates] = useState<PointState[]>(() => points.map(() => 'pending'));
  const [busy, setBusy] = useState(false);

  const acceptedCount = states.filter((s) => s === 'accepted').length;
  const allResolved = states.every((s) => s !== 'pending');

  const togglePoint = (idx: number, state: PointState) => {
    setStates((prev) => prev.map((s, i) => (i === idx ? (s === state ? 'pending' : state) : s)));
  };

  const handleSave = async () => {
    if (busy || saved) return;
    setBusy(true);
    try {
      const acceptedPoints = points.filter((_, i) => states[i] === 'accepted');
      const rejectedPoints = points.filter((_, i) => states[i] === 'rejected');
      if (acceptedPoints.length === 0) {
        setBusy(false);
        return;
      }
      // 合并接受的点为 title + summary
      const title = acceptedPoints[0].slice(0, 80);
      const summary = acceptedPoints.length > 1 ? acceptedPoints.slice(1).join('\n') : undefined;
      await onAccept({ title, summary, acceptedPoints, rejectedPoints });
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="rounded-2xl border border-pine/20 bg-paper px-5 py-4 shadow-soft"
        style={{ background: 'linear-gradient(180deg, rgba(45,79,62,0.04) 0%, transparent 100%)' }}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pine text-white">
            <Check size={14} strokeWidth={2.4} />
          </span>
          <p className="text-[13px] font-medium text-pine">已记下了</p>
        </div>
        <div className="mt-2 space-y-1">
          {points.filter((_, i) => states[i] === 'accepted').map((p, i) => (
            <p key={i} className="text-[14px] leading-6 text-ink">{p}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-divider bg-paper px-5 py-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted mb-3">
        我听到的 · 逐条确认
      </p>

      <div className="space-y-2">
        {points.map((point, idx) => {
          const st = states[idx];
          return (
            <div
              key={idx}
              className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                st === 'accepted' ? 'border-pine/30 bg-pine-mist/30' :
                st === 'rejected' ? 'border-vermilion/20 bg-vermilion-mist/20 opacity-60' :
                'border-divider bg-white'
              }`}
            >
              <p className={`flex-1 text-[14px] leading-6 ${st === 'rejected' ? 'line-through text-ink-muted' : 'text-ink'}`}>
                {point}
              </p>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => togglePoint(idx, 'accepted')}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90 ${
                    st === 'accepted' ? 'bg-pine text-white' : 'bg-paper-warm text-ink-muted hover:bg-pine-mist'
                  }`}
                  aria-label="对"
                >
                  <Check size={13} strokeWidth={2.4} />
                </button>
                <button
                  type="button"
                  onClick={() => togglePoint(idx, 'rejected')}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition active:scale-90 ${
                    st === 'rejected' ? 'bg-vermilion text-white' : 'bg-paper-warm text-ink-muted hover:bg-vermilion-mist'
                  }`}
                  aria-label="不对"
                >
                  <X size={13} strokeWidth={2.4} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-divider bg-white px-4 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-paper-warm disabled:opacity-40"
        >
          <X size={14} strokeWidth={2} />
          先放放
        </button>
        <div className="flex items-center gap-2">
          {acceptedCount > 0 && (
            <span className="font-mono text-[10px] text-pine">{acceptedCount} 条确认</span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || acceptedCount === 0}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-pine disabled:opacity-40"
          >
            <Check size={14} strokeWidth={2.2} />
            {busy ? '记着…' : '记下确认的'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default IntentSummaryCard;
