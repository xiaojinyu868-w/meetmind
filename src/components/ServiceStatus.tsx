'use client';

// 服务状态指示器组件
// 显示外部服务连接状态

import { useState, useEffect } from 'react';
import { checkServices, type ServiceStatus as ServiceStatusType } from '@/lib/services/health-check';

interface ServiceStatusProps {
  /** 轮询间隔（毫秒），0 表示不轮询 */
  pollInterval?: number;
  /** 是否显示详细信息 */
  showDetails?: boolean;
  /** 紧凑模式 */
  compact?: boolean;
}

export function ServiceStatus({ 
  pollInterval = 30000, 
  showDetails = false,
  compact = false,
}: ServiceStatusProps) {
  const [status, setStatus] = useState<ServiceStatusType | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      setIsChecking(true);
      try {
        const result = await checkServices();
        setStatus(result);
      } catch (error) {
        console.error('Health check failed:', error);
      } finally {
        setIsChecking(false);
      }
    };

    check();

    if (pollInterval > 0) {
      const interval = setInterval(check, pollInterval);
      return () => clearInterval(interval);
    }
  }, [pollInterval]);

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <div className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
        <span className="text-xs">检查服务...</span>
      </div>
    );
  }

  // 紧凑模式：只显示圆点
  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <div 
          className={`w-2 h-2 rounded-full ${status.discussion ? 'bg-green-500' : 'bg-gray-400'}`}
          title={status.discussion ? '通义听悟已连接' : '通义听悟未连接'}
        />
        <div 
          className={`w-2 h-2 rounded-full ${status.notebook ? 'bg-green-500' : 'bg-gray-400'}`}
          title={status.notebook ? 'Open Notebook 已连接' : 'Open Notebook 未连接'}
        />
      </div>
    );
  }

  // 标准模式
  return (
    <div className="flex items-center gap-3">
      {/* Discussion 状态 */}
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${
          isChecking ? 'bg-yellow-500 animate-pulse' :
          status.discussion ? 'bg-green-500' : 'bg-gray-400'
        }`} />
        <span className="text-xs text-gray-600">
          {status.discussion ? '通义听悟' : '本地识别'}
        </span>
      </div>

      {/* Notebook 状态 */}
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${
          isChecking ? 'bg-yellow-500 animate-pulse' :
          status.notebook ? 'bg-green-500' : 'bg-gray-400'
        }`} />
        <span className="text-xs text-gray-600">
          {status.notebook ? '向量搜索' : '本地搜索'}
        </span>
      </div>

      {/* 详细信息 */}
      {showDetails && (
        <div className="flex items-center gap-2 text-xs text-gray-400 border-l border-gray-200 pl-3">
          <span>WebSpeech: {status.webSpeech ? '✓' : '✗'}</span>
          <span>IndexedDB: {status.indexedDB ? '✓' : '✗'}</span>
        </div>
      )}
    </div>
  );
}

/**
 * 降级提示横幅
 */
export function DegradedModeBanner({ 
  status 
}: { 
  status: ServiceStatusType | null 
}) {
  if (!status) return null;
  
  // 如果所有服务都可用，不显示横幅
  if (status.discussion && status.notebook) return null;

  const messages: string[] = [];
  
  if (!status.discussion) {
    if (status.webSpeech) {
      messages.push('正在使用浏览器本地语音识别，精度可能较低');
    } else {
      messages.push('语音转录功能不可用');
    }
  }
  
  if (!status.notebook) {
    messages.push('向量搜索不可用，使用本地关键词搜索');
  }

  if (messages.length === 0) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
      <div className="flex items-center gap-2 text-amber-800 text-sm">
        <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <span>{messages.join(' · ')}</span>
        <span className="text-amber-600 text-xs">
          启动后端服务可获得完整体验
        </span>
      </div>
    </div>
  );
}
