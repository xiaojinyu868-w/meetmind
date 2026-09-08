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
 *   - 首次要等转录攒到 140 字（一句寒暄不够模型问出问题；此前 80 字就发，第一问常常空手而回）
 *   - 之后至少间隔 20s、且比上次多 150 字才再请求（避免刷屏）
 *   - 上一次返回空时：8s + 60 字就允许再试——空结果不该让右栏再空 25 秒
 *     （2026-09-08 实测示例课：6.8s 首问 → 空 → 31s 才第二问 → 33.5s 才有 chip；改后 ~14s 有 chip）
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
const MIN_FIRST_CHARS = 140;
/** 上一次空手而回后的重试门槛：更短的间隔、更少的新增 */
const EMPTY_RETRY_INTERVAL_MS = 8 * 1000;
const EMPTY_RETRY_DELTA_CHARS = 60;

/** 问句归一：去空格与标点、小写，再把"是什么 / 是啥 / 什么意思 / 啥意思"这类同义说法折叠 */
function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .replace(/是啥|是什么/g, '是')
    .replace(/啥意思|什么意思|何意/g, '意思')
    .replace(/为什么|为啥|怎么会/g, '为何')
    .replace(/[吗呢吧呀啊]$/u, '');
}

/** 两个问句是否在问同一件事：归一后相同、互相包含，或字符重合度 ≥ 0.75 */
export function isSameQuestion(a: string, b: string): boolean {
  const x = normalizeQuestion(a);
  const y = normalizeQuestion(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const setX = new Set(x);
  const setY = new Set(y);
  let shared = 0;
  for (const ch of setX) if (setY.has(ch)) shared += 1;
  return shared / Math.max(setX.size, setY.size) >= 0.75;
}

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
  /** 上一次请求是否空手而回（决定下一次用更短的门槛） */
  const lastEmptyRef = useRef<boolean>(false);
  const inFlightRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);
  // 已经产生过的 label 列表（喂给模型去重用）
  const priorLabelsRef = useRef<string[]>([]);
  // 已经上过桌的问句（客户端按问句去重；模型对 priorLabels 的遵守不可靠）
  const seenTextsRef = useRef<string[]>([]);

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
      lastEmptyRef.current = false;
      priorLabelsRef.current = [];
      seenTextsRef.current = [];
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

    // 首次：预热线达到就请求；之后：要等间隔 + 有足够新增；上次空手而回则门槛放低
    const isFirst = lastRequestAtRef.current === 0;
    const intervalNeeded = lastEmptyRef.current ? EMPTY_RETRY_INTERVAL_MS : MIN_INTERVAL_MS;
    const deltaNeeded = lastEmptyRef.current ? EMPTY_RETRY_DELTA_CHARS : MIN_DELTA_CHARS;
    const passInterval = isFirst || sinceLast >= intervalNeeded;
    const passDelta = isFirst || deltaChars >= deltaNeeded;

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
        lastEmptyRef.current = items.length === 0;
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
          // 模型会无视 priorLabels 再问一遍同一件事（"是什么意思？"→"是啥意思？"）：
          // 按问句本身去重，已经在桌上的、刚被划掉的都不再上
          const fresh = newOnes.filter((candidate) =>
            !prev.some((shown) => isSameQuestion(shown.text, candidate.text))
            && !seenTextsRef.current.some((seen) => isSameQuestion(seen, candidate.text)));
          if (fresh.length === 0) return prev;
          seenTextsRef.current = [...seenTextsRef.current, ...fresh.map((f) => f.text)].slice(-20);
          const merged = [...prev, ...fresh];
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
