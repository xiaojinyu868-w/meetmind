/**
 * CollectionEmptyState — 收集为空时的空态
 *
 * 心智：好的产品自然到不需要引导。一句问候 + 四张自解释入口卡
 * （上传 / 链接 / 写一句 / 录一段），每张卡直接触发底部输入栏的真实动作，
 * 用户看一眼就知道能做什么、点哪里。
 *
 * 设计系统：v7 token（bg-card / border-divider / pine hover / shadow-soft）+ Octo 签名。
 */

'use client';

import { Link2, Mic, PenLine, Upload } from 'lucide-react';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { COPY } from '@/lib/ui/copy';

// ==================== 类型 ====================

export interface CollectionEmptyStateProps {
  /** 上传卡：打开文件选择器（文件/音频/视频/图片） */
  onUpload: () => void;
  /** 链接卡：聚焦底部输入框（粘贴链接触发自动识别） */
  onLink: () => void;
  /** 写一句卡：聚焦底部输入框 */
  onWrite: () => void;
  /** 录一段卡：打开语音录制 */
  onVoice: () => void;
}

const ENTRY_ICONS = {
  upload: Upload,
  link: Link2,
  write: PenLine,
  voice: Mic,
} as const;

// ==================== 组件实现 ====================

export function CollectionEmptyState({ onUpload, onLink, onWrite, onVoice }: CollectionEmptyStateProps) {
  const entryActions = {
    upload: onUpload,
    link: onLink,
    write: onWrite,
    voice: onVoice,
  } as const;

  return (
    <div className="px-6" style={{ paddingTop: '12vh' }}>
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
        <OctoAvatar mood="listening" size="xl" aura={false} className="opacity-90" />
        <h3 className="mt-4 text-xl font-semibold tracking-h text-ink">
          {COPY.collection.emptyTitle}
        </h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
          {COPY.collection.emptyBody}
        </p>

        <div className="mt-7 grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
          {COPY.collection.emptyEntries.map((entry) => {
            const Icon = ENTRY_ICONS[entry.key];
            return (
              <button
                key={entry.key}
                type="button"
                onClick={entryActions[entry.key]}
                className="flex flex-col items-start gap-2.5 rounded-2xl border border-divider bg-card px-4 py-5 text-left transition hover:border-pine/40 hover:bg-pine-fog hover:shadow-soft active:scale-[0.98]"
              >
                <Icon size={18} className="text-ink-secondary" />
                <span className="text-[13.5px] font-medium text-ink">{entry.label}</span>
                <span className="text-[11.5px] leading-snug text-ink-muted">{entry.hint}</span>
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-xs text-ink-muted">{COPY.collection.emptyWechatHint}</p>
      </div>
    </div>
  );
}
