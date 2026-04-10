'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useCollectionStore } from '@/stores/collection-store';
import { toast } from 'sonner';
import type { SourceIngestItem } from '@/types/page-types';

// ── Hook ───────────────────────────────────────────────────────────

/**
 * Manages audio message playback in the collection feed.
 * Handles play/pause/stop lifecycle and syncs playback state to the collection store.
 *
 * Returns:
 * - `stopAudioMessagePlayback` — stop current audio
 * - `toggleAudioMessagePlayback` — play/pause/toggle for a given source item
 * - `audioPlaybackRef` — ref to the current HTMLAudioElement (for external stop needs)
 */
export function useAudioMessagePlayback() {
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);

  // Read reactive state
  const playingAudioMessageId = useCollectionStore((s) => s.playingAudioMessageId);

  const stopAudioMessagePlayback = useCallback(() => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current.src = '';
      audioPlaybackRef.current = null;
    }
    const colAct = useCollectionStore.getState().actions;
    colAct.setPlayingAudioMessageId(null);
    colAct.setAudioPlaybackState(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioPlaybackRef.current) {
        audioPlaybackRef.current.pause();
        audioPlaybackRef.current.src = '';
        audioPlaybackRef.current = null;
      }
    };
  }, []);

  const toggleAudioMessagePlayback = useCallback(async (item: SourceIngestItem) => {
    if (!item.mediaUrl) return;
    const colAct = useCollectionStore.getState().actions;

    if (playingAudioMessageId === item.id && audioPlaybackRef.current) {
      if (audioPlaybackRef.current.paused) {
        try {
          await audioPlaybackRef.current.play();
          colAct.setPlayingAudioMessageId(item.id);
        } catch (error) {
          console.error('[audio.playback.resume]', error);
        }
      } else {
        audioPlaybackRef.current.pause();
        colAct.setPlayingAudioMessageId(null);
      }
      return;
    }

    stopAudioMessagePlayback();

    try {
      const audio = new Audio(item.mediaUrl);
      audioPlaybackRef.current = audio;

      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (duration > 0) {
          const durationMs = Math.round(duration * 1000);
          if (!item.durationMs || Math.abs(item.durationMs - durationMs) > 400) {
            colAct.setSourceItems((prev: SourceIngestItem[]) =>
              prev.map((currentItem) =>
                currentItem.id === item.id ? { ...currentItem, durationMs } : currentItem
              )
            );
          }
        }
        colAct.setAudioPlaybackState({
          id: item.id,
          progress: 0,
          currentTime: 0,
          duration,
        });
      };

      audio.ontimeupdate = () => {
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : item.durationMs ? item.durationMs / 1000 : 0;
        const currentTimeVal = audio.currentTime || 0;
        colAct.setAudioPlaybackState({
          id: item.id,
          progress: duration > 0 ? Math.min(1, currentTimeVal / duration) : 0,
          currentTime: currentTimeVal,
          duration,
        });
      };

      audio.onended = () => {
        colAct.setPlayingAudioMessageId(null);
        colAct.setAudioPlaybackState((prev) =>
          prev?.id === item.id
            ? {
                ...prev,
                progress: 0,
                currentTime: 0,
              }
            : prev
        );
      };

      await audio.play();
      colAct.setPlayingAudioMessageId(item.id);
    } catch (error) {
      console.error('[audio.playback.start]', error);
      stopAudioMessagePlayback();
      toast.error('这段原声暂时无法播放，请稍后再试。');
    }
  }, [playingAudioMessageId, stopAudioMessagePlayback]);

  return {
    stopAudioMessagePlayback,
    toggleAudioMessagePlayback,
    audioPlaybackRef,
  };
}
