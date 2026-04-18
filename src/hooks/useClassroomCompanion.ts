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
import { useSimpleSSEStream, type SSEEvent } from '@/lib/hooks/useSSEStream';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { getPreference, setPreference } from '@/lib/db';
import { composeFirstHello } from '@/components/classroom/composeFirstHello';
import type { TranscriptSegment } from '@/types';
import type { CompanionMessage, Lesson } from '@/components/classroom/types';

/** preferences 里存同桌历史的 key */
const COMPANION_MESSAGES_KEY = 'classroom_companion_messages';
/** 最多保留多少条历史（防止无限膨胀） */
const MAX_PERSISTED_MESSAGES = 50;

/** 切到录课态时同桌自动说一句。 */
const AUTO_LISTENING_MSG: CompanionMessage = {
  id: 'auto-listening',
  role: 'companion',
  content: '我在听这节课。听不懂的地方你直接问我。',
  createdAt: Date.now(),
};

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
  /** 同桌切到 listening 态时调用一次，追加一句开场白 */
  markListening: () => void;
}

export interface UseClassroomCompanionInput {
  /** 课堂列表——用于生成动态开场白。传 undefined 则用默认静态问候。 */
  lessons?: Lesson[];
  /** 是否正在录课——影响开场白选择（录课时不说废话） */
  isRecording?: boolean;
}

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

export function useClassroomCompanion(
  input: UseClassroomCompanionInput = {},
): UseClassroomCompanionReturn {
  const { lessons, isRecording = false } = input;

  const { accessToken } = useAuth();
  const sessionId = useSessionStore((s) => s.sessionId);
  const segments = useCaptureEditorStore((s) => s.segments);

  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<CompanionMessage | null>(null);

  const {
    fetchStream,
    stopStream,
    isStreaming,
    isThinking: sseThinking,
  } = useSimpleSSEStream();

  // 防抖：避免在同一次 listening 切换中重复追加 AUTO_LISTENING_MSG
  const hasListeningGreetedRef = useRef(false);
  // 防抖：开场白只注入一次（lessons 后续变化不再改开场白）
  const hasHelloInjectedRef = useRef(false);
  // 是否已从 preferences 水合——未水合前不写回，避免用空数组覆盖持久化的历史
  const [isHydrated, setIsHydrated] = useState(false);

  // ── 1. 启动时从 preferences 读持久化的消息 ──
  //   但如果本次组件挂载时就已经在录课（isRecording=true），说明是"新课开始"场景，
  //   不要把历史水合到界面上——界面保持一张白纸。
  useEffect(() => {
    let alive = true;
    if (isRecording) {
      // 录课中挂载：跳过历史注入，直接标记已水合
      setIsHydrated(true);
      hasHelloInjectedRef.current = true;
      return () => { alive = false; };
    }
    getPreference<CompanionMessage[]>(COMPANION_MESSAGES_KEY, []).then((persisted) => {
      if (!alive) return;
      if (persisted.length > 0) {
        setMessages(persisted);
        // 既然恢复了历史，就跳过开场白注入
        hasHelloInjectedRef.current = true;
      }
      setIsHydrated(true);
    }).catch(() => {
      if (alive) setIsHydrated(true);
    });
    return () => { alive = false; };
    // 只在挂载时跑一次 —— isRecording 的后续变化由单独的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. messages 变化时 debounced 写回 preferences ──
  //   护栏：messages 为空时不覆盖持久化历史——新课清空的是"可见消息"，
  //   但 preferences 里的对话记忆要保留给未来的长记忆系统。
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isHydrated) return; // 未水合前不写
    if (messages.length === 0) return; // 空数组不写回，保护已有历史
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      // 只保留最近 MAX 条
      const trimmed = messages.length > MAX_PERSISTED_MESSAGES
        ? messages.slice(-MAX_PERSISTED_MESSAGES)
        : messages;
      void setPreference(COMPANION_MESSAGES_KEY, trimmed).catch(() => undefined);
    }, 500);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [messages, isHydrated]);

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
    if (hasListeningGreetedRef.current) return;
    hasListeningGreetedRef.current = true;
    setMessages((prev) => {
      if (prev.some((m) => m.id === 'auto-listening')) return prev;
      return [...prev, { ...AUTO_LISTENING_MSG, createdAt: Date.now() }];
    });
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
      hasListeningGreetedRef.current = false;
      // 新课不再走首次 hello 注入
      hasHelloInjectedRef.current = true;
    }
  }, [isRecording]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

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

      const result = await fetchStream('/api/tutor', {
        timestamp: 0,
        segments: toTutorSegments(segments),
        studentQuestion: trimmed,
        globalMode: true,
        enable_guidance: false,
        enable_web: false,
        sessionId: sessionId || undefined,
        stream: true,
      }, {
        headers,
        onContent: (_chunk, fullContent) => {
          setStreamingMessage((prev) => prev ? { ...prev, content: fullContent } : prev);
        },
        onMetadata: (_metadata: SSEEvent) => {
          // 课堂同桌暂不消费 citations / parsed_response；未来可以做来源标注
        },
      });

      // 3. 流结束，commit
      const finalContent = result.content?.trim()
        ? result.content
        : '嗯……我对这节课还没理解到能接这个问题的程度。再给我点时间，或者换个具体点的问法？';
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
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setStreamingMessage((prev) => {
          if (prev && prev.content.trim()) {
            setMessages((msgs) => [...msgs, prev]);
          }
          return null;
        });
        return;
      }
      const errMsg = err instanceof Error ? err.message : '我这边网络好像不太好';
      setMessages((prev) => [
        ...prev,
        {
          id: streamId,
          role: 'companion',
          content: `我这边没接上（${errMsg.slice(0, 60)}），待会儿再问我一次？`,
          createdAt: Date.now(),
        },
      ]);
      setStreamingMessage(null);
    }
  }, [accessToken, segments, sessionId, fetchStream, lessons]);

  const stop = useCallback(() => {
    stopStream();
  }, [stopStream]);

  return {
    messages,
    streamingMessage,
    isThinking: isStreaming || sseThinking,
    send,
    stop,
    markListening,
  };
}
