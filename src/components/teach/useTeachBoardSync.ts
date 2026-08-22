'use client';

/**
 * useTeachBoardSync — 声画联动（说到哪写到哪），从 useTeachSession 拆出。
 *
 * 机制：每个句子入队即得递增序号（TeachSpeechPlayer.lastSeq）；live 事件里
 * 的板书动作锚到"它前面最后一个句子"的序号，该句**开始播放**（或合成失败
 * 被跳过）时 onSentenceStart 放行上板——保持鲜活，不等播完。
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
}

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
    const waiting: PendingBoardItem[] = [];
    for (const item of pending) {
      if (item.seq <= started) applyBoardEffect(item.name, item.args);
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
      pendingBoardRef.current.push({ seq, name, args });
    },
    [applyBoardEffect, isAudioActive, lastSeq],
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
