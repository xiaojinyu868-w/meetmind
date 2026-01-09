'use client';

import { useState, useRef, useCallback } from 'react';
import type { TranscriptSegment } from '@/types';

interface AudioUploaderProps {
  onTranscriptReady: (segments: TranscriptSegment[], audioBlob: Blob) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

type UploadStatus = 'idle' | 'uploading' | 'transcribing' | 'success' | 'error';

export function AudioUploader({ onTranscriptReady, onError, disabled }: AudioUploaderProps) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    // 验证文件类型
    const validTypes = ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/m4a', 'audio/x-m4a'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|webm|ogg|m4a)$/i)) {
      const error = '不支持的文件格式，请上传 MP3、WAV、WebM、OGG 或 M4A 文件';
      setErrorMessage(error);
      setStatus('error');
      onError?.(error);
      return;
    }

    // 验证文件大小（最大 100MB）
    if (file.size > 100 * 1024 * 1024) {
      const error = '文件过大，最大支持 100MB';
      setErrorMessage(error);
      setStatus('error');
      onError?.(error);
      return;
    }

    setFileName(file.name);
    setStatus('uploading');
    setProgress(10);
    setErrorMessage('');

    try {
      // 直接同步转录，不再区分长短音频
      setStatus('transcribing');
      setProgress(30);

      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      setProgress(70);

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || '转录失败');
      }

      // 转换为 TranscriptSegment 格式
      const segments: TranscriptSegment[] = (data.segments || data.sentences || []).map(
        (s: { id?: string; text: string; startMs?: number; endMs?: number; beginTime?: number; endTime?: number }, i: number) => ({
          id: s.id || `seg-${i}`,
          text: s.text,
          startMs: s.startMs ?? s.beginTime ?? 0,
          endMs: s.endMs ?? s.endTime ?? 0,
          confidence: 0.9,
        })
      );

      // 创建音频 Blob
      const audioBlob = new Blob([await file.arrayBuffer()], { type: file.type });

      setStatus('success');
      setProgress(100);
      onTranscriptReady(segments, audioBlob);

    } catch (error) {
      const message = error instanceof Error ? error.message : '上传或转录失败';
      setErrorMessage(message);
      setStatus('error');
      onError?.(message);
    }
  }, [onTranscriptReady, onError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (disabled || status === 'uploading' || status === 'transcribing') return;

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [disabled, status, handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleClick = useCallback(() => {
    if (disabled || status === 'uploading' || status === 'transcribing') return;
    fileInputRef.current?.click();
  }, [disabled, status]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleReset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setErrorMessage('');
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mp3,audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/m4a,.mp3,.wav,.webm,.ogg,.m4a"
        onChange={handleInputChange}
        className="hidden"
      />

      {status === 'idle' && (
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`
            border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
            transition-all duration-200
            ${disabled 
              ? 'border-gray-200 bg-gray-50 cursor-not-allowed' 
              : 'border-blue-200 hover:border-blue-400 hover:bg-blue-50/50'
            }
          `}
        >
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-gray-700 font-medium mb-1">点击或拖拽上传音频文件</p>
          <p className="text-sm text-gray-500">支持 MP3、WAV、WebM、OGG、M4A 格式，最大 100MB</p>
        </div>
      )}

      {(status === 'uploading' || status === 'transcribing') && (
        <div className="border rounded-xl p-6 bg-blue-50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <div>
              <p className="font-medium text-gray-900">{fileName}</p>
              <p className="text-sm text-blue-600">
                {status === 'uploading' ? '正在上传...' : '正在转录，请稍候...'}
              </p>
            </div>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2 text-right">{progress}%</p>
        </div>
      )}

      {status === 'success' && (
        <div className="border rounded-xl p-6 bg-green-50 border-green-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900">{fileName}</p>
                <p className="text-sm text-green-600">转录完成！</p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              上传新文件
            </button>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="border rounded-xl p-6 bg-red-50 border-red-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-gray-900">上传失败</p>
                <p className="text-sm text-red-600">{errorMessage}</p>
              </div>
            </div>
            <button
              onClick={handleReset}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              重试
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
