/**
 * useClassroomCompanion — 课堂 AI 同桌对话 hook
 *
 * 职责：
 *   - 维护对话 messages 列表（包括"第一面"开场白）
 *   - 接 /api/tutor 流式调用（复用 useSimpleSSEStream）
 *   - 流式追加 streamingContent 到"正在说话"的 AI 消息
 *   - 错误降级（不崩，给一句克制的错误消息）
 *
 * Taste 约束：
 *   - 不打断。失败也不弹 toast，把失败揉进一句 AI 的话里。
 *   - 不追问。AI 说完就停，不主动下一句。
 *   - 不装忙。思考中的呈现是"…"三个点在慢慢浮现，不是"AI 正在思考"的 loading 文字。
 *
 * 请求模式：
 *   globalMode: true （整节课对话），课堂场景先这样——
 *   即使还在录课，也是"对这整节课的疑问"，不是困惑点模式。
 *   未来可以根据 paneState 切换 globalMode 或困惑点 timestamp。
 */

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
// M10：classroom 同桌切到 /api/tutor/agent（统一 AI 对话后端）。
import { fetchUIMessageStream } from '@/lib/hooks/fetchUIMessageStream';
import { useAuth } from '@/lib/hooks/useAuth';
import { formatLearnerProfileForTutorAgent } from '@/components/tutor/tutor-agent-adapter';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { getPreference, setPreference } from '@/lib/db';
import { composeFirstHello } from '@/components/classroom/composeFirstHello';
import type { TranscriptSegment } from '@/types';
import type { CompanionMessage, Lesson } from '@/components/classroom/types';
import type { InlineAppInteraction } from '@/components/classroom/InlineAppCard';

/** 最多保留多少条历史（防止无限膨胀） */
const MAX_PERSISTED_MESSAGES = 50;

export interface UseClassroomCompanionReturn {
  messages: CompanionMessage[];
  /** 流式追加中的 AI 消息（还未 commit 进 messages）。null 表示没在流。 */
  streamingMessage: CompanionMessage | null;
  /** 是否正在等待 AI 回复（含 thinking 和 content 阶段） */
  isThinking: boolean;
  /** 发送用户消息，触发 /api/tutor 流式调用 */
  send: (text: string) => Promise<void>;
  /** 停止当前流式请求 */
  stop: () => void;
  /** 同桌切到 listening 态时调用；存在感由面板状态和可点问题表达，不再追加寒暄消息。 */
  markListening: () => void;
  /** inline 模式：用户在错误态的内联卡片里点"再试一次" */
  retryInlineApp: (messageId: string) => void;
  /** inline 模式：用户在内联卡片里答题/翻闪卡时，由此抛事件给 hook 处理 */
  handleInlineAppInteraction: (messageId: string, event: InlineAppInteraction) => void;
  /** 与当前课中请求同源的上下文快照，仅供管理员现场透镜。 */
  adminInspector: {
    context: Record<string, unknown>;
    options: Record<string, unknown>;
    query: string;
  };
}

export interface UseClassroomCompanionInput {
  /** 课堂列表——用于生成动态开场白。传 undefined 则用默认静态问候。 */
  lessons?: Lesson[];
  /** 是否正在录课——影响开场白选择（录课时不说废话） */
  isRecording?: boolean;
  /**
   * 同学回复里如果带 <open_app:KEY/> 标记，最终 commit 前会调这个 callback。
   * 典型实现：useWorkshopWindows().openWorkshopWindow(key)。
   * 仅在 inlineAppMode=false 时生效——inline 模式下不开窗口，产物内联。
   */
  onOpenApp?: (appKey: WorkshopAppKey) => void;
  /**
   * inline 模式（默认 true）：同学回复里的 <open_app:KEY/> 不会开 WorkshopWindow，
   * 而是追加一条带 inlineApp={status:'loading'} 的气泡，调 /api/apps/execute
   * 拿到结果后把气泡升级为 {status:'ready', result}，直接复用应用矩阵 UI。
   * 关掉的话走旧版"开窗口"行为——留给未来的复习态弹窗通道用。
   */
  inlineAppMode?: boolean;
}

// extractOpenAppMarker 已统一到 @/lib/utils/open-app-marker，见下方 import。
// M14.6：prompt 不再注入 <open_app:KEY/> 合约，此解析仅作防御性清洗保留。

/**
 * 把 TranscriptSegment[] 折叠成 tutor 接口需要的 segments 数组。
 */
function toTutorSegments(segs: TranscriptSegment[]): Array<{
  id?: string | number;
  text: string;
  startMs: number;
  endMs: number;
}> {
  return segs.map((s, i) => ({
    id: s.id ?? i,
    text: s.text,
    startMs: s.startMs,
    endMs: s.endMs,
  }));
}

// M8-D3: extractRecentFocus 提取到 @/lib/services/classroom/recent-focus
// 以便 node 测试环境直接单测，不需要 mock React/hooks。
import { extractRecentFocus } from '@/lib/services/classroom/recent-focus';
// 课中不提供时间回跳；模型若意外返回 [MM:SS]，提交消息前防御性清理。
import { normalizeCompanionMarkdown } from '@/components/classroom/companion-markdown-utils';
// Agent-native chip parity：AI 消息里如果带 <open_app:KEY/>，用下面的 guard
// 校验 KEY 是注册过的合法 appKey，再调 onOpenApp；非法 KEY 就忽略。
import { getWorkshopAppByKey, isWorkshopAppKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
// M8 Phase 4: 停止录音时仪式感文案从文案中心读
import { COPY } from '@/lib/ui/copy';
import { getCompanionMessagesPreferenceKey } from '@/lib/utils/classroom-companion-storage';
import {
  getInlineAppRetryDelayMs,
  INLINE_APP_MAX_ATTEMPTS,
  shouldRetryInlineAppExecute,
} from '@/lib/utils/inline-app-retry';
import { parsePointsBlock, describePointsBlock } from '@/hooks/points-guard';
import { openPaywallGlobal } from '@/hooks/usePaywall';
import { notifyPointsChanged } from '@/hooks/usePointsSummary';
import {
  buildQuestionWithQuizContext,
  upsertQuizAttempt,
  type CompanionQuizAttempt,
} from '@/lib/utils/companion-quiz-memory';
import {
  hasEnoughInlineAppTranscript,
  selectInlineAppTranscript,
} from '@/lib/utils/inline-app-transcript';
import { buildInlineAppFallbackResult } from '@/lib/utils/inline-app-fallback';
import {
  AI_MODEL_AUTO_VALUE,
  AI_MODEL_PREFERENCE_KEY,
  resolveExplicitAiModelPreference,
} from '@/lib/utils/ai-model-preference';
import { buildInClassTutorAgentBody } from '@/lib/tutor/classroom-agent-request';
import { extractOpenAppMarker, isInClassBlockedInlineAppKey } from '@/lib/utils/open-app-marker';

/** 把长句子截成省略号版，塞进"再讲讲那道 xxx..."的追问气泡里 */
function truncate(s: string, n: number): string {
  const v = (s || '').trim();
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useClassroomCompanion(
  input: UseClassroomCompanionInput = {},
): UseClassroomCompanionReturn {
  const { lessons, isRecording = false, onOpenApp, inlineAppMode = true } = input;

  const { user, accessToken } = useAuth();
  const sessionId = useSessionStore((s) => s.sessionId);
  const companionMessagesKey = getCompanionMessagesPreferenceKey(sessionId);
  const segments = useCaptureEditorStore((s) => s.segments);

  const [preferredModel, setPreferredModel] = useState<string | undefined>();
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<CompanionMessage | null>(null);
  // messages 的 ref 镜像——inline app 的 retry/interaction 回调需要读到最新值，
  // 但又不能把 messages 放进那些 callback 的依赖里（否则回调身份每次 render 都变）。
  const messagesRef = useRef<CompanionMessage[]>([]);
  const quizAttemptsRef = useRef<CompanionQuizAttempt[]>([]);
  const latestSupportMaterialsRef = useRef<Array<{ title: string; content: string }> | undefined>();
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // M10：直接管 abort/isStreaming/isThinking，不再依赖 useSimpleSSEStream 的 SSE 协议。
  // 课堂同桌现在读的是 /api/tutor/agent 的 UIMessage stream（AI SDK v6 帧格式）。
  const abortRef = useRef<AbortController | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  // "正在思考"=发起请求后、第一条 text-delta 到达前。到达后就是"正在说话"。
  const [sseThinking, setSseThinking] = useState(false);
  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setSseThinking(false);
  }, []);

  useEffect(() => {
    let alive = true;
    getPreference<string>(AI_MODEL_PREFERENCE_KEY, AI_MODEL_AUTO_VALUE)
      .then((preference) => {
        if (alive) setPreferredModel(resolveExplicitAiModelPreference(preference));
      })
      .catch(() => {
        if (alive) setPreferredModel(undefined);
      });
    return () => { alive = false; };
  }, []);

  // 防抖：开场白只注入一次（lessons 后续变化不再改开场白）
  const hasHelloInjectedRef = useRef(false);
  // 是否已从 preferences 水合——未水合前不写回，避免用空数组覆盖持久化的历史
  const [isHydrated, setIsHydrated] = useState(false);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 1. 启动 / 切课时从 preferences 读当前 session 的持久化消息 ──
  //   但如果本次组件挂载时就已经在录课（isRecording=true），说明是"新课开始"场景，
  //   不要把历史水合到界面上——界面保持一张白纸。
  useEffect(() => {
    let alive = true;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    setIsHydrated(false);
    setStreamingMessage(null);
    quizAttemptsRef.current = [];
    hasHelloInjectedRef.current = false;

    if (isRecording) {
      // 录课中挂载 / 切到新课：跳过历史注入，界面保持一张白纸
      setMessages([]);
      setIsHydrated(true);
      hasHelloInjectedRef.current = true;
      return () => { alive = false; };
    }

    getPreference<CompanionMessage[]>(companionMessagesKey, []).then((persisted) => {
      if (!alive) return;
      if (persisted.length > 0) {
        setMessages(persisted);
        // 既然恢复了当前课历史，就跳过开场白注入
        hasHelloInjectedRef.current = true;
      } else {
        setMessages([]);
      }
      setIsHydrated(true);
    }).catch(() => {
      if (alive) setIsHydrated(true);
    });
    return () => { alive = false; };
  }, [companionMessagesKey, isRecording]);

  // ── 2. messages 变化时 debounced 写回 preferences ──
  //   护栏：messages 为空时不覆盖当前 session 的持久化历史——新课清空的是"可见消息"。
  useEffect(() => {
    if (!isHydrated) return; // 未水合前不写
    if (messages.length === 0) return; // 空数组不写回，保护已有历史
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      // 只保留最近 MAX 条
      const trimmed = messages.length > MAX_PERSISTED_MESSAGES
        ? messages.slice(-MAX_PERSISTED_MESSAGES)
        : messages;
      void setPreference(companionMessagesKey, trimmed).catch(() => undefined);
    }, 500);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [messages, isHydrated, companionMessagesKey]);

  // ── 首次进来根据 lessons 注入动态开场白 ──
  // 等 preferences 水合 + lessons 到齐后再决定是否注入。
  // 水合后如果已有历史，hasHelloInjectedRef 已经在水合 effect 里置为 true。
  useEffect(() => {
    if (!isHydrated) return;
    if (hasHelloInjectedRef.current) return;
    if (lessons === undefined) return;
    hasHelloInjectedRef.current = true;

    const helloText = composeFirstHello({
      lessons,
      isRecording,
    });
    if (!helloText) return;

    setMessages((prev) => {
      if (prev.some((m) => m.id === 'companion-first-hello')) return prev;
      return [
        {
          id: 'companion-first-hello',
          role: 'companion',
          content: helloText,
          createdAt: Date.now(),
        },
        ...prev,
      ];
    });
  }, [lessons, isRecording, isHydrated]);

  const markListening = useCallback(() => {
    // 录课态的 header、章鱼和轻问题已经足够表达“同学在听”。
    // 不再向对话历史写入一条没有学习价值的自动寒暄。
  }, []);

  // ── 新课清爽：isRecording 从 false → true 时清空可见对话 ──
  //   过去的对话留在 preferences 里作为后续长记忆的素材，不删；
  //   但录新课时界面必须是"一张白纸"——否则用户看到还贴着上节课的对话，
  //   体验上像"AI 记混了"，违反安静和 new-session-clean 的直觉。
  const prevRecordingRef = useRef<boolean>(false);
  useEffect(() => {
    const was = prevRecordingRef.current;
    prevRecordingRef.current = isRecording;
    if (!was && isRecording) {
      // 只清内存 messages，不清 preferences
      setMessages([]);
      setStreamingMessage(null);
      quizAttemptsRef.current = [];
      // 新课不再走首次 hello 注入
      hasHelloInjectedRef.current = true;
    }
    // M8 Phase 4: 停止录音的仪式感——从 recording→idle 的瞬间同学说一句总结。
    // 只在真的录过一会儿的情况下说（segments >= 3），避免误触。
    if (was && !isRecording && segments.length >= 3) {
      const anchorCount = 0; // anchors 由 capture store 管理，此处不展示数字
      const summary = COPY.stop.summary(segments.length, anchorCount);
      const ceremony: CompanionMessage = {
        id: `ceremony-${Date.now()}`,
        role: 'companion',
        content: `${COPY.stop.heard}${summary}${COPY.stop.suggestCheatsheet}`,
        actions: [
          { label: COPY.stop.actionMakeCheatsheet, kind: 'open_app', payload: 'cheatsheet' },
          { label: COPY.stop.actionViewTranscript, kind: 'focus_transcript' },
        ],
        createdAt: Date.now(),
      };
      setMessages((prev) => {
        // 防重复：同一会话只插一次
        if (prev.some((m) => m.id.startsWith('ceremony-'))) return prev;
        return [...prev, ceremony];
      });
    }
  }, [isRecording, segments]);

  /**
   * 把转录 segments 精简到插件接口需要的最小字段集，减小 POST 体积。
   * 和 useAppExecution 的 slimTranscript 作用一致，但我们故意不从那里 import——
   * 避免因为 @/components/apps/... 带进大串 react/UI 依赖。
   */
  const slimTranscriptForApp = useCallback(
    (segs: TranscriptSegment[]): Array<Pick<TranscriptSegment, 'id' | 'text' | 'startMs' | 'endMs'>> => {
      return segs.map((s) => ({
        id: s.id,
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
      }));
    },
    [],
  );

  /**
   * 根据 WorkshopAppKey 异步调 /api/apps/execute，完整 AppExecutionResult 写进对应 message。
   * 不开任何窗口，直接用应用矩阵 UI 嵌进对话流。
   *
   * 生命周期：
   *   1. 立即 push 一条 "companion" 消息，inlineApp = {status:'loading'}
   *   2. 背后 fetch，拿到结果 → updateMessage 改成 {status:'ready', result}
   *   3. 失败 → {status:'error', error}
   *   4. 如果 segments 不够（tutor 要求 >=2 段 + >=50 字），返回 error
   *
   * 本函数暴露给外层重试使用：retryInlineApp(messageId) 会拿着同一个 appKey 再跑一次。
   */
  const runInlineAppForMessage = useCallback(
    async (
      messageId: string,
      appKey: NonNullable<CompanionMessage['inlineApp']>['appKey'],
    ): Promise<void> => {
      const latestSegments = useCaptureEditorStore.getState().segments;
      const appSegments = selectInlineAppTranscript(segments, latestSegments);
      if (!hasEnoughInlineAppTranscript(appSegments)) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  inlineApp: {
                    appKey,
                    status: 'error' as const,
                    error: '课堂内容还不够——再录久一点再来。',
                  },
                }
              : m,
          ),
        );
        return;
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

      const appCatalogItem = getWorkshopAppByKey(appKey);
      const body = {
        appKey,
        ...(preferredModel ? { model: preferredModel } : {}),
        goal: {
          intent: appCatalogItem?.intent || `生成${appKey}学习应用`,
          expectedOutput: 'mixed' as const,
          appKey,
        },
        input: {
          sessionId: sessionId || 'inline-classroom',
          dataSource: 'live' as const,
          transcript: slimTranscriptForApp(appSegments),
          anchors: [],
        },
        memory: {},
      };

      let lastError = '生成失败';
      for (let attempt = 1; attempt <= INLINE_APP_MAX_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch('/api/apps/execute', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          const data = (await response.json().catch(() => null)) as
            | { ok?: boolean; error?: string; result?: import('@/lib/ai-native/types').AppExecutionResult }
            | null;

          if (response.ok && data?.ok && data.result) {
            const result = data.result;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? { ...m, inlineApp: { appKey, status: 'ready' as const, result, payload: result.render?.payload } }
                  : m,
              ),
            );
            // 应用生成会扣积分，让头部 chip / 设置页静默刷新余额
            notifyPointsChanged();
            return;
          }

          // 402 积分拦截：余额不足 / 本月成本到顶。不重试，气泡给一句
          // 安静的说明（含当前余额与下月发放），并刷新余额展示。
          const pointsBlock = parsePointsBlock(response.status, data);
          if (pointsBlock) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? { ...m, inlineApp: { appKey, status: 'error' as const, error: describePointsBlock(pointsBlock) } }
                  : m,
              ),
            );
            notifyPointsChanged();
            // 高意向截断：余额不足（登录用户）同步唤起付费页；会员闸门弹会员 Tab；guest 限额/月熔断不弹
            if (pointsBlock.kind === 'insufficient_points') {
              openPaywallGlobal({ reason: 'insufficient_points', balance: pointsBlock.balance, required: pointsBlock.required });
            } else if (pointsBlock.kind === 'membership_required') {
              openPaywallGlobal({ reason: 'membership_required', requiredTier: pointsBlock.requiredTier });
            }
            return;
          }

          // 服务端诚实空态（材料不足/内容不适合）：不能用原文伪造一套假产物——
          // 那直接违反「有根」。把气泡置为安静的失败态，告诉学生真实原因。
          if (data?.error === 'CONTENT_NOT_READY' || data?.error === 'APP_NOT_SUITABLE') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId
                  ? { ...m, inlineApp: { appKey, status: 'error' as const, error: data.error } }
                  : m,
              ),
            );
            return;
          }

          lastError = data?.error || '生成失败';
          if (!shouldRetryInlineAppExecute({ status: response.status, attempt })) break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : '网络有点问题';
          if (!shouldRetryInlineAppExecute({ status: null, attempt })) break;
        }

        await wait(getInlineAppRetryDelayMs(attempt));
      }

      const fallbackResult = buildInlineAppFallbackResult(appKey, appSegments);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? fallbackResult
              ? {
                  ...m,
                  inlineApp: { appKey, status: 'ready' as const, result: fallbackResult, payload: fallbackResult.render?.payload },
                }
              : { ...m, inlineApp: { appKey, status: 'error' as const, error: lastError } }
            : m,
        ),
      );
    },
    [accessToken, segments, sessionId, slimTranscriptForApp],
  );

  /**
   * 同学在会话里说了"好我给你整一张"之后，追加一条带 inlineApp loading
   * 气泡的 AI 消息（content 为空，只渲染 inline card），随后 run 插件生成。
   */
  const triggerInlineAppGeneration = useCallback(
    (appKey: NonNullable<CompanionMessage['inlineApp']>['appKey']) => {
      const messageId = `inline-${appKey}-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          role: 'companion',
          content: '',
          inlineApp: { appKey, status: 'loading' },
          createdAt: Date.now(),
        },
      ]);
      void runInlineAppForMessage(messageId, appKey);
    },
    [runInlineAppForMessage],
  );

  /**
   * 外部调用：用户在错误态的内联卡片里点"再试一次"。
   * 找到原 message 的 appKey，把状态打回 loading，再 run 一次。
   */
  const retryInlineApp = useCallback(
    (messageId: string) => {
      const target = messagesRef.current.find((m) => m.id === messageId);
      const appKey = target?.inlineApp?.appKey;
      if (!appKey) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, inlineApp: { appKey, status: 'loading' as const } }
            : m,
        ),
      );
      void runInlineAppForMessage(messageId, appKey);
    },
    [runInlineAppForMessage],
  );

  /**
   * 用户在内联 app 卡片里做的操作。
   *
   * 设计原则：把"做题"串进"和同学对话"，但不把每题解析刷进聊天流。
   * Quiz 的正误和解析留在卡片内部；作答结果写进 quizAttemptsRef，供下一轮
   * /api/tutor 提问时作为隐藏上下文传给同桌。
   *
   *   - quiz_submit           → 只记录作答结果，不追加可见 bubble
   *   - quiz_all_done         → 静默；总结留给用户主动追问
   *   - flashcard_rate（again）→ 追加一条 bubble：卡片正反面 + [换个讲法] action
   *   - flashcard_rate（其他）→ 静默
   *   - flashcard_all_done    → 追加一条总结 bubble（原有行为）
   *
   * bubble 上的 action.kind='say' 会被 ClassroomView 路由回 sendToTutor，
   * 也就是说——一次自然的追问，同学会用完整的 /api/tutor 能力（带转录上下文，
   * 但课中不带时间回跳）来回答。对话流是真的闭环的。
   */
  const handleInlineAppInteraction = useCallback(
    (_messageId: string, event: InlineAppInteraction) => {
      if (event.kind === 'quiz_submit') {
        quizAttemptsRef.current = upsertQuizAttempt(quizAttemptsRef.current, {
          questionId: event.questionId,
          stem: event.stem,
          picked: event.picked,
          pickedText: event.pickedText,
          correctAnswer: event.correctAnswer,
          correctText: event.correctText,
          explanation: event.explanation,
          correct: event.correct,
        });
        return;
      }
      if (event.kind === 'quiz_all_done') {
        return;
      }
      if (event.kind === 'flashcard_rate') {
        if (event.rating !== 'again') return; // 只有"再来"才插嘴
        setMessages((prev) => [
          ...prev,
          {
            id: `fc-again-${event.cardId}-${Date.now()}`,
            role: 'companion',
            content: `这张没记住没关系——\n\n**${event.front}**\n\n${event.back}`,
            actions: [
              {
                label: '换个讲法',
                kind: 'say',
                payload: `上面这张闪卡（${truncate(event.front, 40)}）我还是记不住，能换个角度讲讲吗？`,
              },
            ],
            createdAt: Date.now(),
          },
        ]);
        return;
      }
      if (event.kind === 'flashcard_all_done') {
        setMessages((prev) => [
          ...prev,
          {
            id: `fc-feedback-${Date.now()}`,
            role: 'companion',
            content: `${event.reviewed} 张过完了。明天再来一遍，记得更稳。`,
            createdAt: Date.now(),
          },
        ]);
        return;
      }
    },
    [],
  );

  /**
   * M14.5: send 现在可接收第二参数 supportMaterials（来自底座 useChatFileUpload）。
   * 课堂场景刚需：拍 PPT 上一道题、贴一张错题截图问"这个怎么做"。
   * 不传或空数组 = 不附加（向后兼容旧调用方）。
   */
  const send = useCallback(async (
    text: string,
    supportMaterials?: Array<{ title: string; content: string }>,
  ) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    latestSupportMaterialsRef.current = supportMaterials;

    // 1. 先把用户消息 commit 进 messages
    const userMsg: CompanionMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // ── Early return：没有转录内容就不打 /api/tutor ──
    // tutor 接口要求 segments 文本总量 ≥50 字 或 ≥2 段，
    // 不够时它会返回非流式 JSON（"录音内容较少"），无法流式。
    // 这里提前 short-circuit，给一句同桌风格的话，不发请求。
    const totalTextLength = segments.reduce((sum, s) => sum + (s.text?.length || 0), 0);
    const hasEnoughContext = segments.length >= 2 && totalTextLength >= 50;
    if (!hasEnoughContext) {
      const hasAnyLesson = (lessons?.length ?? 0) > 0;
      setMessages((prev) => [
        ...prev,
        {
          id: `c-${Date.now()}`,
          role: 'companion',
          content: hasAnyLesson
            ? '等你录完一节课，我们再好好聊——现在我对你这节课还没听够。'
            : '我还没听过你的课，不知道你想聊哪方面。先录一节，我就有话说了。',
          createdAt: Date.now(),
        },
      ]);
      return;
    }

    // 2. 开一个"流式 AI 气泡"，占位显示
    const streamId = `c-${Date.now()}`;
    setStreamingMessage({
      id: streamId,
      role: 'companion',
      content: '',
      createdAt: Date.now(),
    });

    try {
      const headers: Record<string, string> = {};
      if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
      const tutorQuestion = buildQuestionWithQuizContext(trimmed, quizAttemptsRef.current);

      // M10：所有 AI 对话都打 /api/tutor/agent。
      // 课堂同桌的 mode 固定 'in-class'——短回答、recentFocus 注入、允许 open_app marker。
      // messages 构造：tutor agent 需要 UIMessage[] 形态（role + parts/content），
      // 我们把本地历史映射过去，并把用户当前 question 追加为最新一条 user 消息。
      const historyUIMessages = messagesRef.current
        // 首条 auto-listening 系统消息不发给模型
        .filter((m) => m.id !== 'auto-listening')
        .map((m) => ({
          id: m.id,
          role: (m.role === 'companion' ? 'assistant' : 'user') as 'user' | 'assistant',
          parts: [{ type: 'text' as const, text: m.content }],
        }));
      const uiMessages = [
        ...historyUIMessages,
        {
          id: userMsg.id,
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: tutorQuestion }],
        },
      ];

      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setIsStreaming(true);
      setSseThinking(true);

      const streamResult = await fetchUIMessageStream(
        '/api/tutor/agent',
        buildInClassTutorAgentBody({
          messages: uiMessages,
          sessionId,
          segments,
          model: preferredModel,
          // M11.5：把 bio + 结构化 + goals 注入"同桌"上下文，让 AI 也能"认识"用户
          learnerProfile: formatLearnerProfileForTutorAgent(user?.learnerProfile),
          // M14.5：用户在课堂上传的图片/文档（来自底座 useChatFileUpload）
          supportMaterials,
        }),
        {
          headers,
          signal: abortRef.current.signal,
          onTextStart: () => {
            // 第一条 text-delta 到达前，thinking 态继续；到达后切回 streaming
            // 由 onTextDelta 里处理——此处留空，只是标记 start 发生过
          },
          onTextDelta: (_chunk, fullContent) => {
            // R9 流式真修：用 flushSync 强制每次 token delta 立即 commit DOM。
            // 之前 React 18 automatic batching 把 reader 循环里连续多次 setState
            // 合并成 1 帧 commit，导致用户看到字一坨一坨刷出。
            // flushSync 让每个字符 delta 都触发立即渲染（配合后端 30ms delay
            // = 60fps 友好的逐字浮现节奏）。
            //
            // 性能 OK：30ms 间隔 = 33 次/秒 setState，远低于 React 同步渲染上限。
            flushSync(() => {
              setSseThinking(false);
              // 流式渲染时把 <open_app:.../> 标记提前剥掉，避免用户看到半成品标签
              const { cleaned } = extractOpenAppMarker(fullContent);
              setStreamingMessage((prev) => prev ? { ...prev, content: cleaned } : prev);
            });
          },
        },
      );

      // 3. 流结束，commit
      const rawFinal = streamResult.text?.trim()
        ? streamResult.text
        : '嗯……我对这节课还没理解到能接这个问题的程度。再给我点时间，或者换个具体点的问法？';

      // 先抽出 open_app 标记，再防御性清理课中不应出现的时间戳。
      const { key: openAppKey, cleaned } = extractOpenAppMarker(rawFinal);
      const finalContent = normalizeCompanionMarkdown(cleaned);

      setMessages((prev) => [
        ...prev,
        {
          id: streamId,
          role: 'companion',
          content: finalContent,
          createdAt: Date.now(),
        },
      ]);
      setStreamingMessage(null);
      setIsStreaming(false);
      setSseThinking(false);
      abortRef.current = null;

      // 用户在流结束前点了停止——aborted=true，但我们已经 commit 了部分文本
      if (streamResult.aborted) return;

      // M8 agent-native chip parity：同学说了"好我来整一张"之后，要把产物
      // 交给用户。两种路径：
      //   - inlineAppMode=true（默认）：不开窗口，追加一条"生成中"气泡，
      //     调 /api/apps/execute 拿到结果后把气泡升级为 ready 态；产物直接
      //     渲染在对话流里（InlineAppCard）。
      //   - inlineAppMode=false：延迟 320ms 调 onOpenApp 打开 WorkshopWindow
      //     （旧行为，留给复习态用）。
      if (openAppKey && isInClassBlockedInlineAppKey(openAppKey)) {
        return;
      }

      if (openAppKey && isWorkshopAppKey(openAppKey)) {
        const safeKey: WorkshopAppKey = openAppKey;
        // 内联渲染目前只覆盖 4 类结构化知识产物（quiz / flashcards /
        // cheatsheet / mindmap）——audio-overview（口播）、
        // infographic（长图）不适合塞进对话气泡里，只能开窗口。
        const inlineSupported: ReadonlyArray<WorkshopAppKey> = [
          'quiz',
          'flashcards',
          'cheatsheet',
          'mindmap',
        ];
        const canInline = inlineSupported.includes(safeKey);
        if (inlineAppMode && canInline) {
          triggerInlineAppGeneration(
            safeKey as NonNullable<CompanionMessage['inlineApp']>['appKey'],
          );
        } else if (onOpenApp) {
          window.setTimeout(() => onOpenApp(safeKey), 320);
        }
      }
    } catch (err) {
      setIsStreaming(false);
      setSseThinking(false);
      abortRef.current = null;
      if (err instanceof Error && err.name === 'AbortError') {
        setStreamingMessage((prev) => {
          if (prev && prev.content.trim()) {
            setMessages((msgs) => [...msgs, prev]);
          }
          return null;
        });
        return;
      }
      const rawErrMsg = err instanceof Error ? err.message : '我这边网络好像不太好';
      // 402 积分拦截：fetchUIMessageStream 会把 status/body 附在 Error 上。
      // 按 Taste 约束不弹 toast，把说明揉进一句同学的话里（含余额与下月发放）。
      const streamErr = err as (Error & { status?: number; body?: unknown }) | null;
      const pointsBlock = streamErr ? parsePointsBlock(streamErr.status ?? 0, streamErr.body) : null;
      if (pointsBlock) {
        setMessages((prev) => [
          ...prev,
          {
            id: streamId,
            role: 'companion',
            content: describePointsBlock(pointsBlock),
            createdAt: Date.now(),
          },
        ]);
        setStreamingMessage(null);
        notifyPointsChanged();
        // 高意向截断：余额不足（登录用户）同步唤起付费页；会员闸门弹会员 Tab；guest 限额/月熔断不弹
        if (pointsBlock.kind === 'insufficient_points') {
          openPaywallGlobal({ reason: 'insufficient_points', balance: pointsBlock.balance, required: pointsBlock.required });
        } else if (pointsBlock.kind === 'membership_required') {
          openPaywallGlobal({ reason: 'membership_required', requiredTier: pointsBlock.requiredTier });
        }
        return;
      }
      // M14.5.3: 错误清洁——nginx 500 HTML / 长 stack 不能直接渲染进气泡
      const errMsg = (() => {
        const trimmed = String(rawErrMsg).trim();
        if (!trimmed) return '网络不太好';
        if (
          /<\/?(?:html|head|body|center|h1|hr|title)\b/i.test(trimmed) ||
          /Internal Server Error|Bad Gateway|Service Unavailable/i.test(trimmed) ||
          trimmed.length > 80
        ) {
          return '网络好像不通';
        }
        return trimmed;
      })();
      setMessages((prev) => [
        ...prev,
        {
          id: streamId,
          role: 'companion',
          content: `我这边没接上（${errMsg}），待会儿再问我一次？`,
          createdAt: Date.now(),
        },
      ]);
      setStreamingMessage(null);
    }
  }, [accessToken, preferredModel, segments, sessionId, lessons, onOpenApp, inlineAppMode, triggerInlineAppGeneration]);

  const stop = useCallback(() => {
    stopStream();
  }, [stopStream]);

  const inspectorBody = buildInClassTutorAgentBody({
    messages: [],
    sessionId,
    segments,
    model: preferredModel,
    learnerProfile: formatLearnerProfileForTutorAgent(user?.learnerProfile),
    supportMaterials: latestSupportMaterialsRef.current,
  });
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');

  return {
    messages,
    streamingMessage,
    isThinking: isStreaming || sseThinking,
    send,
    stop,
    markListening,
    retryInlineApp,
    handleInlineAppInteraction,
    adminInspector: {
      context: inspectorBody.context,
      options: inspectorBody.options,
      query: latestUserMessage?.content || '',
    },
  };
}
