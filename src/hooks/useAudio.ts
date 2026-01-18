/**
 * useAudio - 音频播放控制 Hook
 * 
 * 管理音频播放状态和控制
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { WaveformPlayerRef } from '@/components/WaveformPlayer';

interface UseAudioOptions {
  onTimeUpdate?: (currentTime: number) => void;
}

interface UseAudioReturn {
  audioUrl: string | null;
  audioBlob: Blob | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  waveformRef: React.RefObject<WaveformPlayerRef>;
  setAudioUrl: (url: string | null) => void;
  setAudioBlob: (blob: Blob | null) => void;
  setCurrentTime: (time: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
}

export function useAudio(options: UseAudioOptions = {}): UseAudioReturn {
  const { onTimeUpdate } = options;
  
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTimeState] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const waveformRef = useRef<WaveformPlayerRef>(null);

  // 设置当前时间
  const setCurrentTime = useCallback((time: number) => {
    setCurrentTimeState(time);
    onTimeUpdate?.(time);
  }, [onTimeUpdate]);

  // 播放
  const play = useCallback(() => {
    if (waveformRef.current) {
      waveformRef.current.play();
      setIsPlaying(true);
    }
  }, []);

  // 暂停
  const pause = useCallback(() => {
    if (waveformRef.current) {
      waveformRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  // 切换播放/暂停
  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // 跳转到指定时间
  const seekTo = useCallback((time: number) => {
    if (waveformRef.current) {
      waveformRef.current.seekTo(time / 1000); // 转换为秒
      setCurrentTime(time);
    }
  }, [setCurrentTime]);

  // 设置播放速度
  const setPlaybackRate = useCallback((rate: number) => {
    if (waveformRef.current) {
      waveformRef.current.setPlaybackRate(rate);
    }
  }, []);

  // 从 Blob 创建 URL
  useEffect(() => {
    if (audioBlob && !audioUrl) {
      const url = URL.createObjectURL(audioBlob);
      setAudioUrl(url);
      
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [audioBlob, audioUrl]);

  return {
    audioUrl,
    audioBlob,
    isPlaying,
    currentTime,
    duration,
    waveformRef,
    setAudioUrl,
    setAudioBlob,
    setCurrentTime,
    play,
    pause,
    toggle,
    seekTo,
    setPlaybackRate,
  };
}
