'use client';

import { useState, useRef, useCallback } from 'react';
import type { TranscriptSegment } from '@/types';

interface AudioUploaderProps {
  onTranscriptReady: (segments: TranscriptSegment[], audioBlob: Blob) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

type UploadStatus = 'idle' | 'uploading' | 'transcribing' | 'success' | 'error';
type TranscribeMode = 'fast' | 'standard';  // 快速模式（并行）或标准模式

export function AudioUploader({ onTranscriptReady, onError, disabled }: AudioUploaderProps) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const [transcribeMode, setTranscribeMode] = useState<TranscribeMode>('fast');
  const [processingInfo, setProcessingInfo] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const startTimeRef = useRef<number>(0);

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

    // 验证文件大小（最大 500MB for fast mode）
    const maxSize = transcribeMode === 'fast' ? 500 * 1024 * 1024 : 100 * 1024 * 1024;
    if (file.size > maxSize) {
      const error = `文件过大，最大支持 ${maxSize / 1024 / 1024}MB`;
      setErrorMessage(error);
      setStatus('error');
      onError?.(error);
      return;
    }

    setFileName(file.name);
    setStatus('uploading');
    setProgress(10);
    setErrorMessage('');
    setProcessingInfo('');
    startTimeRef.current = Date.now();

    try {
      setStatus('transcribing');
      setProgress(20);

      const formData = new FormData();
      formData.append('audio', file);

      // 根据模式选择 API
      const apiUrl = transcribeMode === 'fast' ? '/api/transcribe-fast' : '/api/transcribe';
      
      setProcessingInfo(transcribeMode === 'fast' 
        ? '并行处理中，速度更快...' 
        : '标准转录中...'
      );

      // 模拟进度更新
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 85) return prev;
          return prev + Math.random() * 5;
        });
      }, 2000);

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setProgress(90);

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

      // 计算处理时间
      const elapsedSec = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const audioDurationMin = data.totalDuration ? (data.totalDuration / 1000 / 60).toFixed(1) : '?';
      setProcessingInfo(`${audioDurationMin}分钟音频，${elapsedSec}秒完成`);

      setStatus('success');
      setProgress(100);
      onTranscriptReady(segments, audioBlob);

    } catch (error) {
      const message = error instanceof Error ? error.message : '上传或转录失败';
      setErrorMessage(message);
      setStatus('error');
      onError?.(message);
    }
  }, [onTranscriptReady, onError, transcribeMode]);

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
        <div className="space-y-4">
          {/* 模式选择 */}
          <div className="flex items-center justify-center gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={transcribeMode === 'fast'}
                onChange={() => setTranscribeMode('fast')}
                className="w-4 h-4 text-blue-500"
              />
              <span className="font-medium text-gray-700">快速模式</span>
              <span className="text-xs text-gray-400">（并行处理，推荐）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="mode"
                checked={transcribeMode === 'standard'}
                onChange={() => setTranscribeMode('standard')}
                className="w-4 h-4 text-gray-500"
              />
              <span className="text-gray-600">标准模式</span>
            </label>
          </div>
          
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
            <p className="text-sm text-gray-500">
              支持 MP3、WAV、WebM 等格式，最大 {transcribeMode === 'fast' ? '500' : '100'}MB
            </p>
            {transcribeMode === 'fast' && (
              <p className="text-xs text-blue-500 mt-2">
                快速模式：50分钟音频约1分钟完成
              </p>
            )}
          </div>
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
                {status === 'uploading' ? '正在上传...' : processingInfo || '正在转录，请稍候...'}
              </p>
            </div>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2 text-right">{Math.round(progress)}%</p>
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
                <p className="text-sm text-green-600">
                  转录完成！{processingInfo && <span className="text-gray-500 ml-1">({processingInfo})</span>}
                </p>
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
