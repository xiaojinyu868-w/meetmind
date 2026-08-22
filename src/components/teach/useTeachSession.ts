'use client';

/**
 * useTeachSession — /teach 页的会话状态机：消费 teach-client 事件流，
 * 驱动右栏对话（messages）与左画布（pages/pageIndex）两侧状态。
 *
 * 双驱动（同一 applyEvent 入口）：
 * - mock：MockTeachSession 生成器 pull（本地演示）
 * - 真实：GET .../stream EventSource 订阅 push；POST messages/interrupt 只回
 *   ack（turn 进行中 409 → 改走 interrupt 附带 text 一步打断续讲）
 *
 * 事件落地规则：
 * - text-delta → 当前 assistant 气泡流式追加（tool-call 后是否开新气泡由
 *   句号闸门决定：上句话说完了才分，一句话不被 chip 切碎）
 * - tool-call → 可见工具挂 chip（isVisibleTool）+ boardEffectOf 上板/翻页
 * - turn-complete / interrupted → 一轮结束；mock 模式快照落盘（teach-store）
 * - student-message → 仅事件日志回放出现，还原用户气泡（quote 拆回引用块）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardPage } from '@/lib/ai-native/plugins/board-script';
import { COPY } from '@/lib/ui/copy';
import { boardEffectOf, buildWireText, isVisibleTool, parseWireText } from './teach-events';
import type { TeachChatMessage, TeachEvent } from './teach-events';
import { useTeachBoardSync } from './useTeachBoardSync';
import {
  attachMockSession,
  isMockMode,
  mockCursorOf,
  teachCreateThread,
  teachFetchEvents,
  teachInterrupt,
  teachPostInterrupt,
  teachPostMessage,
  teachSendMessage,
  teachStartLesson,
} from './teach-client';
import type { MockPace } from './mockTeachStream';
import { loadTeachSnapshot, saveTeachSnapshot } from './teach-store';
import type { TeachThreadMeta, TeachThreadSnapshot } from './teach-store';

function emptyPage(): BoardPage {
  return { segments: [{ type: 'narration', narration: '', actions: [] }] };
}

function newMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 句末标点：tool-call 落在这里才分气泡（"说完就写"；半句被切开会产生碎气泡） */
const SENTENCE_END_RE = /[。！？；：.!?;:]$/;

export interface UseTeachSessionResult {
  threadId: string | null;
  title: string;
  messages: TeachChatMessage[];
  pages: BoardPage[];
  pageIndex: number;
  streaming: boolean;
  /** 课已讲完（finish 工具） */
  done: boolean;
  error: string | null;
  /** 老师正在出声（语音管线播放中） */
  speaking: boolean;
  /** 静音开关（静音即清空合成队列） */
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** 用户手势里同步调用：激活程序化播放（新开一课/发送按钮） */
  unlockAudio: () => void;
  newLesson: (topic: string, pace?: MockPace) => Promise<void>;
  openThread: (meta: TeachThreadMeta, pace?: MockPace) => Promise<void>;
  send: (text: string, quote?: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useTeachSession(): UseTeachSessionResult {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<TeachChatMessage[]>([]);
  const [pages, setPages] = useState<BoardPage[]>([emptyPage()]);
  const [pageIndex, setPageIndex] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 当前在飞的 mock 流迭代器 / 真实模式订阅退订函数
  const activeStreamRef = useRef<AsyncGenerator<TeachEvent> | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;
  // 最新状态镜像（applyEvent/persist 在回调里同步读，setState 只触发渲染）
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  // tool-call 分气泡闸门：上一段话以句末标点收尾才分（下一段 text-delta 开新气泡）
  const boundaryRef = useRef(false);

  const setBothStreaming = useCallback((value: boolean) => {
    streamingRef.current = value;
    setStreaming(value);
  }, []);

  const commitMessages = useCallback((next: TeachChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const appendDelta = useCallback(
    (text: string) => {
      const prev = messagesRef.current;
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant' && !boundaryRef.current) {
        commitMessages([...prev.slice(0, -1), { ...last, text: last.text + text }]);
      } else {
        boundaryRef.current = false;
        commitMessages([...prev, { id: newMessageId(), role: 'assistant', text, chips: [] }]);
      }
    },
    [commitMessages],
  );

  const appendChip = useCallback(
    (id: string, name: string) => {
      const prev = messagesRef.current;
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant') {
        commitMessages([...prev.slice(0, -1), { ...last, chips: [...last.chips, { id, name }] }]);
      } else {
        commitMessages([...prev, { id: newMessageId(), role: 'assistant', text: '', chips: [{ id, name }] }]);
      }
    },
    [commitMessages],
  );

  const applyBoardEffect = useCallback((name: string, args: Record<string, unknown>) => {
    const effect = boardEffectOf(name, args);
    if (effect.type === 'none') return;
    if (effect.type === 'flip') {
      const nextPages = [...pagesRef.current, emptyPage()];
      pagesRef.current = nextPages;
      setPages(nextPages);
      pageIndexRef.current = nextPages.length - 1;
      setPageIndex(nextPages.length - 1);
      return;
    }
    const prev = pagesRef.current;
    const index = prev.length - 1;
    const segment = prev[index].segments[0];
    if (!segment || segment.type !== 'narration') return;
    const next = [
      ...prev.slice(0, index),
      { segments: [{ ...segment, actions: [...segment.actions, effect.action] }] },
    ];
    pagesRef.current = next;
    setPages(next);
  }, []);

  // ── 讲课声音 + 声画联动（说到哪写到哪；机制见 useTeachBoardSync 头注） ──
  const { speaking, muted, setMuted, unlockAudio, feedDelta, feedBreak, gateBoardEffect, silenceVoice } =
    useTeachBoardSync(applyBoardEffect);

  /** 单事件落地（mock 生成器 / 真实订阅 / 日志回放共用）。
   *  live=true（实时流）才喂语音管线；回放一律 false（旧课不自动出声）。 */
  const applyEvent = useCallback(
    (event: TeachEvent, live: boolean) => {
      if (event.type === 'text-delta') {
        setBothStreaming(true);
        appendDelta(event.text);
        if (live) feedDelta(event.text);
      } else if (event.type === 'tool-call') {
        setBothStreaming(true);
        if (isVisibleTool(event.name)) appendChip(event.id, event.name);
        // "说完一句就落笔"：工具调用是自然断句点，半句也送合成；
        // 先断句再取闸门序号——板书锚到刚说完的这句
        if (live && event.name !== 'pause' && event.name !== 'new_column') feedBreak();
        gateBoardEffect(event.name, event.args, live);
        // 句号闸门：上一段话说完了才分气泡；pause/new_column 不切碎话头
        if (event.name !== 'pause' && event.name !== 'new_column') {
          const last = messagesRef.current[messagesRef.current.length - 1];
          const tail = last?.role === 'assistant' ? last.text.trimEnd() : '';
          boundaryRef.current = tail === '' || SENTENCE_END_RE.test(tail);
        }
        if (event.name === 'finish') setDone(true);
      } else if (event.type === 'turn-complete') {
        setBothStreaming(false);
        if (live) feedBreak(); // 一轮讲完：尾巴半句也送合成
      } else if (event.type === 'interrupted') {
        setBothStreaming(false);
        silenceVoice(); // 学生插话 = 老师立刻闭嘴
      } else if (event.type === 'student-message') {
        const { text, quote } = parseWireText(event.text);
        commitMessages([
          ...messagesRef.current,
          { id: newMessageId(), role: 'user', text, chips: [], ...(quote ? { quote } : {}) },
        ]);
      } else if (event.type === 'error') {
        setError(event.message);
      }
      // tool-result / thread：前端不需要处理
    },
    [appendChip, appendDelta, commitMessages, feedBreak, feedDelta, gateBoardEffect, setBothStreaming, silenceVoice],
  );

  /** mock 快照落盘（真实模式历史在服务端事件日志，不写本地） */
  const persist = useCallback((overrides?: Partial<TeachThreadSnapshot>) => {
    if (!isMockMode()) return;
    const id = threadIdRef.current;
    if (!id) return;
    const cursor = mockCursorOf(id);
    saveTeachSnapshot(id, {
      messages: messagesRef.current,
      pages: pagesRef.current,
      pageIndex: pageIndexRef.current,
      cursor: cursor?.cursor ?? 0,
      pendingCheckpoint: cursor?.pendingCheckpoint ?? false,
      done: cursor?.done ?? true,
      ...overrides,
    });
  }, []);

  /** mock：拉生成器消费完一整条流 */
  const consume = useCallback(
    async (stream: AsyncGenerator<TeachEvent>) => {
      activeStreamRef.current?.return(undefined);
      activeStreamRef.current = stream;
      setBothStreaming(true);
      setError(null);
      try {
        for await (const event of stream) {
          if (activeStreamRef.current !== stream) break; // 被更新的流取代
          applyEvent(event, true);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (activeStreamRef.current === stream) activeStreamRef.current = null;
        setBothStreaming(false);
        persist();
      }
    },
    [applyEvent, persist, setBothStreaming],
  );

  /** 真实模式：订阅线程事件流；onReady = 首个 thread 事件（连接建立）。
   *  断线自愈：EventSource 出错后浏览器自动重连，open 时按事件日志全量
   *  重建状态（重放是幂等的，断连期间漏的事件靠它补齐）。 */
  const subscribeReal = useCallback(
    (id: string, onReady?: () => void) => {
      unsubscribeRef.current?.();
      let opened = false;
      let hadError = false;
      const source = new EventSource(`/api/teach/threads/${encodeURIComponent(id)}/stream`);
      const resync = async () => {
        // 全量重放重建（从空状态）：断连窗口的事件不丢
        try {
          const events = await teachFetchEvents(id);
          messagesRef.current = [];
          pagesRef.current = [emptyPage()];
          pageIndexRef.current = 0;
          boundaryRef.current = false;
          setMessages([]);
          setPages(pagesRef.current);
          setPageIndex(0);
          for (const event of events) applyEvent(event, false); // 追齐重放不出声
          // 重放后 streaming 以日志末尾事件为准；崩溃中断的 turn 按不在讲处理
          setBothStreaming(false);
        } catch {
          // 重放失败保持现状，订阅仍在
        }
      };
      source.addEventListener('open', () => {
        if (!opened) {
          opened = true;
          onReady?.();
          return;
        }
        if (hadError) {
          hadError = false;
          void resync();
        }
      });
      source.addEventListener('error', () => {
        hadError = true;
      });
      // 看门狗：连接静默（无 error 但事件停了，dev 重编译/代理抽风）75s 未动
      // 且认为在讲 → 全量重放追齐。Gemini TTFT 上限 30s，阈值不能低于它。
      let lastEventAt = Date.now();
      const watchdog = setInterval(() => {
        if (streamingRef.current && Date.now() - lastEventAt > 75_000) void resync();
      }, 15_000);
      source.onmessage = (message) => {
        lastEventAt = Date.now();
        try {
          const event = JSON.parse(message.data as string) as TeachEvent;
          if (event.type === 'thread') return; // 连接建立信号，onReady 走 open
          applyEvent(event, true);
        } catch {
          // 坏包跳过
        }
      };
      unsubscribeRef.current = () => {
        clearInterval(watchdog);
        source.close();
      };
    },
    [applyEvent, setBothStreaming],
  );

  useEffect(
    () => () => {
      activeStreamRef.current?.return(undefined);
      unsubscribeRef.current?.();
    },
    [],
  );

  // 会话代数：newLesson/openThread 竞态（如 init 的 openThread 还在 fetch，
  // 用户已点新开一课）时，慢的一方落地前发现代数已变直接放弃，不覆盖新状态
  const epochRef = useRef(0);

  const newLesson = useCallback(
    async (topic: string, pace?: MockPace) => {
      const epoch = (epochRef.current += 1);
      activeStreamRef.current?.return(undefined);
      unsubscribeRef.current?.();
      silenceVoice();
      messagesRef.current = [];
      pagesRef.current = [emptyPage()];
      pageIndexRef.current = 0;
      boundaryRef.current = false;
      setMessages([]);
      setPages(pagesRef.current);
      setPageIndex(0);
      setDone(false);
      setError(null);
      const meta = await teachCreateThread(topic, pace);
      if (epochRef.current !== epoch) return; // 已被更新的会话取代
      setThreadId(meta.id);
      setTitle(meta.title);
      threadIdRef.current = meta.id;
      if (isMockMode()) {
        // 不 await 整条流（一节课几分钟）：调用方拿线程 meta 后立刻刷新历史列表
        void consume(teachStartLesson(meta.id));
        return;
      }
      // 真实：先订阅（等 thread 首事件 = 连接建立），再发开课指令，不错过早事件
      subscribeReal(meta.id, () => {
        void teachPostMessage(meta.id, COPY.apps.teach.lessonStart).then((response) => {
          if (response.ok) setBothStreaming(true);
          else setError(`开课失败（HTTP ${response.status}）`);
        });
      });
    },
    [consume, setBothStreaming, silenceVoice, subscribeReal],
  );

  const openThread = useCallback(
    async (meta: TeachThreadMeta, pace?: MockPace) => {
      const epoch = (epochRef.current += 1);
      activeStreamRef.current?.return(undefined);
      unsubscribeRef.current?.();
      silenceVoice();
      setError(null);
      setThreadId(meta.id);
      setTitle(meta.title);
      threadIdRef.current = meta.id;
      boundaryRef.current = false;
      if (!isMockMode()) {
        // 真实：事件日志回放重建对话与画布，再订阅续讲
        const events = await teachFetchEvents(meta.id);
        if (epochRef.current !== epoch) return; // 已被更新的会话取代
        messagesRef.current = [];
        pagesRef.current = [emptyPage()];
        pageIndexRef.current = 0;
        setMessages([]);
        setPages(pagesRef.current);
        setPageIndex(0);
        setDone(false);
        for (const event of events) applyEvent(event, false); // 历史回放不出声
        setBothStreaming(false); // 回放末态不算在讲（崩溃中断的 turn 也按不在讲处理）
        subscribeReal(meta.id);
        return;
      }
      const snapshot: TeachThreadSnapshot | null = loadTeachSnapshot(meta.id);
      if (snapshot) {
        const restoredPages = snapshot.pages.length > 0 ? snapshot.pages : [emptyPage()];
        messagesRef.current = snapshot.messages;
        pagesRef.current = restoredPages;
        pageIndexRef.current = Math.min(snapshot.pageIndex, restoredPages.length - 1);
        setMessages(messagesRef.current);
        setPages(pagesRef.current);
        setPageIndex(pageIndexRef.current);
        setDone(snapshot.done);
        // mock 会话按游标重建：继续提问/作答时从断点续播
        await attachMockSession(meta.id, snapshot.cursor, snapshot.pendingCheckpoint, pace);
      } else {
        messagesRef.current = [];
        pagesRef.current = [emptyPage()];
        pageIndexRef.current = 0;
        setMessages([]);
        setPages(pagesRef.current);
        setPageIndex(0);
        setDone(false);
      }
      setBothStreaming(false);
    },
    [applyEvent, setBothStreaming, silenceVoice, subscribeReal],
  );

  const send = useCallback(
    async (text: string, quote?: string) => {
      const id = threadIdRef.current;
      const trimmed = text.trim();
      if (!id || !trimmed) return;
      commitMessages([
        ...messagesRef.current,
        { id: newMessageId(), role: 'user', text: trimmed, chips: [], ...(quote ? { quote } : {}) },
      ]);
      boundaryRef.current = false;
      // 学生开口 = 老师立刻闭嘴（不发问时的 stop 也一样）
      silenceVoice();
      if (isMockMode()) {
        // 时机语义「当前句讲完再说」：讲课中再发问 = 立即 interrupt + 发消息
        if (activeStreamRef.current) await teachInterrupt(id);
        void consume(teachSendMessage(id, { text: trimmed, quote }));
        return;
      }
      const wire = buildWireText(trimmed, quote);
      try {
        if (streamingRef.current) {
          // 打断+续讲一步完成（契约：interrupt 附 text，事件流在同一条 SSE 上）
          const response = await teachPostInterrupt(id, wire);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } else {
          const response = await teachPostMessage(id, wire);
          if (response.status === 409) {
            // 竞态：服务端 turn 其实还在跑 → 改走 interrupt 附带消息
            const retry = await teachPostInterrupt(id, wire);
            if (!retry.ok) throw new Error(`HTTP ${retry.status}`);
          } else if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
        }
        setBothStreaming(true); // turn 已起步，事件随后到（Gemini TTFT 4-30s 正常）
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [commitMessages, consume, setBothStreaming, silenceVoice],
  );

  const stop = useCallback(async () => {
    const id = threadIdRef.current;
    silenceVoice();
    if (isMockMode()) {
      activeStreamRef.current?.return(undefined);
      activeStreamRef.current = null;
      setBothStreaming(false);
      if (id) await teachInterrupt(id);
      persist();
      return;
    }
    if (id) await teachPostInterrupt(id).catch(() => undefined);
    setBothStreaming(false);
  }, [persist, setBothStreaming, silenceVoice]);

  return useMemo(
    () => ({
      threadId,
      title,
      messages,
      pages,
      pageIndex,
      streaming,
      done,
      error,
      speaking,
      muted,
      setMuted,
      unlockAudio,
      newLesson,
      openThread,
      send,
      stop,
    }),
    [threadId, title, messages, pages, pageIndex, streaming, done, error, speaking, muted, setMuted, unlockAudio, newLesson, openThread, send, stop],
  );
}
