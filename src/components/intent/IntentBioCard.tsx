'use client';

/**
 * IntentBioCard — AI 首次会面对话提炼的"我了解到的你"画像，用户决定保不保存。
 *
 * 视觉：v7 沉浸式风格的卡片（区别于 IntentSummaryCard 的米白纸感）。
 * 这个卡片显示在沉浸式深色背景上，所以用 glass + pine 强调色。
 *
 * 出现位置：嵌在 IntentDialog 对话流的 AI 气泡 footer，由消息文本中
 *           ---我了解到的你--- ... ---结束--- 之间的内容触发。
 *
 * 行为：用户可以编辑（headline 必填，detail 可选）→ 保存为 BioEntry。
 */

import { useState } from 'react';
import { Check, X, UserCircle2 } from 'lucide-react';

interface IntentBioCardProps {
  /** AI 提炼出的核心句（身份 + 阶段 + 状态） */
  headline: string;
  /** 可选 detail */
  detail?: string;
  /** 已保存（避免重复保存） */
  saved?: boolean;
  /** 用户点"先放放"——卡片折叠不保存 */
  onDismiss: () => void;
  /** 用户确认——保存为 BioEntry */
  onAccept: (params: { headline: string; detail?: string }) => Promise<void> | void;
}

export function IntentBioCard({
  headline: initialHeadline,
  detail: initialDetail,
  saved = false,
  onDismiss,
  onAccept,
}: IntentBioCardProps) {
  const [headline, setHeadline] = useState(initialHeadline);
  const [detail, setDetail] = useState(initialDetail ?? '');
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    if (busy || saved) return;
    setBusy(true);
    try {
      await onAccept({
        headline: headline.trim() || initialHeadline,
        detail: detail.trim() || undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div
        className="rounded-2xl border border-pine/30 bg-pine/[0.08] px-5 py-4 backdrop-blur-md"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pine text-white">
            <Check size={14} strokeWidth={2.4} />
          </span>
          <p className="text-[13px] font-medium text-pine">认识你了</p>
        </div>
        <p className="mt-2 text-[15px] leading-7 text-ink">{headline}</p>
        {detail ? <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{detail}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-divider bg-white/96 px-5 py-4 backdrop-blur-md shadow-card">
      <div className="flex items-center gap-2">
        <UserCircle2 size={14} strokeWidth={1.8} className="text-pine" />
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
          我了解到的你
        </p>
      </div>

      <textarea
        value={headline}
        onChange={(e) => setHeadline(e.target.value)}
        rows={2}
        className="mt-2 w-full resize-none rounded-lg border border-divider bg-white px-3 py-2 text-[15px] font-medium leading-7 text-ink focus:border-pine focus:outline-none"
      />

      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={detail ? Math.min(4, Math.max(2, Math.ceil(detail.length / 30))) : 2}
        placeholder="（可选）想再补一两句你这个人的细节"
        className="mt-2 w-full resize-none rounded-lg border border-divider-light bg-white/60 px-3 py-2 text-[14px] leading-6 text-ink-secondary focus:border-pine focus:outline-none"
      />

      <p className="mt-2 text-[11.5px] leading-5 text-ink-muted">
        以后我们再聊的时候我就接着这个，不用再重新介绍你自己。可以改，也可以删。
      </p>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-divider bg-white px-4 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-paper-warm disabled:opacity-40"
        >
          <X size={14} strokeWidth={2} />
          先放放
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={busy || !headline.trim()}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-pine disabled:opacity-40"
        >
          <Check size={14} strokeWidth={2.2} />
          {busy ? '记着…' : '就是我'}
        </button>
      </div>
    </div>
  );
}

export default IntentBioCard;
