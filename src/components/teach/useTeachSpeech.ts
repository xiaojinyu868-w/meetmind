'use client';

/**
 * useTeachSpeech — 讲课声音的 hook 封装（从 useTeachSession 拆出，行数限制）。
 *
 * 持有 SentenceSplitter + TeachSpeechPlayer，给会话状态机三个喂口：
 * - feedDelta：text-delta 增量 → 按句入队
 * - feedBreak：自然断句点（tool-call / turn-complete）→ 尾巴也送合成
 * - silence：interrupt / 换课 / 停止 → 立刻闭嘴（停播 + 清队列 + 断句重置）
 * 静音偏好由页面持久化（localStorage），setMuted 即清队。
 */

import { useCallback, useRef, useState } from 'react';
import { SentenceSplitter, TeachSpeechPlayer } from './speech-pipeline';

export interface UseTeachSpeechResult {
  /** 老师正在出声 */
  speaking: boolean;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** 用户手势里同步调用（新开一课/发送）：激活程序化播放 */
  unlockAudio: () => void;
  feedDelta: (delta: string) => void;
  feedBreak: () => void;
  silence: () => void;
  /** 语音链路是否活着（已激活且未静音）——不活时板书不设卡 */
  isAudioActive: () => boolean;
  /** 已入队句子的最新序号（板书动作锚"前面最后一句"） */
  lastSeq: () => number;
}

export function useTeachSpeech(onSentenceStart?: (seq: number) => void): UseTeachSpeechResult {
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMutedState] = useState(false);
  const playerRef = useRef<TeachSpeechPlayer | null>(null);
  const splitterRef = useRef<SentenceSplitter | null>(null);
  // 回调走 ref：player 懒构造一次，调用方后续渲染给的新回调不丢
  const sentenceStartRef = useRef(onSentenceStart);
  sentenceStartRef.current = onSentenceStart;

  const ensurePlayer = useCallback((): TeachSpeechPlayer => {
    playerRef.current ??= new TeachSpeechPlayer({
      onSpeakingChange: setSpeaking,
      onSentenceStart: (seq) => sentenceStartRef.current?.(seq),
    });
    return playerRef.current;
  }, []);
  const ensureSplitter = useCallback((): SentenceSplitter => {
    splitterRef.current ??= new SentenceSplitter();
    return splitterRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    ensurePlayer().unlock();
  }, [ensurePlayer]);

  const setMuted = useCallback(
    (value: boolean) => {
      setMutedState(value);
      ensurePlayer().setMuted(value);
    },
    [ensurePlayer],
  );

  const silence = useCallback(() => {
    playerRef.current?.stopAll();
    splitterRef.current?.reset();
  }, []);

  const feedDelta = useCallback(
    (delta: string) => {
      for (const sentence of ensureSplitter().push(delta)) {
        ensurePlayer().enqueue(sentence);
      }
    },
    [ensurePlayer, ensureSplitter],
  );

  const feedBreak = useCallback(() => {
    const sentence = ensureSplitter().flush();
    if (sentence) ensurePlayer().enqueue(sentence);
  }, [ensurePlayer, ensureSplitter]);

  const isAudioActive = useCallback(() => playerRef.current?.isActive ?? false, []);
  const lastSeq = useCallback(() => playerRef.current?.lastSeq ?? 0, []);

  return { speaking, muted, setMuted, unlockAudio, feedDelta, feedBreak, silence, isAudioActive, lastSeq };
}
