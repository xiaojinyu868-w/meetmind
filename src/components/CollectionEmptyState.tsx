/**
 * CollectionEmptyState — 收集为空时的第一屏（2026-09-09 重做）
 *
 * 此前：大头像 + 标题 + 副标题 + 四张图标卡（上传 / 链接 / 写一句 / 录一段）+ 一行微信提示，
 * 输入框却孤零零钉在页面最底部——两套入口打架，中间一大片空白，像 demo 的 landing。
 *
 * 现在与问同学第一屏同一套语言：同学开口一句（"想到什么，就留在这里"），输入框是主角、坐在句子正下方
 * （宿主把真实的 CollectionComposerBar 传进来，空态时它不再钉在底部），四种方式退成输入框脚下一行可点的字，
 * 微信 / 桌面口袋是最轻的两行小字。没有卡片网格。
 */

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { COPY } from '@/lib/ui/copy';

export interface CollectionEmptyStateProps {
  /** 真实的收集输入栏（宿主渲染，空态时坐在这里而不是页面底部） */
  composer?: ReactNode;
  /** 上传：打开文件选择器（文件/音频/视频/图片） */
  onUpload: () => void;
  /** 链接：聚焦输入框（粘贴链接触发自动识别） */
  onLink: () => void;
  /** 写一句：聚焦输入框 */
  onWrite: () => void;
  /** 录一段：打开语音录制 */
  onVoice: () => void;
}

export function CollectionEmptyState({ composer, onUpload, onLink, onWrite, onVoice }: CollectionEmptyStateProps) {
  const entryActions = { upload: onUpload, link: onLink, write: onWrite, voice: onVoice } as const;
  const copy = COPY.collection;

  return (
    <div className="flex w-full flex-col py-6 sm:py-10">
      {/* 同学开口 */}
      <div className="mx-auto flex w-full max-w-3xl items-start gap-3.5 px-3 lg:px-5">
        <div className="mt-1 shrink-0">
          <OctoAvatar mood="listening" size="sm" aura={false} />
        </div>
        <p className="text-[17px] leading-[1.75] tracking-[-0.005em] text-ink sm:text-[18px]">
          <span className="mr-2 font-serif italic text-pine">{copy.emptySpeaker}</span>
          {copy.emptyOpening}
        </p>
      </div>

      {/* 输入框——主角（宿主传入真实输入栏） */}
      {composer ? <div className="mt-3">{composer}</div> : null}

      <div className="mx-auto w-full max-w-3xl px-3 lg:px-5">
        {/* 四种方式：一行字 */}
        <p className="flex flex-wrap items-baseline gap-x-1.5 px-1 text-[13px] leading-6 text-ink-secondary">
          {copy.emptyEntries.map((entry, index) => (
            <span key={entry.key} className="inline-flex items-baseline">
              {index > 0 ? <span className="mr-1.5 text-ink-muted/60" aria-hidden>·</span> : null}
              <button
                type="button"
                onClick={entryActions[entry.key]}
                className="rounded px-0.5 underline decoration-transparent decoration-[1.5px] underline-offset-[5px] transition hover:text-pine hover:decoration-pine/60"
              >
                {entry.label}
              </button>
            </span>
          ))}
        </p>

        {/* 别处也能收：最轻的两行 */}
        <div className="mt-8 flex flex-col gap-1.5 px-1 text-[12px] leading-5 text-ink-muted">
          <Link href="/help" className="inline-flex w-fit items-center gap-1 transition hover:text-pine">
            {copy.emptyWechatHint}<ArrowRight size={11} />
          </Link>
          <Link href="/#download" className="inline-flex w-fit items-center gap-1 transition hover:text-pine">
            {copy.emptyPocketHint}<ArrowRight size={11} />
          </Link>
        </div>
      </div>
    </div>
  );
}
