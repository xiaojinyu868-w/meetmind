'use client';

/**
 * useOctoMood — Octo IP 性格 / 情绪触发机器（v7 全产品统一）
 *
 * 设计意图：
 *   Octo 是 MeetMind 的品牌 IP（v7 设计宪法第 5 节）。它有 8 个 mood：
 *     idle / listening / thinking / happy / surprised / love / angry / sleeping
 *
 *   但产品里大部分场景写死成 'idle' 或 'listening'——浪费了 IP 资产。
 *   v7 哲学：Octo 是有性格的 AI 同学，应该对学生当下的状态有情绪反应。
 *
 *   这个 hook 把"当前情境 → mood"的映射抽象成单一真相源：
 *     - 长期 mood（默认态，由 ctx 决定）
 *     - 短暂 mood（事件触发，900-2400ms 后回到长期 mood）
 *     - 时间 mood（凌晨自动 sleeping）
 *
 *   产品里任何地方需要决定 Octo 的表情，调用 useOctoMood({ ctx, ... })
 *   就能拿到当前应该显示的 mood，自动结合"现在几点"和"刚发生的事件"。
 *
 * 设计宪法（v7）：
 *   - 95% 时间：克制（idle / listening / thinking）
 *   - 5% 时间：仪式时刻（happy / surprised / love / sleeping / angry）
 *   - angry 是最稀缺的——必须真的连续答错 5 题这种强信号才触发，
 *     否则伤害"AI 不催促"的产品哲学
 *
 * 用法（调用方）：
 *
 *   const { mood, react } = useOctoMood({
 *     ctx: isRecording ? 'recording' : isReviewing ? 'reviewing' : 'idle',
 *   });
 *
 *   // 学生答对一题
 *   react('answer-correct');
 *
 *   <OctoAvatar mood={mood} />
 */

import * as React from 'react';

/** 8 mood 全集（与 OctoBuddyMood / OctoMood 类型对齐） */
export type OctoMoodKey =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'happy'
  | 'surprised'
  | 'love'
  | 'angry'
  | 'sleeping';

/** 长期态（context-based）—— 决定默认 mood */
export type OctoContextState =
  | 'idle'           // 空闲、列表浏览
  | 'recording'      // 录课中
  | 'review-empty'   // 复习态空态（AI 在等学生开口）
  | 'reviewing'      // 复习态进行中
  | 'brewing'        // 应用酿造中（>5s 长任务）
  | 'shared-landing'; // 分享落地页（陌生访客在看）

/** 短暂事件 —— 触发 900-2400ms 的临时 mood */
export type OctoReaction =
  // 学习成果（happy）
  | 'recording-finished'    // 录课结束 → 听完了
  | 'app-generated'         // 应用产物生成成功
  | 'echo-ready'            // 回声卡生成成功
  // 突发洞察（surprised）
  | 'new-concept'           // 识别到陌生概念
  | 'foresight'             // AI 给出预感
  // 答题反馈（happy / angry）
  | 'answer-correct'        // 答对一题
  | 'answer-streak'         // 连续答对 3+
  | 'answer-wrong'          // 答错一题
  | 'answer-frustrated'     // 连续答错 5+ → angry（极稀缺）
  // 情感（love）
  | 'long-session'          // 连续学习 30+ 分钟
  | 'shared'                // 用户分享了一节课（v3.0）
  | 'rated-up';             // 用户给了好评

interface UseOctoMoodOptions {
  /** 当前长期态（决定默认 mood） */
  ctx?: OctoContextState;
  /** 当前小时（0-23）；不传则用当前时间。22-6 点会进 sleeping */
  hour?: number;
  /** 是否启用凌晨 sleeping 自动切换（默认 true） */
  enableNightMode?: boolean;
}

interface UseOctoMoodResult {
  /** 当前应显示的 mood（综合长期态 / 时间 / 短暂事件） */
  mood: OctoMoodKey;
  /** 触发短暂事件 mood（自动回到长期态） */
  react: (reaction: OctoReaction) => void;
  /** 是否处于"反应中"（短暂 mood 未结束）—— 用于禁用其他切换 */
  reacting: boolean;
}

/**
 * context → 默认 mood 映射表
 *
 * 白天默认情绪（不考虑凌晨 sleeping override）
 */
const CTX_TO_MOOD: Record<OctoContextState, OctoMoodKey> = {
  'idle': 'idle',
  'recording': 'listening',
  'review-empty': 'idle',
  'reviewing': 'thinking',
  'brewing': 'thinking',
  'shared-landing': 'happy',
};

/**
 * reaction → 短暂 mood + 持续时间映射表
 */
const REACTION_TO_MOOD: Record<
  OctoReaction,
  { mood: OctoMoodKey; durationMs: number }
> = {
  'recording-finished':  { mood: 'happy',     durationMs: 2400 },
  'app-generated':       { mood: 'happy',     durationMs: 1800 },
  'echo-ready':          { mood: 'happy',     durationMs: 2200 },
  'new-concept':         { mood: 'surprised', durationMs: 1600 },
  'foresight':           { mood: 'surprised', durationMs: 1400 },
  'answer-correct':      { mood: 'happy',     durationMs: 1100 },
  'answer-streak':       { mood: 'love',      durationMs: 2000 },
  'answer-wrong':        { mood: 'thinking',  durationMs: 900 },
  'answer-frustrated':   { mood: 'angry',     durationMs: 1500 },
  'long-session':        { mood: 'love',      durationMs: 2400 },
  'shared':              { mood: 'love',      durationMs: 2400 },
  'rated-up':            { mood: 'love',      durationMs: 2200 },
};

/**
 * 凌晨 sleeping 判定（22:00 - 5:59）
 */
function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

/**
 * useOctoMood —— 单一真相源
 */
export function useOctoMood(options: UseOctoMoodOptions = {}): UseOctoMoodResult {
  const { ctx = 'idle', hour, enableNightMode = true } = options;

  const [reactionMood, setReactionMood] = React.useState<OctoMoodKey | null>(null);
  const reactionTimerRef = React.useRef<number | null>(null);

  // 触发短暂 mood，N ms 后清除
  const react = React.useCallback((reaction: OctoReaction) => {
    const config = REACTION_TO_MOOD[reaction];
    if (!config) return;

    // 清掉上一次未结束的反应
    if (reactionTimerRef.current !== null) {
      window.clearTimeout(reactionTimerRef.current);
    }

    setReactionMood(config.mood);
    reactionTimerRef.current = window.setTimeout(() => {
      setReactionMood(null);
      reactionTimerRef.current = null;
    }, config.durationMs);
  }, []);

  // 卸载时清理 timer
  React.useEffect(() => {
    return () => {
      if (reactionTimerRef.current !== null) {
        window.clearTimeout(reactionTimerRef.current);
      }
    };
  }, []);

  // 计算最终 mood
  const mood = React.useMemo<OctoMoodKey>(() => {
    // 1. 短暂 mood 优先（学生刚做了什么 > 当前情境）
    if (reactionMood) return reactionMood;

    // 2. 凌晨 sleeping override（除非正在录课/复习——不能在学生做事时打瞌睡）
    const activeCtx = ctx === 'recording' || ctx === 'reviewing';
    if (enableNightMode && !activeCtx) {
      const h = hour ?? new Date().getHours();
      if (isNightHour(h)) return 'sleeping';
    }

    // 3. 默认按 context 映射
    return CTX_TO_MOOD[ctx];
  }, [reactionMood, ctx, hour, enableNightMode]);

  return {
    mood,
    react,
    reacting: reactionMood !== null,
  };
}
