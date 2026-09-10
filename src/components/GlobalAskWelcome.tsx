'use client';

import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import type { AskOpening, OpeningPart } from '@/components/global-ask-opening';

/**
 * GlobalAskWelcome — 问同学第一屏：同学在场
 *
 * 之前这一屏是：大头像 + 眉题 + 衬线大标题 + 副标题 + 「上次继续」列表行 + 一张写着「正在读 / 记住」
 * 标签与 chip 的书桌 + 输入框 + 带勾的模式单选 + 「会参考 6 份当前内容、24 条最近学习、1 条长期线索」。
 * 那是把上下文当库存陈列的表单，不是一个听过课的人开口。
 *
 * 现在只有三样东西，一列，左对齐：
 *   1. 同学开口的一两句话（真实事实，书名 / 时间点 / 概念本身可点）
 *   2. 输入框——这一屏的主角，模式是输入框脚下两个词，不是单选控件
 *   3. 最多三行「可以从这里开始」，是句子，不是卡片
 * 没有光场、没有玻璃叠玻璃、没有计数。参考范围在顶栏，需要时再看。
 */

interface GlobalAskWelcomeProps {
  depth: 'quick' | 'deep';
  opening: AskOpening;
  /** 访客的试听入口（同学还没读到任何东西时给出口） */
  onStartDemo?: () => void;
  /** 免费档：深度模式（陪我学会）是 Pro/Max 专属 */
  deepLocked?: boolean;
  composer: ReactNode;
  onDepthChange: (depth: 'quick' | 'deep') => void;
  onChoosePrompt: (prompt: string) => void;
}

function OpeningSentence({ parts, onChoose }: { parts: OpeningPart[]; onChoose: (prompt: string) => void }) {
  return (
    <p className="text-[17px] leading-[1.75] tracking-[-0.005em] text-ink sm:text-[18px]">
      <span className="mr-2 font-medium text-pine">{GLOBAL_ASK_COPY.opening.speaker}</span>
      {parts.map((part, index) => {
        if (part.kind === 'text' || !part.prompt) {
          // 贴着可点部分的短语（"你在 " / " 停过。"）不许单独换行——"停 / 过。"断成两行是排版事故
          const prev = parts[index - 1];
          const next = parts[index + 1];
          const glued = part.text.trim().length <= 4 && ((prev && prev.kind !== 'text') || (next && next.kind !== 'text'));
          return <span key={index} className={glued ? 'whitespace-nowrap' : undefined}>{part.text}</span>;
        }
        if (part.kind === 'stamp') {
          return (
            <button
              key={index}
              type="button"
              onClick={() => onChoose(part.prompt!)}
              className="cite-ts mono mx-0.5 -translate-y-px cursor-pointer align-middle text-[12px] transition hover:brightness-95"
              title={part.prompt}
            >
              {part.text}
            </button>
          );
        }
        // 书名 / 概念：句子里的字，带一条安静的下划线，悬停变成签名色
        return (
          <button
            key={index}
            type="button"
            onClick={() => onChoose(part.prompt!)}
            className="cursor-pointer rounded-sm text-ink underline decoration-pine/35 decoration-[1.5px] underline-offset-[5px] transition hover:text-pine hover:decoration-pine"
            title={part.prompt}
          >
            {part.text}
          </button>
        );
      })}
    </p>
  );
}

export function GlobalAskWelcome({
  depth,
  opening,
  onStartDemo,
  deepLocked = false,
  composer,
  onDepthChange,
  onChoosePrompt,
}: GlobalAskWelcomeProps) {
  const copy = GLOBAL_ASK_COPY.opening;
  return (
    <div className="mx-auto flex w-full max-w-[660px] flex-1 flex-col justify-center px-5 pb-14 pt-6 sm:px-6">
      {/* 1. 同学开口 */}
      <div className="flex items-start gap-3.5">
        <div className="mt-1 shrink-0">
          <OctoAvatar mood="listening" size="sm" aura={false} />
        </div>
        <div className="min-w-0 flex-1">
          <OpeningSentence parts={opening.parts} onChoose={onChoosePrompt} />
          {opening.empty && onStartDemo ? (
            <button
              type="button"
              onClick={onStartDemo}
              className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-pine underline-offset-4 hover:underline"
            >
              {copy.demoAction}
              <ArrowRight size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {/* 2. 输入框——主角。模式是脚下两个词 */}
      <div
        className={cn(
          'mt-7 rounded-[22px] border border-divider bg-card shadow-card transition-[box-shadow,border-color] duration-300',
          'focus-within:border-pine/40 focus-within:shadow-[0_0_0_4px_rgba(47,107,85,0.08),0_16px_48px_rgba(32,49,42,0.10)]',
        )}
      >
        <div className="px-4 pt-3.5 sm:px-5">{composer}</div>
        <div className="flex items-center justify-between gap-3 px-4 pb-3 sm:px-5">
          <div className="flex items-center gap-1 text-[12.5px]" role="radiogroup" aria-label={GLOBAL_ASK_COPY.modeSelectorLabel}>
            {(['quick', 'deep'] as const).map((option, index) => {
              const selected = depth === option;
              return (
                <span key={option} className="inline-flex items-center">
                  {index > 0 ? <span className="mx-1.5 text-ink-muted/60" aria-hidden>·</span> : null}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onDepthChange(option)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 transition',
                      selected
                        ? 'font-semibold text-ink underline decoration-pine decoration-[1.5px] underline-offset-[6px]'
                        : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {option === 'quick' ? GLOBAL_ASK_COPY.quickMode : GLOBAL_ASK_COPY.deepMode}
                    {option === 'deep' && deepLocked ? (
                      <span className="rounded-full bg-pine/10 px-1.5 py-px font-mono text-[9px] font-semibold text-pine">
                        {COPY.membership.tierName.pro}
                      </span>
                    ) : null}
                  </button>
                </span>
              );
            })}
          </div>
          <span className="hidden text-[11px] text-ink-muted sm:inline">
            {depth === 'quick' ? GLOBAL_ASK_COPY.quickModeBody : GLOBAL_ASK_COPY.deepModeBody}
          </span>
        </div>
      </div>

      {/* 3. 可以从这里开始——句子，不是卡片 */}
      {opening.starters.length > 0 ? (
        <div className="mt-8">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{copy.startersEyebrow}</p>
          <ul className="mt-2.5 flex flex-col">
            {opening.starters.map((starter) => (
              <li key={starter.id}>
                <button
                  type="button"
                  onClick={() => onChoosePrompt(starter.prompt)}
                  className="group flex w-full items-baseline gap-2.5 rounded-lg px-1 py-2 text-left transition hover:bg-paper-warm/70"
                >
                  <ArrowRight size={13} className="mt-1 shrink-0 translate-y-px text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
                  <span className="text-[14px] leading-6 text-ink-secondary transition group-hover:text-ink">{starter.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
