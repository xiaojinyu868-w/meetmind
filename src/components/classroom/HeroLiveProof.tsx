'use client';

/**
 * HeroLiveProof — "活"的示例卡：让第一屏就看见产品在工作。
 *
 * 原话逐字浮现（StreamText，AI 流式输出是仪式时刻白名单里的一项）→ 同桌的解释浮起 → 停一会 → 下一个瞬间。
 * 三个瞬间全部来自示例课真实转录（COPY.hero.proofMoments），时间戳能在示例课里核对；第四幕「下课以后」
 * （COPY.hero.proofAfter）让三件产物逐条浮起，再点一句记忆承诺——听 → 懂 → 长出应用 → 记住你，一张卡讲完整个产品。
 * 悬停暂停；prefers-reduced-motion 时只静态显示第一个瞬间。卡片本身是进入示例课的入口。
 * 课堂零存量首屏与 landing 首屏共用；landing 用 tone="onDark" 放在深色照片上。
 */

import * as React from 'react';
import { ArrowRight } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import { StreamText } from '@/components/ui/stream-text';
const PROOF_QUOTE_STEP_SEC = 0.028;
const PROOF_ANSWER_DELAY_MS = 500;
const PROOF_HOLD_MS = 4600;
const PROOF_AFTER_STAGGER_MS = 420;

export function HeroLiveProof({ onOpen, href, tone = 'paper', className }: {
  onOpen?: () => void;
  /** landing 用链接跳转，app 内用回调 */
  href?: string;
  tone?: 'paper' | 'onDark';
  className?: string;
}) {
  const moments = COPY.hero.proofMoments;
  const after = COPY.hero.proofAfter;
  /** 第四幕「下课以后」：index === moments.length */
  const beats = moments.length + 1;
  const [index, setIndex] = React.useState(0);
  const [answerVisible, setAnswerVisible] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [reduced, setReduced] = React.useState(false);
  const isAfter = index === moments.length;

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(media.matches);
    apply();
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, []);

  const moment = moments[Math.min(index, moments.length - 1)];

  React.useEffect(() => {
    if (reduced) {
      setAnswerVisible(true);
      return;
    }
    setAnswerVisible(false);
    // 下课幕没有原话可流，三件产物逐条浮起后再算"讲完"
    const readyMs = isAfter
      ? after.items.length * PROOF_AFTER_STAGGER_MS + PROOF_ANSWER_DELAY_MS
      : moment.quote.length * PROOF_QUOTE_STEP_SEC * 1000 + PROOF_ANSWER_DELAY_MS;
    const showAnswer = window.setTimeout(() => setAnswerVisible(true), readyMs);
    return () => window.clearTimeout(showAnswer);
  }, [after.items.length, index, isAfter, moment.quote.length, reduced]);

  React.useEffect(() => {
    if (reduced || paused || !answerVisible || beats < 2) return;
    const next = window.setTimeout(() => setIndex((current) => (current + 1) % beats), isAfter ? PROOF_HOLD_MS + 1200 : PROOF_HOLD_MS);
    return () => window.clearTimeout(next);
  }, [answerVisible, beats, index, isAfter, paused, reduced]);

  const Root: React.ElementType = href ? 'a' : 'button';
  const rootProps = href
    ? { href }
    : { type: 'button' as const, onClick: onOpen };
  return (
    <Root
      {...rootProps}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'group relative block w-full overflow-hidden rounded-[24px] border p-5 text-left transition-all hover:-translate-y-0.5 sm:p-6',
        tone === 'onDark'
          ? 'border-white/20 bg-white/[0.92] shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl hover:bg-white'
          : 'border-divider bg-white shadow-[0_18px_60px_rgba(28,27,25,0.075)] hover:border-pine/25 hover:shadow-[0_22px_70px_rgba(28,27,25,0.10)]',
        className,
      )}
      aria-label={`${COPY.hero.proofAction}：${isAfter ? after.title : moment.quote}`}
    >
      <div className="flex items-center justify-between gap-4">
        <span className={cn('inline-flex items-center gap-2 text-[11px] font-medium', isAfter ? 'text-ink-secondary' : 'text-pine')}>
          <span className="relative flex h-2 w-2">
            {isAfter ? null : <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-20" />}
            <span className={cn('relative inline-flex h-2 w-2 rounded-full', isAfter ? 'bg-ink/30' : 'bg-pine')} />
          </span>
          {isAfter ? after.status : COPY.hero.proofStatus}
        </span>
        <span className="font-mono text-[10px] text-ink-muted">{isAfter ? after.time : moment.time}</span>
      </div>

      {/* 两种幕的正文高度不同，固定最小高度让循环切幕时卡片不跳 */}
      <div className="min-h-[282px]">
      {isAfter ? (
        <>
          {/* 第四幕：听懂之外，这节课长出了什么 */}
          <p className="mt-6 text-[19px] font-medium leading-8 tracking-[-0.018em] text-ink">{after.title}</p>
          <div className="my-6 h-px bg-divider/80" />
          <ul className="space-y-2" aria-label={after.title}>
            {after.items.map((item, i) => (
              <li
                key={item.name}
                className="flex items-baseline justify-between gap-3 rounded-[14px] bg-paper-warm/80 px-4 py-2.5"
                style={reduced ? undefined : { opacity: 0, animation: `v9-rise 560ms cubic-bezier(0.16, 1, 0.3, 1) ${i * PROOF_AFTER_STAGGER_MS}ms forwards` }}
              >
                <span className="text-[14px] font-medium text-ink">{item.name}</span>
                <span className="text-right text-[12px] leading-5 text-ink-secondary">{item.note}</span>
              </li>
            ))}
          </ul>
          <p
            className={cn(
              'mt-3 min-h-[20px] text-[12.5px] leading-5 text-pine transition-all duration-500 ease-out',
              answerVisible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
            )}
          >
            {after.memory}
          </p>
        </>
      ) : (
        <>
          <blockquote className="mt-6 min-h-[64px] text-[19px] font-medium leading-8 tracking-[-0.018em] text-ink" aria-live="off">
            {reduced ? (
              <span>“{moment.quote}”</span>
            ) : (
              <StreamText key={index} text={`“${moment.quote}”`} step={PROOF_QUOTE_STEP_SEC} cursor={!answerVisible} className="inline" />
            )}
          </blockquote>

          <div className="my-6 h-px bg-divider/80" />

          <div
            className={cn(
              'rounded-[16px] bg-paper-warm/80 p-4 transition-all duration-500 ease-out',
              answerVisible ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
            )}
          >
            <p className="font-mono text-[9px] font-semibold tracking-[0.12em] text-pine">
              {COPY.hero.proofLabel}
            </p>
            <p className="mt-2 min-h-[56px] text-[14px] leading-7 text-ink-secondary">
              {moment.answer}
            </p>
            <span className="cite-ts mt-3">
              [{moment.time}]
            </span>
          </div>
        </>
      )}
      </div>

      <div className="mt-5 flex items-center justify-between text-[12.5px] font-medium text-ink-secondary">
        <span>{COPY.hero.proofAction}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1" aria-hidden>
            {Array.from({ length: beats }, (_, i) => (
              <span
                key={i}
                className={cn('h-1 rounded-full transition-all duration-300', i === index ? 'w-4 bg-pine' : 'w-1 bg-divider')}
              />
            ))}
          </span>
          <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Root>
  );
}

