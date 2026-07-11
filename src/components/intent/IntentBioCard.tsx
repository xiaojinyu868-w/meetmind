'use client';

/**
 * IntentBioCard — AI 首次会面提炼的"我了解到的你"逐条确认卡片。
 *
 * 同 IntentSummaryCard 的逐条确认模式：
 * 每条观察点用户可以独立 ✅ 对 / ❌ 不对
 */

import { useState } from 'react';
import { Check, X, UserCircle2 } from 'lucide-react';

interface IntentBioCardProps {
  /** AI 提炼出的观察点列表 */
  points: string[];
  /** 已保存 */
  saved?: boolean;
  /** 保存接受的画像点 */
  onAccept: (params: { headline: string; detail?: string; acceptedPoints: string[]; rejectedPoints: string[] }) => Promise<void> | void;
  /** 先放放 */
  onDismiss: () => void;
}

type PointState = 'pending' | 'accepted' | 'rejected';

export function IntentBioCard({
  points,
  saved = false,
  onAccept,
  onDismiss,
}: IntentBioCardProps) {
  const [states, setStates] = useState<PointState[]>(() => points.map(() => 'pending'));
  const [busy, setBusy] = useState(false);

  const acceptedCount = states.filter((s) => s === 'accepted').length;

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
      // 第一条作为 headline，其余作为 detail
      const headline = acceptedPoints[0];
      const detail = acceptedPoints.length > 1 ? acceptedPoints.slice(1).join('\n') : undefined;
      await onAccept({ headline, detail, acceptedPoints, rejectedPoints });
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div className="rounded-2xl border border-pine/30 bg-pine/[0.08] px-5 py-4 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pine text-white">
            <Check size={14} strokeWidth={2.4} />
          </span>
          <p className="text-[13px] font-medium text-pine">认识你了</p>
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
    <div className="rounded-2xl border border-divider bg-white/96 px-5 py-4 backdrop-blur-md shadow-card">
      <div className="flex items-center gap-2 mb-3">
        <UserCircle2 size={14} strokeWidth={1.8} className="text-pine" />
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
          我了解到的你 · 逐条确认
        </p>
      </div>

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

      <p className="mt-2 text-[11.5px] leading-5 text-ink-muted">
        以后我们再聊的时候我就接着这个，不用再重新介绍你自己。可以改，也可以删。
      </p>

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

export default IntentBioCard;
