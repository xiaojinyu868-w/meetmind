/**
 * useRecording - 录音控制 Hook
 * 
 * 管理录音状态和操作
 */

import { useState, useCallback } from 'react';
import { generateSessionId } from '@/lib/db';
import { classroomDataService } from '@/lib/services/classroom-data-service';
import { anchorService } from '@/lib/services/anchor-service';

interface UseRecordingOptions {
  studentId: string;
  onSessionCreate?: (sessionId: string) => void;
  onRecordingStop?: (blob?: Blob, segments?: import('@/types').TranscriptSegment[]) => void;
}

interface UseRecordingReturn {
  isRecording: boolean;
  sessionId: string;
  setSessionId: React.Dispatch<React.SetStateAction<string>>;
  startRecording: () => string;
  stopRecording: (blob?: Blob) => void;
  resetSession: () => string;
}

export function useRecording(options: UseRecordingOptions): UseRecordingReturn {
  const { studentId, onSessionCreate, onRecordingStop } = options;
  
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string>('demo-session');

  // 开始录音
  const startRecording = useCallback((): string => {
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    setIsRecording(true);
    
    // 清空旧的锚点
    anchorService.clear(newSessionId);
    
    // 创建课程会话记录 (供教师端读取)
    classroomDataService.saveSession({
      id: newSessionId,
      status: 'recording',
      duration: 0,
      createdBy: studentId,
    });
    
    onSessionCreate?.(newSessionId);
    
    return newSessionId;
  }, [studentId, onSessionCreate]);

  // 停止录音
  const stopRecording = useCallback((blob?: Blob) => {
    setIsRecording(false);
    onRecordingStop?.(blob);
  }, [onRecordingStop]);

  // 重置会话
  const resetSession = useCallback((): string => {
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    setIsRecording(false);
    anchorService.clear(newSessionId);
    return newSessionId;
  }, []);

  return {
    isRecording,
    sessionId,
    setSessionId,
    startRecording,
    stopRecording,
    resetSession,
  };
}
