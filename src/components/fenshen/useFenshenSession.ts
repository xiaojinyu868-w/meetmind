'use client';

/**
 * useFenshenSession — 分身对话/蒸馏的事件流状态机 hook（照 useTeachSession 模式，
 * 无画布、无语音、无 mock）。
 *
 * 数据流：open(egoId) 时先 GET .../events 事件日志全量回放重建历史
 * （蒸馏进度 + 对话，含 user-message 记录），再订阅 GET .../stream 续接实时
 * 事件；POST messages/interrupt 只回 ack，事件经同一条 SSE 流出。
 *
 * 发送语义（与 teach 对齐）：
 * - streaming 中发送 = interrupt 附带 text（打断+续讲一步完成）
 * - 非 streaming 发送收到 409（竞态：服务端 turn 还在跑）→ 改走 interrupt+text
 *
 * 断线自愈：EventSource 出错后浏览器自动重连，open 时按事件日志全量重放追齐
 * （重放幂等，断连窗口的事件靠它补齐）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COPY } from '@/lib/ui/copy';
import {
  applyFenshenEvent,
  initialFenshenSessionState,
  replayFenshenEvents,
} from './fenshen-events';
import type {
  DistillProgressEntry,
  FenshenChatMessage,
  FenshenLogEvent,
  FenshenSessionState,
  FenshenStreamEvent,
} from './fenshen-events';
import {
  fenshenErrorMessage,
  fenshenFetchEvents,
  fenshenPostFeedback,
  fenshenPostInterrupt,
  fenshenPostMessage,
} from './fenshen-client';

export interface UseFenshenSessionResult {
  egoId: string | null;
  messages: FenshenChatMessage[];
  progress: DistillProgressEntry[];
  streaming: boolean;
  ready: boolean;
  error: string | null;
  /** 打开一个分身：回放历史 + 订阅实时流（重复调用切换分身） */
  open: (egoId: string) => Promise<void>;
  /** 发消息（streaming 中 = 打断续讲） */
  send: (text: string) => Promise<void>;
  /** 纯打断（不带续讲消息） */
  interrupt: () => Promise<void>;
  /** 试听反馈；unlike 后状态由调用方按契约回到 learning */
  sendFeedback: (verdict: 'like' | 'unlike', note?: string) => Promise<boolean>;
  /** 退订并清空（离开面板时调用） */
  close: () => void;
  clearError: () => void;
}

export function useFenshenSession(): UseFenshenSessionResult {
  const [egoId, setEgoId] = useState<string | null>(null);
  const [state, setState] = useState<FenshenSessionState>(initialFenshenSessionState);

  const unsubscribeRef = useRef<(() => void) | null>(null);
  const egoIdRef = useRef<string | null>(null);
  egoIdRef.current = egoId;
  const stateRef = useRef(state);
  stateRef.current = state;
  // 会话代数：open 竞态（慢的旧 open 落地前发现代数已变直接放弃）
  const epochRef = useRef(0);

  const commit = useCallback((next: FenshenSessionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const apply = useCallback(
    (event: FenshenLogEvent) => {
      commit(applyFenshenEvent(stateRef.current, event));
    },
    [commit],
  );

  /** 全量重放追齐（断线重连 / 看门狗兜底；重放幂等） */
  const resync = useCallback(
    async (id: string) => {
      try {
        const events = await fenshenFetchEvents(id);
        if (egoIdRef.current !== id) return;
        commit(replayFenshenEvents(events));
      } catch {
        // 重放失败保持现状，订阅仍在
      }
    },
    [commit],
  );

  const subscribe = useCallback(
    (id: string) => {
      unsubscribeRef.current?.();
      let hadError = false;
      const source = new EventSource(`/api/fenshen/egos/${encodeURIComponent(id)}/stream`);
      source.addEventListener('open', () => {
        if (hadError) {
          hadError = false;
          void resync(id);
        }
      });
      source.addEventListener('error', () => {
        hadError = true;
      });
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as FenshenStreamEvent;
          if (event.type === 'thread') return; // 连接建立信号
          apply(event);
        } catch {
          // 坏包跳过
        }
      };
      unsubscribeRef.current = () => source.close();
    },
    [apply, resync],
  );

  const open = useCallback(
    async (id: string) => {
      const epoch = (epochRef.current += 1);
      unsubscribeRef.current?.();
      egoIdRef.current = id;
      setEgoId(id);
      commit(initialFenshenSessionState());
      // 先回放历史（含蒸馏进度），再订阅续接
      try {
        const events = await fenshenFetchEvents(id);
        if (epochRef.current !== epoch) return; // 已被更新的会话取代
        commit(replayFenshenEvents(events));
      } catch {
        // 历史回放失败不阻塞订阅（新分身本来就没有日志）
      }
      if (epochRef.current !== epoch) return;
      subscribe(id);
    },
    [commit, subscribe],
  );

  const close = useCallback(() => {
    epochRef.current += 1;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    egoIdRef.current = null;
    setEgoId(null);
    commit(initialFenshenSessionState());
  }, [commit]);

  useEffect(
    () => () => {
      unsubscribeRef.current?.();
    },
    [],
  );

  const send = useCallback(async (text: string) => {
    const id = egoIdRef.current;
    const trimmed = text.trim();
    if (!id || !trimmed) return;
    // 乐观落地用户气泡（与回放里的 user-message 同形）
    apply({ type: 'user-message', text: trimmed });
    try {
      if (stateRef.current.streaming) {
        const response = await fenshenPostInterrupt(id, trimmed);
        if (!response.ok) throw new Error(await fenshenErrorMessage(response));
      } else {
        const response = await fenshenPostMessage(id, trimmed);
        if (response.status === 409) {
          const retry = await fenshenPostInterrupt(id, trimmed);
          if (!retry.ok) throw new Error(await fenshenErrorMessage(retry));
        } else if (!response.ok) {
          throw new Error(await fenshenErrorMessage(response));
        }
      }
      // turn 已起步，事件随后到
      commit({ ...stateRef.current, streaming: true });
    } catch (cause) {
      commit({
        ...stateRef.current,
        error: cause instanceof Error ? cause.message : COPY.fenshen.sendFailed,
      });
    }
  }, [apply, commit]);

  const interrupt = useCallback(async () => {
    const id = egoIdRef.current;
    if (!id) return;
    try {
      await fenshenPostInterrupt(id);
    } catch {
      // 打断失败由 error 事件 / 下次操作收敛
    }
    commit({ ...stateRef.current, streaming: false });
  }, [commit]);

  const sendFeedback = useCallback(
    async (verdict: 'like' | 'unlike', note?: string): Promise<boolean> => {
      const id = egoIdRef.current;
      if (!id) return false;
      try {
        const response = await fenshenPostFeedback(id, verdict, note);
        if (!response.ok) throw new Error(await fenshenErrorMessage(response));
        // unlike → 契约：状态回 learning，重蒸馏 turn 的进度/ego-ready 经订阅流出
        if (verdict === 'unlike') commit({ ...stateRef.current, ready: false });
        return true;
      } catch (cause) {
        commit({
          ...stateRef.current,
          error: cause instanceof Error ? cause.message : COPY.fenshen.feedbackFailed,
        });
        return false;
      }
    },
    [commit],
  );

  const clearError = useCallback(() => {
    commit({ ...stateRef.current, error: null });
  }, [commit]);

  return useMemo(
    () => ({
      egoId,
      messages: state.messages,
      progress: state.progress,
      streaming: state.streaming,
      ready: state.ready,
      error: state.error,
      open,
      send,
      interrupt,
      sendFeedback,
      close,
      clearError,
    }),
    [egoId, state, open, send, interrupt, sendFeedback, close, clearError],
  );
}
