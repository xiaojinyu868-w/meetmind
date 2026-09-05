'use client';

/**
 * useTeachBackVoice — 「讲给同桌听」半双工语音的 hook 封装。
 *
 * 学生每讲完一段（语音转写或打字，submitUserSegment）：
 *   1. 同步 push { role:'user' } 到 turnsRef（与 /api/apps/teach-back/evaluate 共享记录）
 *   2. 调 /api/apps/teach-back/respond 让同桌（AI 学生）决定开口还是安静
 *   3. 同桌开口 → say push { role:'assistant' } + 经 useTeachSpeech 走 /api/teach/tts 出声
 * 同桌不开口（say=null / 请求失败）都静默——讲课流不该被打断。
 *
 * 并发纪律：用户连续提交两段时按递增 requestId 丢弃过期响应（只收最新一段的应答）。
 */

import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import { useTeachSpeech } from '@/components/teach/useTeachSpeech';

/** 短于 10 字的段落不值得惊动同桌（「嗯」「然后」之类） */
const MIN_SEGMENT_CHARS = 10;

export interface UseTeachBackVoiceInput {
  turnsRef: MutableRefObject<TeachBackTurn[]>;
  targets: TeachBackTarget[];
  metadata?: { title?: string };
}

export interface UseTeachBackVoiceResult {
  /** 同桌正在出声 */
  speaking: boolean;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  /** 同桌说过的最近 3 条（新→旧） */
  deskmateLines: string[];
  /** 用户手势里同步调用（「走上讲台」）：激活程序化播放 */
  unlockAudio: () => void;
  /** 学生讲完一段：记入讲述记录，并请同桌应答 */
  submitUserSegment: (text: string) => void;
  /** 立刻闭嘴（开始录音 / 离开教室 / 重讲） */
  silence: () => void;
  /** 结果页 headline 朗读用（透传 useTeachSpeech） */
  feedDelta: (delta: string) => void;
  feedBreak: () => void;
}

export function useTeachBackVoice({ turnsRef, targets, metadata }: UseTeachBackVoiceInput): UseTeachBackVoiceResult {
  const speech = useTeachSpeech();
  const [deskmateLines, setDeskmateLines] = useState<string[]>([]);
  const respondRequestRef = useRef(0);
  // 回调走 ref：submitUserSegment 保持稳定引用，调用方后续渲染给的新值不丢
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;

  const submitUserSegment = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      turnsRef.current = [...turnsRef.current, { role: 'user', text: trimmed }];
      if (trimmed.length < MIN_SEGMENT_CHARS) return;

      const requestId = ++respondRequestRef.current;
      void (async () => {
        try {
          const response = await fetch('/api/apps/teach-back/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targets: targetsRef.current,
              teachingTurns: turnsRef.current,
              metadata: metadataRef.current,
            }),
          });
          const data = (await response.json().catch(() => null)) as { ok?: boolean; say?: string | null } | null;
          if (respondRequestRef.current !== requestId) return;
          const say = response.ok && data?.ok && typeof data.say === 'string' ? data.say.trim() : '';
          if (!say) return;
          turnsRef.current = [...turnsRef.current, { role: 'assistant', text: say }];
          setDeskmateLines((lines) => [say, ...lines].slice(0, 3));
          speech.feedDelta(say);
          speech.feedBreak();
        } catch {
          /* 同桌没应声不是错误——安静等下一段 */
        }
      })();
    },
    [turnsRef, speech],
  );

  const silence = useCallback(() => {
    respondRequestRef.current += 1;
    speech.silence();
  }, [speech]);

  return {
    speaking: speech.speaking,
    muted: speech.muted,
    setMuted: speech.setMuted,
    deskmateLines,
    unlockAudio: speech.unlockAudio,
    submitUserSegment,
    silence,
    feedDelta: speech.feedDelta,
    feedBreak: speech.feedBreak,
  };
}
