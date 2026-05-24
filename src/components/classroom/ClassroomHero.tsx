'use client';

/**
 * ClassroomHero — 课堂页首屏（新用户零存量态）。
 *
 * 取代老的 EmptyState（"录下第一节课 / 点下面那颗按钮就能录"）。
 * 老版本的问题：
 *   - 没有产品身份（用户不知道这是什么样的 AI 陪伴）
 *   - 没有能力展示（用户看不到"这个 AI 能给我什么"）
 *   - 唯一 CTA 是个硬行动（"录音"门槛高，新用户会犹豫）
 *
 * 新 hero 的结构：
 *   [同学 avatar + 名字]
 *   主标："录一节课，我陪你听。"
 *   副标："听不懂的随时问我。"
 *
 *   [▶ 试听一节 demo 课]  [● 录我自己的课]
 *      ↑ 先点这个，零门槛体验完整闭环（93s demo 已在 fixtures 里）
 *
 *   ────────────────────
 *   同学能做的事
 *   [速查表][闪卡][导图][测验][报告]  ← 5 张小卡，点任一张也进 demo
 *
 * 交互原则：
 *   - 只有 2 个主操作（demo / 自录），capability strip 点击 = 跳到 demo
 *     再让用户在真实课堂里点对应 chip——避免"预览"和"真实"两条路
 *   - Hover 有轻微 scale（1.04）+ 边框色加深，不加阴影不加动画
 *   - 整个 hero 的视觉分量要比老 EmptyState 大 30%——不是留白而是"邀请玩"
 */

import * as React from 'react';
import { Play, Mic } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { CompanionAvatar } from './CompanionAvatar';
import { DEMO_APP_PREVIEWS } from '@/fixtures/demo-app-outputs';
import { cn } from '@/lib/utils';

export interface ClassroomHeroProps {
  /** 点 "试听一节 demo 课"——由父组件调 loadDemoLesson + 跳转 */
  onTryDemo: () => void;
  /** 点 "录我自己的课"——等同老版 onStart */
  onStartRecording: () => void;
  /** 能力卡片被点击时——默认等同 onTryDemo，父组件可自定义 */
  onCapabilityClick?: (appKey: string) => void;
  className?: string;
}

export function ClassroomHero({
  onTryDemo,
  onStartRecording,
  onCapabilityClick,
  className,
}: ClassroomHeroProps) {
  const handleCapability = React.useCallback(
    (appKey: string) => {
      if (onCapabilityClick) onCapabilityClick(appKey);
      else onTryDemo();
    },
    [onCapabilityClick, onTryDemo],
  );

  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center px-6 pb-12 pt-4', className)}>
      <div className="w-full max-w-xl">
        {/* 身份锚：avatar + 名字。左对齐，不居中——留出呼吸空间 */}
        <div className="flex items-center gap-2.5 text-ink">
          <CompanionAvatar size="lg" state="idle" />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-ink-secondary">
            {COPY.identity.name}
          </span>
        </div>

        {/* 主标 + 副标：字号跳跃建立层次 */}
        <h2 className="mt-5 text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
          {COPY.identity.tagline}
        </h2>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-muted">
          {COPY.identity.subtagline}
        </p>

        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {COPY.hero.outcomes.map((item) => (
            <div key={item.label} className="rounded-2xl border border-divider bg-white px-3.5 py-3">
              <p className="text-[11px] font-medium text-ink-muted">{item.label}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-ink-secondary">{item.text}</p>
            </div>
          ))}
        </div>

        {/* 两个 CTA：demo 在左（primary 位，心理门槛更低），自录在右 */}
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onTryDemo}
            className={cn(
              'group inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-[14px] font-medium text-white',
              'transition hover:bg-[#1a1a19] active:scale-[0.99]',
            )}
          >
            <Play size={14} strokeWidth={2.5} className="fill-white" />
            <span>{COPY.cta.demo}</span>
          </button>
          <button
            type="button"
            onClick={onStartRecording}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border border-divider bg-white px-5 py-3 text-[14px] font-medium text-ink',
              'transition hover:border-ink-muted active:scale-[0.99]',
            )}
          >
            <Mic size={14} strokeWidth={2} />
            <span>{COPY.cta.record}</span>
          </button>
        </div>

        {/* 能力预览条：5 张小卡 */}
        <div className="mt-10">
          <div className="flex items-baseline justify-between gap-2 pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-secondary">
              {COPY.hero.capabilityLabel}
            </span>
            <span className="text-[11px] text-ink-muted/80">
              {COPY.hero.capabilityHint}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {DEMO_APP_PREVIEWS.map((preview) => (
              <button
                key={preview.appKey}
                type="button"
                onClick={() => handleCapability(preview.appKey)}
                className={cn(
                  'group flex flex-col items-start gap-1.5 rounded-2xl border border-divider bg-white p-3 text-left',
                  'transition hover:border-ink-muted hover:-translate-y-[1px]',
                )}
                title={preview.tagline}
              >
                <span className="text-[13px] font-medium tracking-[-0.01em] text-ink">
                  {preview.title}
                </span>
                <span className="line-clamp-2 text-[11px] leading-snug text-ink-muted">
                  {preview.sampleLine}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClassroomHero;
