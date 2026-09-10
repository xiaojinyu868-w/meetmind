'use client';

/**
 * TeachBackBench — 面试间的主舞台：评委席。
 *
 * 三位评委并排立在一条桌沿线上（桌面 120px / 手机 72px 肖像，不裁圆、不套底），桌沿下是三个名字（12px 墨色）。
 * 他们的状态只靠表情与一枚指示点表达：在听 = listening 表情；有人想问 = 桌沿正中一枚呼吸的点；
 * 在说 = 那位换 speaking 表情 + 名字旁一枚松绿点；实时反馈关着时 = 肖像右上角一枚极小的角标数字（记了几笔）。
 * 没有状态词、没有人设说明常驻——hover / 长按肖像才出一行人设。
 *
 * 评委开口 = 他脚下长出一段话：桌沿下一根细线接到那位名字正下方，话 16px 墨色逐字流出；说完留一会淡下去
 * （相位与不透明度由 use-teach-back-stage 算好传进来），滑进下面的对话记录。
 */

import { useEffect, useRef, useState } from 'react';
import type { TeachBackJudgeId } from '@/lib/ai-native/types';
import { TEACH_BACK_JUDGE_IDS } from '@/lib/ai-native/teach-back-panel';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import type { ListenerStatus } from './teach-back-room-model';
import type { StageUtterance } from './use-teach-back-stage';

/**
 * 评委肖像：章鱼家族（public/images/octo-buddy/judges/<代号>-<表情>.webp，192px 透明底）。
 * 两张表情：在听 → listening；在说 → speaking。两张叠放，切换 120ms 交叉淡入，prefers-reduced-motion 下瞬切。
 * 直接 <img>：不要 next/image 的模糊占位与尺寸协商。
 */
const PORTRAIT_FILE: Record<TeachBackJudgeId, string> = { direct: 'zhiyan', guide: 'yindao', probe: 'zhuiwen' };
export type PortraitMood = 'listening' | 'speaking';

export function portraitSrc(judgeId: TeachBackJudgeId, mood: PortraitMood): string {
  return `/images/octo-buddy/judges/${PORTRAIT_FILE[judgeId]}-${mood}.webp`;
}

export function Portrait({ judgeId, mood, size, className = '' }: { judgeId: TeachBackJudgeId; mood: PortraitMood; size: number; className?: string }) {
  const name = APPS_COPY.teachBack.judges[judgeId].name;
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }} data-mood={mood}>
      {(['listening', 'speaking'] as PortraitMood[]).map((expression) => (
        // eslint-disable-next-line @next/next/no-img-element -- 静态 ≤11KB 透明 webp，直接 <img>：不要 next/image 的模糊占位与尺寸协商
        <img
          key={expression}
          src={portraitSrc(judgeId, expression)}
          alt={expression === mood ? name : ''}
          draggable={false}
          className={`absolute inset-0 h-full w-full select-none object-contain object-bottom transition-opacity duration-[120ms] ease-linear motion-reduce:transition-none ${expression === mood ? 'opacity-100' : 'opacity-0'}`}
        />
      ))}
    </span>
  );
}

/** 表情：在说 → speaking；其余（在听 / 想问 / 记了几笔 / 讲完了）都是听 */
export function portraitMoodOf(status: ListenerStatus): PortraitMood {
  return status === 'speaking' ? 'speaking' : 'listening';
}

const LONG_PRESS_MS = 450;

interface SeatProps {
  judgeId: TeachBackJudgeId;
  status: ListenerStatus;
  held: number;
  size: number;
  /** 讲完了（记下的正在依次说出来）：角标不再出现 */
  showHeld: boolean;
  /** hover / 长按肖像 → 名牌下出一行人设 */
  onPersona: (show: boolean) => void;
}

function Seat({ judgeId, status, held, size, showHeld, onPersona }: SeatProps) {
  const copy = APPS_COPY.teachBack;
  const pressTimer = useRef<number | null>(null);
  const clearPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  useEffect(() => () => clearPress(), []);
  return (
    <div
      className="relative flex flex-col items-center"
      data-testid={`teach-back-judge-${judgeId}`}
      data-status={status}
      data-held={showHeld && held > 0 ? held : undefined}
    >
      <button
        type="button"
        aria-label={copy.judges[judgeId].name}
        title={copy.judges[judgeId].persona}
        onMouseEnter={() => onPersona(true)}
        onMouseLeave={() => onPersona(false)}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse') return;
          clearPress();
          pressTimer.current = window.setTimeout(() => onPersona(true), LONG_PRESS_MS);
        }}
        onPointerUp={() => { clearPress(); window.setTimeout(() => onPersona(false), 1_600); }}
        onPointerCancel={clearPress}
        onBlur={() => onPersona(false)}
        className="mm-focus relative rounded-lg"
        style={{ width: size, height: size }}
      >
        <Portrait judgeId={judgeId} mood={portraitMoodOf(status)} size={size} />
        {showHeld && held > 0 ? (
          <span
            className="mm-pop-in absolute right-0 top-0 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-paper-deep px-1 font-mono text-[11px] leading-none text-ink-secondary"
            title={copy.notedCount(held)}
            data-testid={`teach-back-held-${judgeId}`}
          >
            {held}
          </span>
        ) : null}
      </button>
    </div>
  );
}

interface NamePlateProps {
  judgeId: TeachBackJudgeId;
  status: ListenerStatus;
  personaVisible: boolean;
}

function NamePlate({ judgeId, status, personaVisible }: NamePlateProps) {
  const copy = APPS_COPY.teachBack;
  const speaking = status === 'speaking';
  return (
    <div className="relative flex flex-col items-center">
      <div className="flex h-4 items-center gap-1.5">
        <span className="text-[12px] leading-none text-ink">{copy.judges[judgeId].name}</span>
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 motion-reduce:transition-none ${speaking ? 'bg-pine' : 'bg-transparent'}`}
          aria-hidden
        />
      </div>
      {personaVisible ? (
        <p className="mm-pop-in absolute top-full mt-1 whitespace-nowrap rounded bg-paper px-1.5 text-[12px] leading-5 text-ink-muted">{copy.judges[judgeId].persona}</p>
      ) : null}
    </div>
  );
}

interface BenchProps {
  statuses: Record<TeachBackJudgeId, ListenerStatus>;
  heldCounts: Record<TeachBackJudgeId, number>;
  /** 台上的话（某位脚下） */
  current: StageUtterance | null;
  /** 实时反馈开着、回合请求在飞、还没人开口 → 桌沿正中一枚呼吸的点 */
  thinking: boolean;
  /** 手机 / 窄容器：72px 肖像 */
  compact: boolean;
  /** 讲完了以后：角标不再出现（记下的正在依次说出来） */
  finished: boolean;
  /** 开场：脚下不会有话，少留空 */
  opening?: boolean;
  /** 桌沿下一行小字，只在"正在核对 / 没核对上"时出现 */
  notice?: React.ReactNode;
}

export function TeachBackBench({ statuses, heldCounts, current, thinking, compact, finished, opening = false, notice }: BenchProps) {
  const size = compact ? 72 : 120;
  const width = compact ? 330 : 720;
  const speakerIndex = current ? TEACH_BACK_JUDGE_IDS.indexOf(current.judgeId) : -1;
  const [personaFor, setPersonaFor] = useState<TeachBackJudgeId | null>(null);

  return (
    <section className="w-full" data-testid="teach-back-bench" data-speaker={current?.judgeId ?? undefined} data-phase={current?.phase ?? undefined}>
      <div className="mx-auto w-full" style={{ maxWidth: width }}>
        {/* 三位：立在桌沿上 */}
        <div className="grid grid-cols-3 items-end px-2">
          {TEACH_BACK_JUDGE_IDS.map((id) => (
            <Seat
              key={id}
              judgeId={id}
              status={statuses[id]}
              held={heldCounts[id]}
              size={size}
              showHeld={!finished}
              onPersona={(show) => setPersonaFor((prev) => (show ? id : prev === id ? null : prev))}
            />
          ))}
        </div>
        {/* 桌沿：一根线 + 极淡的一层桌面 */}
        <div className="relative" aria-hidden>
          <div className="h-px w-full bg-divider" />
          <div className="h-2.5 w-full bg-gradient-to-b from-paper-warm to-transparent" />
          {thinking ? (
            <span
              className="absolute left-1/2 top-[-4px] h-2 w-2 -translate-x-1/2 animate-pulse rounded-full bg-pine-light motion-reduce:animate-none"
              data-testid="teach-back-thinking"
            />
          ) : null}
        </div>
        {/* 名牌 */}
        <div className="grid grid-cols-3 px-2">
          {TEACH_BACK_JUDGE_IDS.map((id) => (
            <NamePlate key={id} judgeId={id} status={statuses[id]} personaVisible={personaFor === id} />
          ))}
        </div>
        {/* 脚下的话 */}
        <div className="relative mt-2 px-2" style={{ minHeight: opening ? 16 : compact ? 56 : 72 }}>
          {current ? (
            <Speech current={current} speakerIndex={speakerIndex} compact={compact} />
          ) : notice ? (
            <div className="pt-4 text-center text-[13px] leading-6 text-ink-secondary" data-testid="teach-back-notice">{notice}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Speech({ current, speakerIndex, compact }: { current: StageUtterance; speakerIndex: number; compact: boolean }) {
  const column = compact
    ? 'col-span-3 justify-self-stretch'
    : speakerIndex === 0
      ? 'col-span-2 col-start-1 justify-self-start'
      : speakerIndex === 2
        ? 'col-span-2 col-start-2 justify-self-end'
        : 'col-span-3 justify-self-center';
  return (
    <div
      className="relative grid grid-cols-3 transition-opacity duration-300 motion-reduce:transition-none"
      style={{ opacity: current.opacity }}
      data-testid="teach-back-speech"
      data-judge={current.judgeId}
      data-phase={current.phase}
      data-kind={current.kind}
    >
      {/* 从名字正下方接下来的一根细线 */}
      <span
        className="absolute top-0 h-3.5 w-px bg-ink-muted/60"
        style={{ left: `${((speakerIndex + 0.5) * 100) / 3}%` }}
        aria-hidden
      />
      <p
        className={`${column} mt-5 whitespace-pre-wrap text-ink ${compact ? 'text-[15px] leading-7' : 'text-[16px] leading-7'}`}
        style={{ maxWidth: compact ? undefined : 560 }}
      >
        {current.text}
        {current.typing ? <span className="typing-caret" aria-hidden /> : null}
      </p>
    </div>
  );
}
