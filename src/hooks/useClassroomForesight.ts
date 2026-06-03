/**
 * useClassroomForesight — 录课中「预知气泡」生成 hook
 *
 * 设计意图（对齐 Taste）：
 *   - 预知气泡是 AI 同桌的「主动性」触点。不是弹窗，不是通知，不打断。
 *   - 它只在录课时工作，每当最近转录累积到一定量（节流 + 去重），就问后端一次。
 *   - 返回 0-2 条，追加到气泡队列；队列最长保留 N 条（老的自然被推走）。
 *   - 用户点 accept → 把 text 当作问句发给 tutor；点 dismiss → 本地移除。
 *
 * 为什么放到 hook 而不是 useClassroomCompanion：
 *   - Companion 是用户主动对话流，Foresight 是 AI 主动预判流，是两个语义。
 *   - 两者共用底部输入框发送（accept 路径），但各自独立触发与消费。
 *
 * 节流策略：
 *   - 至少间隔 20s 才会再请求一次（避免刷屏）
 *   - 最近转录文本至少比上次多 150 字才触发
 *   - 同时最多有 3 条可见气泡，超出时最老的一条自动让位
 *
 * 后端：/api/classroom/foresight（qwen3.7-plus）
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ForesightBubble } from '@/components/classroom/ClassroomCompanionPanel';

/** 队列最大长度——超过会淘汰最老 */
const MAX_VISIBLE = 3;
/** 两次请求的最小间隔（ms） */
const MIN_INTERVAL_MS = 20 * 1000;
/** 最近转录相比上次至少新增多少字才再请求 */
const MIN_DELTA_CHARS = 150;
/** 第一次请求前的预热：转录至少这么长才开始 */
const MIN_FIRST_CHARS = 80;

export interface UseClassroomForesightInput {
  /** 是否启用（只在录课中开） */
  enabled: boolean;
  /** 最近已转录文本（拼好的） */
  recentText: string | undefined;
  /** 当前课程标题（可选，帮助模型建立场景） */
  lessonTitle?: string;
}

export interface UseClassroomForesightReturn {
  foresights: ForesightBubble[];
  /** 手动移除一条（用户划掉） */
  dismiss: (id: string) => void;
  /** 手动清空（例如录完课） */
  clear: () => void;
}

interface ApiResponse {
  foresights?: Array<{ id?: string; label?: string; text?: string }>;
}

export function useClassroomForesight({
  enabled,
  recentText,
  lessonTitle,
}: UseClassroomForesightInput): UseClassroomForesightReturn {
  const [foresights, setForesights] = useState<ForesightBubble[]>([]);

  const lastRequestAtRef = useRef<number>(0);
  const lastRequestLenRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);
  // 已经产生过的 label 列表（去重用）
  const priorLabelsRef = useRef<string[]>([]);

  // 失活 / 卸载时清理
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // 录课关闭时清空气泡 + 指纹
  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      abortRef.current = null;
      setForesights([]);
      lastRequestAtRef.current = 0;
      lastRequestLenRef.current = 0;
      priorLabelsRef.current = [];
    }
  }, [enabled]);

  // 核心：监听 recentText，满足节流条件时请求一次
  useEffect(() => {
    if (!enabled) return;
    if (!recentText) return;

    const text = recentText.trim();
    const len = text.length;

    // 太短，还没到预热线
    if (len < MIN_FIRST_CHARS) return;

    const now = Date.now();
    const sinceLast = now - lastRequestAtRef.current;
    const deltaChars = len - lastRequestLenRef.current;

    // 首次：预热线达到就请求；之后：要等间隔 + 有足够新增
    const isFirst = lastRequestAtRef.current === 0;
    const passInterval = isFirst || sinceLast >= MIN_INTERVAL_MS;
    const passDelta = isFirst || deltaChars >= MIN_DELTA_CHARS;

    if (!passInterval || !passDelta) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    lastRequestAtRef.current = now;
    lastRequestLenRef.current = len;

    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;

    (async () => {
      try {
        const res = await fetch('/api/classroom/foresight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recentText: text.slice(-1200),
            lessonTitle,
            priorLabels: priorLabelsRef.current,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) return;

        const data = (await res.json()) as ApiResponse;
        const items = Array.isArray(data.foresights) ? data.foresights : [];
        if (items.length === 0) return;

        const nowStamp = Date.now();
        const newOnes: ForesightBubble[] = items
          .filter((f) => typeof f?.label === 'string' && typeof f?.text === 'string')
          .map((f, i): ForesightBubble => ({
            id: f.id || `fs-${nowStamp}-${i}`,
            label: String(f.label).trim(),
            text: String(f.text).trim(),
            createdAt: nowStamp,
          }))
          .filter((f) => f.label.length > 0 && f.text.length > 0);

        if (newOnes.length === 0) return;

        // 记住 label 避免下一轮再生成类似的
        priorLabelsRef.current = [
          ...priorLabelsRef.current,
          ...newOnes.map((f) => f.label),
        ].slice(-10);

        setForesights((prev) => {
          const merged = [...prev, ...newOnes];
          return merged.length > MAX_VISIBLE
            ? merged.slice(merged.length - MAX_VISIBLE)
            : merged;
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        // 静默失败——预知本就是"可有可无"，失败不打扰
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [enabled, recentText, lessonTitle]);

  const dismiss = useCallback((id: string) => {
    setForesights((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clear = useCallback(() => {
    setForesights([]);
  }, []);

  return { foresights, dismiss, clear };
}
