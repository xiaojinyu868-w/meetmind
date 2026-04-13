'use client';

/**
 * useClassCheck — 随堂检验控制器（简化版）
 *
 * 工作流：
 * 1. 开关开启 + 进入复习页时，调用 /api/class-check/plan
 * 2. LLM 一次性返回 checkpoints（含题目）+ highlights
 * 3. highlights 通过 onHighlightsReady 回调填充到 VideoInsightTimeline
 * 4. 播放时追踪进度，到达 checkpoint 时暂停，直接弹已有题目
 * 5. 跳过的 checkpoint 标记为 skipped，不出题
 *
 * 没有第二次 API 调用，没有反馈机制，干净简单。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreference } from '@/lib/db/preferences';
import type { TranscriptSegment } from '@/types';
import type { ClassCheckQuestion, ClassCheckResult } from '@/components/ClassCheckOverlay';
import type { ClassCheckPlan, ClassCheckCheckpoint, ClassCheckHighlight } from '@/app/api/class-check/plan/route';

const CLASS_CHECK_ENABLED_KEY = 'settings_class_check_enabled';
const SEEK_THRESHOLD_MS = 5000;
/** seek 后保留 checkpoint 的宽容区间：如果 triggerMs 在 [seekTarget - GRACE, seekTarget + GRACE] 内，不 skip */
const CHECKPOINT_GRACE_MS = 8000;
const PLAN_CACHE_PREFIX = 'class-check-plan:';
const PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

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
  const [pendingCheckpointIdx, setPendingCheckpointIdx] = useState(-1);

  const prevTimeRef = useRef(0);
  const activeCheckpointIndexRef = useRef(-1);
  const triggerLockRef = useRef(false);
  const planSessionRef = useRef('');

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

  // 会话切换或转录变化时请求 plan（一次性拿到所有题目 + 高光片段）
  // Plan 请求不受 enabled 开关控制——高光片段和检查点标记始终展示。
  // enabled 开关只控制播放时是否自动弹出测验题。
  useEffect(() => {
    if (dataSource !== 'video' && dataSource !== 'live') {
      console.log('[class-check] dataSource=%s, need video|live, skipping plan', dataSource);
      return;
    }
    if (segments.length < 6) {
      console.log('[class-check] segments=%d < 6, skipping plan', segments.length);
      return;
    }

    const planKey = `${sessionId}:${segments.length}`;
    if (planSessionRef.current === planKey) return;
    planSessionRef.current = planKey;

    // 先检查 localStorage 缓存
    const cached = readCachedPlan(sessionId, segments.length);
    if (cached) {
      console.log('[class-check] plan loaded from cache, sessionId=%s, %d checkpoints, %d highlights',
        sessionId, cached.checkpoints.length, cached.highlights?.length || 0);
      setPlan(cached);
      setCheckpointStatuses(cached.checkpoints.map(() => 'pending'));
      if (cached.highlights && cached.highlights.length > 0 && onHighlightsReady) {
        onHighlightsReady(cached.highlights);
      }
      setIsPlanLoading(false);
      return;
    }

    console.log('[class-check] requesting plan, sessionId=%s, segments=%d', sessionId, segments.length);

    setIsPlanLoading(true);
    setPlan(null);
    setRounds([]);
    setCheckpointStatuses([]);
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
          body: JSON.stringify({
            transcript: segments.map((s) => ({
              id: s.id,
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
            })),
          }),
        });
        const data = await response.json() as { ok?: boolean; plan?: ClassCheckPlan; error?: string };
        if (data.ok && data.plan) {
          console.log('[class-check] plan received: %d checkpoints (with questions), %d highlights',
            data.plan.checkpoints.length, data.plan.highlights?.length || 0);
          data.plan.checkpoints.forEach((cp, i) => {
            console.log('[class-check]   checkpoint %d: "%s" at %dms, %d questions',
              i, cp.topic, cp.triggerMs, cp.questions.length);
          });
          setPlan(data.plan);
          setCheckpointStatuses(data.plan.checkpoints.map(() => 'pending'));
          writeCachedPlan(sessionId, segments.length, data.plan);
          if (data.plan.highlights && data.plan.highlights.length > 0 && onHighlightsReady) {
            onHighlightsReady(data.plan.highlights);
          }
        } else {
          console.warn('[class-check] plan API failed:', data.error || 'unknown');
        }
      } catch (err) {
        console.warn('[class-check] plan API error:', err);
      } finally {
        setIsPlanLoading(false);
      }
    })();
  }, [sessionId, segments.length, dataSource, segments]);

  // 核心：播放进度推进时检查 checkpoint
  // 到达 checkpoint 时不暂停、不弹题，而是设置 pendingCheckpoint 触发邀请 toast。
  // 用户主动选择后才进入答题流程。
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
      // Seek detected — only skip checkpoints that were truly "jumped over":
      // those whose triggerMs is well before the seek target (beyond the grace zone).
      // Checkpoints near the landing point are preserved so normal playback can trigger them.
      setCheckpointStatuses((prev) => {
        const next = [...prev];
        for (let i = 0; i < plan.checkpoints.length; i++) {
          if (next[i] !== 'pending') continue;
          const triggerMs = plan.checkpoints[i].triggerMs;
          // Only skip if triggerMs is far below the seek target (outside grace zone)
          if (triggerMs < currentTimeMs - CHECKPOINT_GRACE_MS) {
            next[i] = 'skipped';
          }
        }
        return next;
      });
      // Don't return — fall through to check if a checkpoint is now reachable
    }

    // 找到下一个应该触发的 checkpoint
    const nextIdx = checkpointStatuses.findIndex(
      (status, i) => status === 'pending' && plan.checkpoints[i].triggerMs <= currentTimeMs
    );

    if (nextIdx < 0) return;

    // 到达触发点 → 直接暂停 + 弹题
    const checkpoint = plan.checkpoints[nextIdx];
    if (!checkpoint || checkpoint.questions.length === 0) return;

    console.log('[class-check] checkpoint %d "%s" reached at %dms, pausing + showing quiz',
      nextIdx, checkpoint.topic, currentTimeMs);

    triggerLockRef.current = true;
    activeCheckpointIndexRef.current = nextIdx;
    setCheckpointStatuses((prev) => {
      const next = [...prev];
      next[nextIdx] = 'active';
      return next;
    });

    pausePlayer();

    const questions: ClassCheckQuestion[] = checkpoint.questions.map((q, i) => ({
      id: `cc-${nextIdx}-${i}`,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation || undefined,
    }));

    setCurrentQuestions(questions);
    setCurrentGreeting(checkpoint.greeting);
    setCurrentEncouragement(checkpoint.encouragement);
    setCurrentTopic(checkpoint.topic);
    const nextCp = plan.checkpoints[nextIdx + 1];
    setCurrentNextPreview(nextCp ? `接下来：${nextCp.topic}` : '');
    setIsCheckActive(true);
    triggerLockRef.current = false;
  }, [currentTimeMs, enabled, isPlaying, isCheckActive, plan, checkpointStatuses]);

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

    const checkpoint = plan.checkpoints[pendingCheckpointIdx];
    if (!checkpoint || checkpoint.questions.length === 0) {
      // 没有题目，直接清除
      setPendingCheckpointIdx(-1);
      return;
    }

    console.log('[class-check] user accepted checkpoint %d "%s"', pendingCheckpointIdx, checkpoint.topic);

    triggerLockRef.current = true;
    activeCheckpointIndexRef.current = pendingCheckpointIdx;
    setCheckpointStatuses((prev) => {
      const next = [...prev];
      next[pendingCheckpointIdx] = 'active';
      return next;
    });

    pausePlayer();

    const questions: ClassCheckQuestion[] = checkpoint.questions.map((q, i) => ({
      id: `cc-${pendingCheckpointIdx}-${i}`,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      explanation: q.explanation || undefined,
    }));

    setCurrentQuestions(questions);
    setCurrentGreeting(checkpoint.greeting);
    setCurrentEncouragement(checkpoint.encouragement);
    setCurrentTopic(checkpoint.topic);
    const nextCp = plan.checkpoints[pendingCheckpointIdx + 1];
    setCurrentNextPreview(nextCp ? `接下来：${nextCp.topic}` : '');
    setIsCheckActive(true);
    triggerLockRef.current = false;
    setPendingCheckpointIdx(-1);
  }, [pendingCheckpointIdx, plan, pausePlayer]);

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
      if (!checkpoint || checkpoint.questions.length === 0) return;
      const status = checkpointStatuses[checkpointIndex];
      if (status === 'completed' || status === 'active') return;

      triggerLockRef.current = true;
      activeCheckpointIndexRef.current = checkpointIndex;

      // 重置 prevTimeRef 为当前时间，避免恢复播放后被误判为 seek/跳转
      prevTimeRef.current = currentTimeMs;

      setCheckpointStatuses((prev) => {
        const next = [...prev];
        next[checkpointIndex] = 'active';
        return next;
      });

      pausePlayer();

      const questions: ClassCheckQuestion[] = checkpoint.questions.map((q, i) => ({
        id: `cc-${checkpointIndex}-${i}`,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation || undefined,
      }));

      setCurrentQuestions(questions);
      setCurrentGreeting(checkpoint.greeting);
      setCurrentEncouragement(checkpoint.encouragement);
      setCurrentTopic(checkpoint.topic);
      const nextCp = plan.checkpoints[checkpointIndex + 1];
      setCurrentNextPreview(nextCp ? `接下来：${nextCp.topic}` : '');
      setIsCheckActive(true);
      triggerLockRef.current = false;
    },
    [checkpointStatuses, currentTimeMs, enabled, isCheckActive, plan, pausePlayer]
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
    handleCheckComplete,
    triggerCheckpointManually,
    pendingCheckpointIdx,
    pendingCheckpoint,
    acceptPendingCheckpoint,
    dismissPendingCheckpoint,
  };
}

export default useClassCheck;
