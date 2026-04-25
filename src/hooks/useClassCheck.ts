'use client';

/**
 * useClassCheck — 随堂检验控制器（v2 分阶段加载版）
 *
 * 工作流：
 * 1. 开关开启 + 进入复习页时，调用 /api/class-check/plan（轻量，15-30s）
 * 2. plan 返回后：
 *    - highlights 立刻通过 onHighlightsReady 填到时间轴
 *    - checkpoints 骨架立刻可见（带题目状态 ready/loading/failed）
 *    - 并发调用 /api/class-check/question 为每个 checkpoint 生成题目
 * 3. 播放时追踪进度，到达 checkpoint 时：
 *    - 题目已就绪 → 立刻弹
 *    - 题目仍在加载 → 等 promise 解决后再弹（通常已完成）
 * 4. 单个 checkpoint 题目失败不影响其他 checkpoint
 *
 * 相比 v1：
 * - 单次 LLM 输出 tokens 从 ~8000 降到 ~1500（骨架）+ 每题 ~800
 * - 首屏延迟从 60-180s 降到 15-30s
 * - 504 概率接近 0，单点失败不影响整体
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreference } from '@/lib/db/preferences';
import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestion, ClassCheckResult } from '@/components/ClassCheckOverlay';
import type {
  ClassCheckPlan,
  ClassCheckCheckpoint,
  ClassCheckHighlight,
  ClassCheckQuestionData,
} from '@/app/api/class-check/plan/route';

const CLASS_CHECK_ENABLED_KEY = 'settings_class_check_enabled';
const SEEK_THRESHOLD_MS = 5000;
/** seek 后保留 checkpoint 的宽容区间：如果 triggerMs 在 [seekTarget - GRACE, seekTarget + GRACE] 内，不 skip */
const CHECKPOINT_GRACE_MS = 8000;
const PLAN_CACHE_PREFIX = 'class-check-plan:';
const PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时
const QUESTION_CONCURRENCY = 3; // 并发生成题目的最大并发度

/** 题目加载状态 */
export type CheckpointQuestionState = 'loading' | 'ready' | 'failed';

function readCachedPlan(sessionId: string, segmentCount: number): ClassCheckPlan | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${PLAN_CACHE_PREFIX}${sessionId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { plan: ClassCheckPlan; segmentCount: number; ts: number };
    if (!cached.plan || cached.segmentCount !== segmentCount) return null;
    if (Date.now() - cached.ts > PLAN_CACHE_TTL_MS) return null;
    return cached.plan;
  } catch { return null; }
}

function writeCachedPlan(sessionId: string, segmentCount: number, plan: ClassCheckPlan): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${PLAN_CACHE_PREFIX}${sessionId}`, JSON.stringify({
      plan, segmentCount, ts: Date.now(),
    }));
  } catch { /* quota exceeded — ignore */ }
}

export interface ClassCheckRound {
  roundIndex: number;
  checkpointIndex: number;
  result: ClassCheckResult;
}

type CheckpointStatus = 'pending' | 'active' | 'completed' | 'skipped';

interface UseClassCheckParams {
  currentTimeMs: number;
  isPlaying: boolean;
  segments: TranscriptSegment[];
  sessionId: string;
  dataSource: string;
  pausePlayer: () => void;
  resumePlayer: () => void;
  /** Plan 返回精选片段后的回调（用于填充高亮时间轴） */
  onHighlightsReady?: (highlights: ClassCheckHighlight[]) => void;
}

interface UseClassCheckReturn {
  enabled: boolean;
  isCheckActive: boolean;
  isLoading: boolean;
  isPlanLoading: boolean;
  currentQuestions: ClassCheckQuestion[];
  currentRoundIndex: number;
  currentGreeting: string;
  currentEncouragement: string;
  currentNextPreview: string;
  currentTopic: string;
  rounds: ClassCheckRound[];
  totalCorrect: number;
  totalQuestions: number;
  plan: ClassCheckPlan | null;
  /** 每个 checkpoint 的状态，与 plan.checkpoints 一一对应 */
  checkpointStatuses: CheckpointStatus[];
  /** 每个 checkpoint 的题目加载状态（loading/ready/failed） */
  checkpointQuestionStates: CheckpointQuestionState[];
  handleCheckComplete: (result: ClassCheckResult) => void;
  /** 手动触发某个 checkpoint 的测验（从时间轴点击） */
  triggerCheckpointManually: (checkpointIndex: number) => void;
  /** 当前待确认的 checkpoint 索引，-1 表示无 */
  pendingCheckpointIdx: number;
  /** 待确认 checkpoint 的数据（null 表示无） */
  pendingCheckpoint: ClassCheckCheckpoint | null;
  /** 用户接受 toast 邀请，暂停 + 进入答题 */
  acceptPendingCheckpoint: () => void;
  /** 用户忽略 toast，标记跳过，继续播放 */
  dismissPendingCheckpoint: () => void;
}

/** 把 checkpoint 的题目转成 Overlay 用的格式 */
function toOverlayQuestions(
  checkpointIndex: number,
  questions: ClassCheckQuestionData[]
): ClassCheckQuestion[] {
  return questions.map((q, i) => ({
    id: `cc-${checkpointIndex}-${i}`,
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation || undefined,
  }));
}

/** 调用题目生成接口，返回题目数组；失败抛错 */
async function fetchCheckpointQuestions(
  transcript: TranscriptSegment[],
  checkpoint: ClassCheckCheckpoint,
  signal: AbortSignal
): Promise<ClassCheckQuestionData[]> {
  const response = await fetch('/api/class-check/question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      transcript: transcript.map((s) => ({
        id: s.id,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
      })),
      checkpoint: {
        topic: checkpoint.topic,
        difficulty: checkpoint.difficulty,
        startMs: checkpoint.startMs,
        endMs: checkpoint.endMs,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`question API ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`question API returned non-JSON: ${contentType}`);
  }
  const data = (await response.json()) as {
    ok?: boolean;
    questions?: ClassCheckQuestionData[];
    error?: string;
  };
  if (!data.ok || !Array.isArray(data.questions) || data.questions.length === 0) {
    throw new Error(data.error || 'question API returned empty');
  }
  return data.questions;
}

export function useClassCheck({
  currentTimeMs,
  isPlaying,
  segments,
  sessionId,
  dataSource,
  pausePlayer,
  resumePlayer,
  onHighlightsReady,
}: UseClassCheckParams): UseClassCheckReturn {
  const [enabled, setEnabled] = useState(false);
  const [plan, setPlan] = useState<ClassCheckPlan | null>(null);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [isCheckActive, setIsCheckActive] = useState(false);
  const [currentQuestions, setCurrentQuestions] = useState<ClassCheckQuestion[]>([]);
  const [currentGreeting, setCurrentGreeting] = useState('');
  const [currentEncouragement, setCurrentEncouragement] = useState('');
  const [currentNextPreview, setCurrentNextPreview] = useState('');
  const [currentTopic, setCurrentTopic] = useState('');
  const [rounds, setRounds] = useState<ClassCheckRound[]>([]);
  const [checkpointStatuses, setCheckpointStatuses] = useState<CheckpointStatus[]>([]);
  const [checkpointQuestionStates, setCheckpointQuestionStates] = useState<CheckpointQuestionState[]>([]);
  const [pendingCheckpointIdx, setPendingCheckpointIdx] = useState(-1);

  const prevTimeRef = useRef(0);
  const activeCheckpointIndexRef = useRef(-1);
  const triggerLockRef = useRef(false);
  const planSessionRef = useRef('');
  /** 正在进行中的题目请求 promise（按 checkpointIndex 索引） */
  const questionPromisesRef = useRef<Array<Promise<void> | null>>([]);
  /** 当前 session 的 AbortController，用于 session 切换时取消悬挂请求 */
  const abortRef = useRef<AbortController | null>(null);
  /** 最新 segments 引用，异步回调里读最新值 */
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  segmentsRef.current = segments;

  // 加载开关 — 初始化 + 页面可见时重新读取
  useEffect(() => {
    const readEnabled = () => {
      void getPreference(CLASS_CHECK_ENABLED_KEY, false).then((val) => {
        setEnabled(val);
      });
    };
    readEnabled();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        readEnabled();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', readEnabled);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', readEnabled);
    };
  }, []);

  /**
   * 给某个 checkpoint 生成题目，结果写回 plan state + 缓存。
   * 同一 checkpoint 重复调用会复用 in-flight promise。
   */
  const ensureCheckpointQuestions = useCallback((checkpointIndex: number): Promise<void> => {
    const existing = questionPromisesRef.current[checkpointIndex];
    if (existing) return existing;

    const controller = abortRef.current;
    if (!controller) return Promise.resolve();

    const promise = (async () => {
      try {
        setCheckpointQuestionStates((prev) => {
          const next = [...prev];
          next[checkpointIndex] = 'loading';
          return next;
        });

        // 从 plan state 里读最新 checkpoint（不依赖 hook 闭包里的旧 plan）
        const snapshot = planRef.current;
        if (!snapshot) return;
        const checkpoint = snapshot.checkpoints[checkpointIndex];
        if (!checkpoint) return;
        if (checkpoint.questions.length > 0) {
          // 已有（来自缓存），直接标 ready
          setCheckpointQuestionStates((prev) => {
            const next = [...prev];
            next[checkpointIndex] = 'ready';
            return next;
          });
          return;
        }

        const questions = await fetchCheckpointQuestions(
          segmentsRef.current,
          checkpoint,
          controller.signal
        );

        // 写回 plan
        setPlan((prev) => {
          if (!prev) return prev;
          const nextCheckpoints = prev.checkpoints.map((cp, i) =>
            i === checkpointIndex ? { ...cp, questions } : cp
          );
          const nextPlan = { ...prev, checkpoints: nextCheckpoints };
          // 缓存同步更新
          writeCachedPlan(sessionId, segmentsRef.current.length, nextPlan);
          return nextPlan;
        });

        setCheckpointQuestionStates((prev) => {
          const next = [...prev];
          next[checkpointIndex] = 'ready';
          return next;
        });

        console.log('[class-check] checkpoint %d "%s" questions ready (%d)',
          checkpointIndex, checkpoint.topic, questions.length);
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        console.warn('[class-check] checkpoint %d question fetch failed:', checkpointIndex, err);
        setCheckpointQuestionStates((prev) => {
          const next = [...prev];
          next[checkpointIndex] = 'failed';
          return next;
        });
        // 失败后清掉 promise，允许重试（用户手动点击时会再试一次）
        questionPromisesRef.current[checkpointIndex] = null;
      }
    })();

    questionPromisesRef.current[checkpointIndex] = promise;
    return promise;
  }, [sessionId]);

  /** 总是指向最新的 plan，供异步回调读取，不因闭包旧值丢失题目 */
  const planRef = useRef<ClassCheckPlan | null>(null);
  planRef.current = plan;

  /** 并发预热所有 checkpoint 的题目（限流 QUESTION_CONCURRENCY） */
  const preheatAllQuestions = useCallback(async (checkpointCount: number) => {
    const queue: number[] = [];
    for (let i = 0; i < checkpointCount; i++) {
      const snapshot = planRef.current;
      if (snapshot && snapshot.checkpoints[i]?.questions.length > 0) continue; // 已就绪（缓存命中）
      queue.push(i);
    }
    if (queue.length === 0) return;

    console.log('[class-check] preheating %d checkpoints questions (concurrency=%d)',
      queue.length, QUESTION_CONCURRENCY);

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const idx = queue[cursor++];
        try {
          await ensureCheckpointQuestions(idx);
        } catch { /* 已在 ensure 内部处理 */ }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(QUESTION_CONCURRENCY, queue.length) }, () => worker())
    );
  }, [ensureCheckpointQuestions]);

  // 会话切换或转录变化时请求 plan（骨架）+ 并发预热题目
  // Plan 请求不受 enabled 开关控制——高光片段和检查点标记始终展示。
  // enabled 开关只控制播放时是否自动弹出测验题。
  useEffect(() => {
    if (dataSource !== 'video' && dataSource !== 'live') {
      // 业务正常分支，仅 dev 时打印
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[class-check] dataSource=%s, need video|live, skipping plan', dataSource);
      }
      return;
    }
    if (segments.length < 6) {
      // 业务正常分支（转录段太少不生成 plan），仅 dev 时打印
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[class-check] segments=%d < 6, skipping plan', segments.length);
      }
      return;
    }

    const planKey = `${sessionId}:${segments.length}`;
    if (planSessionRef.current === planKey) return;
    planSessionRef.current = planKey;

    // 取消旧 session 的题目请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    questionPromisesRef.current = [];

    // 初始化状态
    const applyPlan = (incomingPlan: ClassCheckPlan, fromCache: boolean) => {
      setPlan(incomingPlan);
      setCheckpointStatuses(incomingPlan.checkpoints.map(() => 'pending'));
      setCheckpointQuestionStates(
        incomingPlan.checkpoints.map((cp) => (cp.questions.length > 0 ? 'ready' : 'loading'))
      );
      if (incomingPlan.highlights && incomingPlan.highlights.length > 0 && onHighlightsReady) {
        onHighlightsReady(incomingPlan.highlights);
      }
      if (!fromCache) {
        writeCachedPlan(sessionId, segmentsRef.current.length, incomingPlan);
      }
      // 并发预热缺失的题目
      void preheatAllQuestions(incomingPlan.checkpoints.length);
    };

    // 先检查 localStorage 缓存
    const cached = readCachedPlan(sessionId, segments.length);
    if (cached) {
      console.log('[class-check] plan loaded from cache, sessionId=%s, %d checkpoints, %d highlights',
        sessionId, cached.checkpoints.length, cached.highlights?.length || 0);
      setIsPlanLoading(false);
      applyPlan(cached, true);
      return;
    }

    console.log('[class-check] requesting plan skeleton, sessionId=%s, segments=%d',
      sessionId, segments.length);

    setIsPlanLoading(true);
    setPlan(null);
    setRounds([]);
    setCheckpointStatuses([]);
    setCheckpointQuestionStates([]);
    setIsCheckActive(false);
    setCurrentQuestions([]);
    setPendingCheckpointIdx(-1);
    prevTimeRef.current = 0;
    activeCheckpointIndexRef.current = -1;
    triggerLockRef.current = false;

    void (async () => {
      try {
        const response = await fetch('/api/class-check/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            transcript: segments.map((s) => ({
              id: s.id,
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
            })),
          }),
        });
        if (!response.ok) {
          console.warn('[class-check] plan API non-OK status:', response.status, response.statusText);
          return;
        }
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          console.warn('[class-check] plan API returned non-JSON (likely gateway timeout):', contentType);
          return;
        }
        const data = await response.json() as { ok?: boolean; plan?: ClassCheckPlan; error?: string };
        if (data.ok && data.plan) {
          console.log('[class-check] plan skeleton received: %d checkpoints, %d highlights',
            data.plan.checkpoints.length, data.plan.highlights?.length || 0);
          data.plan.checkpoints.forEach((cp, i) => {
            console.log('[class-check]   checkpoint %d: "%s" at %dms', i, cp.topic, cp.triggerMs);
          });
          applyPlan(data.plan, false);
        } else {
          console.warn('[class-check] plan API failed:', data.error || 'unknown');
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        console.warn('[class-check] plan API error:', err);
      } finally {
        setIsPlanLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [sessionId, segments.length, dataSource, segments, onHighlightsReady, preheatAllQuestions]);

  /**
   * 把一个 checkpoint 的题目装到当前 overlay 状态。
   * 调用前应保证 checkpoint.questions 非空。
   */
  const enterCheckActive = useCallback((checkpointIndex: number) => {
    const snapshot = planRef.current;
    if (!snapshot) return;
    const checkpoint = snapshot.checkpoints[checkpointIndex];
    if (!checkpoint || checkpoint.questions.length === 0) return;

    triggerLockRef.current = true;
    activeCheckpointIndexRef.current = checkpointIndex;
    setCheckpointStatuses((prev) => {
      const next = [...prev];
      next[checkpointIndex] = 'active';
      return next;
    });

    pausePlayer();

    setCurrentQuestions(toOverlayQuestions(checkpointIndex, checkpoint.questions));
    setCurrentGreeting(checkpoint.greeting);
    setCurrentEncouragement(checkpoint.encouragement);
    setCurrentTopic(checkpoint.topic);
    const nextCp = snapshot.checkpoints[checkpointIndex + 1];
    setCurrentNextPreview(nextCp ? `接下来：${nextCp.topic}` : '');
    setIsCheckActive(true);
    triggerLockRef.current = false;
  }, [pausePlayer]);

  // 核心：播放进度推进时检查 checkpoint
  useEffect(() => {
    if (!enabled || !isPlaying || isCheckActive || triggerLockRef.current) return;
    if (!plan || plan.checkpoints.length === 0) return;
    // 已有待确认的 checkpoint，不重复触发
    if (pendingCheckpointIdx >= 0) return;

    const prevTime = prevTimeRef.current;
    prevTimeRef.current = currentTimeMs;

    // 检测快进/跳进
    const delta = currentTimeMs - prevTime;
    if (prevTime > 0 && (Math.abs(delta) > SEEK_THRESHOLD_MS || delta < -1000)) {
      setCheckpointStatuses((prev) => {
        const next = [...prev];
        for (let i = 0; i < plan.checkpoints.length; i++) {
          if (next[i] !== 'pending') continue;
          const triggerMs = plan.checkpoints[i].triggerMs;
          if (triggerMs < currentTimeMs - CHECKPOINT_GRACE_MS) {
            next[i] = 'skipped';
          }
        }
        return next;
      });
    }

    // 找到下一个应该触发的 checkpoint
    const nextIdx = checkpointStatuses.findIndex(
      (status, i) => status === 'pending' && plan.checkpoints[i].triggerMs <= currentTimeMs
    );

    if (nextIdx < 0) return;

    const checkpoint = plan.checkpoints[nextIdx];
    if (!checkpoint) return;

    // 题目尚未就绪 —— 等一下，通常预热已完成
    if (checkpoint.questions.length === 0) {
      console.log('[class-check] checkpoint %d reached but questions not ready, waiting...', nextIdx);
      triggerLockRef.current = true;
      void (async () => {
        try {
          await ensureCheckpointQuestions(nextIdx);
        } finally {
          triggerLockRef.current = false;
        }
        // 等待完成后，如果题目到位且本轮尚未被其他路径消费，主动进入答题
        const snapshot = planRef.current;
        const cp = snapshot?.checkpoints[nextIdx];
        if (cp && cp.questions.length > 0 && !isCheckActive &&
            checkpointStatuses[nextIdx] === 'pending') {
          enterCheckActive(nextIdx);
        }
      })();
      return;
    }

    // 到达触发点 → 直接暂停 + 弹题
    console.log('[class-check] checkpoint %d "%s" reached at %dms, pausing + showing quiz',
      nextIdx, checkpoint.topic, currentTimeMs);

    enterCheckActive(nextIdx);
  }, [currentTimeMs, enabled, isPlaying, isCheckActive, plan, checkpointStatuses, pendingCheckpointIdx, ensureCheckpointQuestions, enterCheckActive]);

  const handleCheckComplete = useCallback(
    (result: ClassCheckResult) => {
      const cpIdx = activeCheckpointIndexRef.current;
      setRounds((prev) => [...prev, {
        roundIndex: prev.length,
        checkpointIndex: cpIdx,
        result,
      }]);
      setCheckpointStatuses((prev) => {
        const next = [...prev];
        if (cpIdx >= 0) next[cpIdx] = 'completed';
        return next;
      });
      setIsCheckActive(false);
      setCurrentQuestions([]);
      activeCheckpointIndexRef.current = -1;
      triggerLockRef.current = false;
      // 重置 prevTimeRef，避免恢复播放后第一次 timeUpdate 被误判为 seek
      prevTimeRef.current = currentTimeMs;
      resumePlayer();
    },
    [currentTimeMs, resumePlayer]
  );

  // 用户接受 toast 邀请 → 暂停播放、加载题目、进入答题
  const acceptPendingCheckpoint = useCallback(() => {
    if (pendingCheckpointIdx < 0 || !plan) return;

    const idx = pendingCheckpointIdx;
    const checkpoint = plan.checkpoints[idx];
    if (!checkpoint) {
      setPendingCheckpointIdx(-1);
      return;
    }

    console.log('[class-check] user accepted checkpoint %d "%s"', idx, checkpoint.topic);

    if (checkpoint.questions.length === 0) {
      // 题目还没好，等一下再进入
      setPendingCheckpointIdx(-1);
      void (async () => {
        try {
          await ensureCheckpointQuestions(idx);
        } catch { /* already logged */ }
        const snapshot = planRef.current;
        if (snapshot?.checkpoints[idx]?.questions.length) {
          enterCheckActive(idx);
        }
      })();
      return;
    }

    enterCheckActive(idx);
    setPendingCheckpointIdx(-1);
  }, [pendingCheckpointIdx, plan, ensureCheckpointQuestions, enterCheckActive]);

  // 用户忽略 toast → 标记为 skipped，清除 pending
  const dismissPendingCheckpoint = useCallback(() => {
    if (pendingCheckpointIdx < 0) return;

    console.log('[class-check] user dismissed checkpoint %d', pendingCheckpointIdx);

    setCheckpointStatuses((prev) => {
      const next = [...prev];
      next[pendingCheckpointIdx] = 'skipped';
      return next;
    });
    setPendingCheckpointIdx(-1);
  }, [pendingCheckpointIdx]);

  // 手动触发某个 checkpoint（从时间轴 UI 点击）
  const triggerCheckpointManually = useCallback(
    (checkpointIndex: number) => {
      if (!plan || !enabled) return;
      if (isCheckActive || triggerLockRef.current) return;
      const checkpoint = plan.checkpoints[checkpointIndex];
      if (!checkpoint) return;
      const status = checkpointStatuses[checkpointIndex];
      if (status === 'completed' || status === 'active') return;

      // 重置 prevTimeRef 为当前时间，避免恢复播放后被误判为 seek/跳转
      prevTimeRef.current = currentTimeMs;

      if (checkpoint.questions.length === 0) {
        // 题目还没好，先尝试生成再进入；失败就放弃
        void (async () => {
          try {
            await ensureCheckpointQuestions(checkpointIndex);
          } catch { /* already logged */ }
          const snapshot = planRef.current;
          if (snapshot?.checkpoints[checkpointIndex]?.questions.length) {
            enterCheckActive(checkpointIndex);
          }
        })();
        return;
      }

      enterCheckActive(checkpointIndex);
    },
    [checkpointStatuses, currentTimeMs, enabled, isCheckActive, plan, ensureCheckpointQuestions, enterCheckActive]
  );

  const totalCorrect = rounds.reduce((sum, r) => sum + r.result.correctCount, 0);
  const totalQuestions = rounds.reduce((sum, r) => sum + r.result.totalCount, 0);

  const pendingCheckpoint: ClassCheckCheckpoint | null =
    pendingCheckpointIdx >= 0 && plan ? (plan.checkpoints[pendingCheckpointIdx] ?? null) : null;

  return {
    enabled,
    isCheckActive,
    isLoading: false, // 不再有出题加载态
    isPlanLoading,
    currentQuestions,
    currentRoundIndex: rounds.length,
    currentGreeting,
    currentEncouragement,
    currentNextPreview,
    currentTopic,
    rounds,
    totalCorrect,
    totalQuestions,
    plan,
    checkpointStatuses,
    checkpointQuestionStates,
    handleCheckComplete,
    triggerCheckpointManually,
    pendingCheckpointIdx,
    pendingCheckpoint,
    acceptPendingCheckpoint,
    dismissPendingCheckpoint,
  };
}

export default useClassCheck;
