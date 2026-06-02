'use client';

/**
 * IntentSummaryCard — AI 在对话里提炼的"我想要的"卡片，用户决定保不保存。
 *
 * 视觉：v7 设计宪法。米白纸感主底，pine 极淡 ring，shadow-card。
 * 出现位置：嵌在 IntentDialog 的对话流里，由消息文本中
 *           ---我想要的--- ... ---结束--- 之间的内容触发。
 *
 * 不做的事：
 *   ✗ 不做"AI 主动总结"按钮（那是 IntentDialog 的事）
 *   ✗ 不写 Prisma / IndexedDB（保存动作由调用方处理）
 */

import { useState } from 'react';
import { Check, X } from 'lucide-react';

interface IntentSummaryCardProps {
  /** AI 提炼出的标题（一句话） */
  title: string;
  /** AI 提炼出的详细描述，可选 */
  summary?: string;
  /** 用户点"先放放"——卡片折叠不保存 */
  onDismiss: () => void;
  /** 用户点"就是这样"——保存为一条 GoalEntry */
  onAccept: (params: { title: string; summary?: string }) => Promise<void> | void;
  /** 已经保存过了（避免重复保存） */
  saved?: boolean;
}

export function IntentSummaryCard({
  title: initialTitle,
  summary: initialSummary,
  onDismiss,
  onAccept,
  saved = false,
}: IntentSummaryCardProps) {
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary ?? '');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const handleAccept = async () => {
    if (busy || saved) return;
    setBusy(true);
    try {
      await onAccept({ title: title.trim() || initialTitle, summary: summary.trim() || undefined });
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <div
        className="rounded-2xl border border-pine/20 bg-paper px-5 py-4 shadow-soft"
        style={{ background: 'linear-gradient(180deg, rgba(45,79,62,0.04) 0%, transparent 100%)' }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pine text-white">
            <Check size={14} strokeWidth={2.4} />
          </span>
          <p className="text-[13px] font-medium text-pine">已记下了</p>
        </div>
        <p className="mt-2 text-[15px] leading-7 text-[#1C1B19]">{title}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-divider bg-paper px-5 py-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8E8B82]">
        我听到的是
      </p>

      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-2 w-full rounded-lg border border-divider bg-white px-3 py-2 text-[16px] font-medium leading-7 text-[#1C1B19] focus:border-pine focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 block w-full text-left text-[16px] font-medium leading-7 text-[#1C1B19] hover:underline"
          aria-label="点击修改"
        >
          {title}
        </button>
      )}

      {summary || editing ? (
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={editing ? 3 : Math.min(5, Math.ceil((summary.length || 1) / 30))}
          className="mt-2 w-full resize-none rounded-lg border border-divider-light bg-white/60 px-3 py-2 text-[14px] leading-6 text-[#5C5A55] focus:border-pine focus:outline-none"
          placeholder="可以再补一两句你想要的"
        />
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-divider bg-white px-4 text-[13px] font-medium text-[#5C5A55] transition-colors hover:bg-paper-warm disabled:opacity-40"
        >
          <X size={14} strokeWidth={2} />
          先放放
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={busy || !title.trim()}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-[#1C1B19] px-4 text-[13px] font-medium text-white transition-colors hover:bg-pine disabled:opacity-40"
        >
          <Check size={14} strokeWidth={2.2} />
          {busy ? '记着…' : '就是这样'}
        </button>
      </div>
    </div>
  );
}

export default IntentSummaryCard;
