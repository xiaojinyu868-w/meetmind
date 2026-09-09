/**
 * CollectionEmptyState — 收集为空时的第一屏（2026-09-09 二次重做，对标 HyperKnow 首页）
 *
 * 一屏只有一件主角：输入框。它坐在页面视觉中心，是一个真正的指挥台（`CollectionComposerBar hero`：
 * 两行起、带标签的工具行、阴影与聚焦环），而不是钉在页面底部的一条。
 * 上方 Octo + 一句情境标题 + 一句副题；下方一行带图标的能力 pill（丢什么进来——课件 / 链接 / 想法 / 语音 / 微信），
 * 再下面一小段「丢进来会变成什么」三行，像一份安静的清单。整块铺在一层点阵纸纹上（极淡，只在中央一圈），
 * 空页面也有质地，不靠内容撑。
 *
 * 前两版的病：大头像 + 四张图标卡 + 底部孤零零的输入栏（两套入口打架、中间一大片空白）；
 * 再之前一版把一切退成小字（输入框单行、方式变成一行 13px 文字），干净但寒。
 */

'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Link2, MessageCircle, Mic, PenLine, Upload } from 'lucide-react';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { COPY } from '@/lib/ui/copy';

export interface CollectionEmptyStateProps {
  /** 真实的收集输入栏（宿主以 hero 变体渲染，空态时坐在这里而不是页面底部） */
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

const ENTRY_ICONS = {
  upload: Upload,
  link: Link2,
  write: PenLine,
  voice: Mic,
  wechat: MessageCircle,
} as const;

/** 点阵纸纹：只在中央一圈可见，边缘淡出——空页面有质地，但不抢输入框 */
const DOT_FIELD_STYLE = {
  backgroundImage: 'radial-gradient(rgba(16,22,15,0.09) 1px, transparent 1.2px)',
  backgroundSize: '22px 22px',
  maskImage: 'radial-gradient(ellipse 70% 60% at 50% 42%, rgba(0,0,0,0.9) 20%, rgba(0,0,0,0.35) 55%, transparent 85%)',
  WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 42%, rgba(0,0,0,0.9) 20%, rgba(0,0,0,0.35) 55%, transparent 85%)',
} as const;

export function CollectionEmptyState({ composer, onUpload, onLink, onWrite, onVoice }: CollectionEmptyStateProps) {
  const copy = COPY.collection;
  const entryActions: Record<string, (() => void) | undefined> = { upload: onUpload, link: onLink, write: onWrite, voice: onVoice };

  return (
    <div className="relative flex w-full flex-col items-center px-2 pb-10 pt-6 sm:pt-10">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 bottom-0" style={DOT_FIELD_STYLE} />

      {/* Octo + 情境标题 */}
      <div className="relative flex flex-col items-center text-center">
        <OctoAvatar mood="listening" size="lg" aura={false} />
        <h2 className="mt-4 text-[24px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">{copy.emptyTitle}</h2>
        <p className="mt-2 max-w-[520px] text-[13.5px] leading-6 text-ink-secondary">{copy.emptyBody}</p>
      </div>

      {/* 主角：输入框 */}
      {composer ? <div className="relative mt-7 w-full max-w-[720px]">{composer}</div> : null}

      {/* 能力 pill：丢什么进来 */}
      <div className="relative mt-5 flex w-full max-w-[780px] flex-wrap justify-center gap-2">
        {copy.emptyEntries.map((entry) => {
          const Icon = ENTRY_ICONS[entry.key];
          const className = 'inline-flex items-center gap-2 rounded-full border border-divider bg-white px-3.5 py-2 text-[12.5px] text-ink-secondary shadow-[0_1px_0_rgba(16,22,15,0.03)] transition hover:border-pine/40 hover:bg-pine-fog/50 hover:text-pine active:scale-[0.98]';
          if (entry.key === 'wechat') {
            return (
              <Link key={entry.key} href="/help" className={className} title={copy.emptyWechatTitle}>
                <Icon size={14} strokeWidth={1.8} className="text-ink-muted" />
                <span>{entry.label}</span>
              </Link>
            );
          }
          return (
            <button key={entry.key} type="button" onClick={entryActions[entry.key]} className={className}>
              <Icon size={14} strokeWidth={1.8} className="text-ink-muted" />
              <span>{entry.label}</span>
            </button>
          );
        })}
      </div>

      {/* 丢进来会变成什么：三行安静的清单 */}
      <div className="relative mt-12 w-full max-w-[640px]">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{copy.emptyBecomesEyebrow}</p>
        <ul className="mt-2">
          {copy.emptyBecomes.map((row) => (
            <li key={row.input} className="flex items-baseline gap-3 border-b border-divider/60 py-3 last:border-0">
              <ArrowRight size={13} className="mt-1 shrink-0 translate-y-px text-pine" />
              <span className="text-[13.5px] leading-6 text-ink-secondary">
                <span className="text-ink">{row.input}</span>
                <span className="mx-2 text-ink-muted/70" aria-hidden>→</span>
                {row.output}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px] text-ink-muted">
          <span>{copy.emptyWechatTitle}</span>
          <Link href="/#download" className="inline-flex items-center gap-1 transition hover:text-pine">
            {copy.emptyPocketHint}<ArrowRight size={11} />
          </Link>
        </p>
      </div>
    </div>
  );
}
