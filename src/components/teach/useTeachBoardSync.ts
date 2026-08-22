'use client';

/**
 * useTeachBoardSync — 声画联动（说到哪写到哪），从 useTeachSession 拆出。
 *
 * 机制：每个句子入队即得递增序号（TeachSpeechPlayer.lastSeq）；live 事件里
 * 的板书动作锚到"它前面最后一个句子"的序号，该句**开始播放**（或合成失败
 * 被跳过）时 onSentenceStart 放行上板——保持鲜活，不等播完。
 * 等待必须有界（2026-08-22 实测：TTS 合成慢于生成流速时无限等待会把
 * 圈/下划线扣押几分钟）：锚句开播即放行；语音积压 >2 句或等待 >4s 直接放行。
 * 不设卡的情形：语音链路不活（未手势激活/静音）、历史回放、非 live 事件。
 * interrupt/换课/stop：没来得及说出口的板书丢弃（没说就不写）。
 * 中途静音：待上板动作全部立即放行（不等声音了）。
 */

import { useCallback, useRef } from 'react';
import { useTeachSpeech } from './useTeachSpeech';
import type { UseTeachSpeechResult } from './useTeachSpeech';

interface PendingBoardItem {
  seq: number;
  name: string;
  args: Record<string, unknown>;
  /** 入队时间戳：超时强制放行用（板书等声音必须有界） */
  enqueuedAt: number;
}

/** 闸门边界：语音积压超过 2 句时板书不再等（直接放行），
 *  单项最多等 4s——"说到哪写到哪"是体感对齐，不是让板书冻结等语音还债 */
const MAX_BACKLOG_SENTENCES = 2;
const MAX_WAIT_MS = 4000;

export interface UseTeachBoardSyncResult
  extends Pick<UseTeachSpeechResult, 'speaking' | 'muted' | 'unlockAudio' | 'feedDelta' | 'feedBreak'> {
  setMuted: (muted: boolean) => void;
  /** 板书动作过闸门：live 且语音活着时锚句延迟上板，否则立即 */
  gateBoardEffect: (name: string, args: Record<string, unknown>, live: boolean) => void;
  /** 老师闭嘴 + 丢弃未说出口的板书 */
  silenceVoice: () => void;
}

export function useTeachBoardSync(
  applyBoardEffect: (name: string, args: Record<string, unknown>) => void,
): UseTeachBoardSyncResult {
  const startedSeqRef = useRef(0);
  const pendingBoardRef = useRef<PendingBoardItem[]>([]);

  const drainPendingBoard = useCallback(() => {
    const started = startedSeqRef.current;
    const pending = pendingBoardRef.current;
    if (pending.length === 0) return;
    const now = Date.now();
    const waiting: PendingBoardItem[] = [];
    for (const item of pending) {
      // 放行条件：锚句已开始播 / 等待超时（有界等待，板书绝不冻结）
      if (item.seq <= started || now - item.enqueuedAt >= MAX_WAIT_MS) applyBoardEffect(item.name, item.args);
      else waiting.push(item);
    }
    pendingBoardRef.current = waiting;
  }, [applyBoardEffect]);

  const speech = useTeachSpeech((seq) => {
    startedSeqRef.current = Math.max(startedSeqRef.current, seq);
    drainPendingBoard();
  });
  const {
    speaking,
    muted,
    setMuted: speechSetMuted,
    unlockAudio,
    feedDelta,
    feedBreak,
    silence: speechSilence,
    isAudioActive,
    lastSeq,
  } = speech;

  const gateBoardEffect = useCallback(
    (name: string, args: Record<string, unknown>, live: boolean) => {
      if (!live || !isAudioActive()) {
        applyBoardEffect(name, args);
        return;
      }
      const seq = lastSeq();
      if (seq <= startedSeqRef.current) {
        applyBoardEffect(name, args);
        return;
      }
      // 语音积压有界：队列里没播的句子超阈值，板书直接上（老师不会因嘴里
      // 没说完就停笔几分钟——TTS 合成慢于生成流速时这个兜底救活整板）
      if (seq - startedSeqRef.current > MAX_BACKLOG_SENTENCES) {
        applyBoardEffect(name, args);
        return;
      }
      pendingBoardRef.current.push({ seq, name, args, enqueuedAt: Date.now() });
      // 超时放行需要独立驱动（句子迟迟不开播时 drain 不会被回调触发）
      setTimeout(drainPendingBoard, MAX_WAIT_MS);
    },
    [applyBoardEffect, isAudioActive, lastSeq, drainPendingBoard],
  );

  const setMuted = useCallback(
    (value: boolean) => {
      speechSetMuted(value);
      if (value) {
        // 静音 = 不再等声音：待上板动作全部立即放行
        const pending = pendingBoardRef.current;
        pendingBoardRef.current = [];
        for (const item of pending) applyBoardEffect(item.name, item.args);
      }
    },
    [speechSetMuted, applyBoardEffect],
  );

  const silenceVoice = useCallback(() => {
    speechSilence();
    pendingBoardRef.current = [];
  }, [speechSilence]);

  return {
    speaking,
    muted,
    setMuted,
    unlockAudio,
    feedDelta,
    feedBreak,
    gateBoardEffect,
    silenceVoice,
  };
}
