'use client';

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { ConfusionMoment } from '@/lib/services/parent-service';

interface TeacherAudioPlayerProps {
  confusion: ConfusionMoment | null;
  audioUrl?: string;
  onClose: () => void;
  className?: string;
}

export function TeacherAudioPlayer({
  confusion,
  audioUrl,
  onClose,
  className,
}: TeacherAudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);
  
  // 格式化时间
  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // 播放/暂停
  const togglePlay = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };
  
  // 切换倍速
  const toggleSpeed = () => {
    const speeds = [1, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const newSpeed = speeds[nextIndex];
    setPlaybackRate(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };
  
  // 进度更新
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime * 1000);
    };
    
    const handleLoadedMetadata = () => {
      setDuration(audio.duration * 1000);
    };
    
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);
  
  // 没有选中的困惑点时不渲染
  if (!confusion) return null;
  
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  
  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/20 z-40 animate-fade-in"
        onClick={onClose}
      />
      
      {/* 播放器面板 */}
      <div
        className={cn(
          'fixed bottom-0 left-0 right-0 z-50',
          'bg-white rounded-t-3xl shadow-2xl',
          'transform transition-transform duration-300 ease-out',
          'animate-slide-up',
          className
        )}
      >
        {/* 拖动条 */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1 bg-gray-200 rounded-full" />
        </div>
        
        {/* 播放器内容 */}
        <div className="px-6 pb-8 pt-2">
          {/* 标题 */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-800">
                老师原话
              </h3>
              <p className="text-sm text-gray-500">
                {confusion.subject} · {confusion.knowledgePoint}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* 转录文字 */}
          {confusion.transcriptContext && (
            <div className="mb-6 p-4 bg-amber-50 rounded-2xl border border-amber-100">
              <p className="text-sm text-gray-700 leading-relaxed">
                "{confusion.transcriptContext}"
              </p>
            </div>
          )}
          
          {/* 进度条 */}
          <div className="mb-4">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-gray-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>
          
          {/* 控制按钮 */}
          <div className="flex items-center justify-center gap-6">
            {/* 倍速按钮 */}
            <button
              onClick={toggleSpeed}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium',
                'bg-gray-100 text-gray-600',
                'hover:bg-gray-200 transition-colors'
              )}
            >
              {playbackRate}x
            </button>
            
            {/* 播放/暂停按钮 */}
            <button
              onClick={togglePlay}
              className={cn(
                'w-16 h-16 rounded-full',
                'bg-gradient-to-br from-amber-400 to-orange-500',
                'flex items-center justify-center',
                'shadow-lg hover:shadow-xl',
                'transition-all duration-200',
                'active:scale-95'
              )}
            >
              {isPlaying ? (
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-7 h-7 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            
            {/* 占位，保持对称 */}
            <div className="w-12" />
          </div>
        </div>
        
        {/* 隐藏的 audio 元素 */}
        <audio
          ref={audioRef}
          src={audioUrl || '/demo-audio.mp3'}
          preload="metadata"
        />
      </div>
    </>
  );
}
