'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

interface AppLoadingProps {
  /** 外部传入的真实进度 0-100，如果不传则显示 indeterminate 动画 */
  progress?: number;
  /** 可选的状态文字 */
  message?: string;
  /** 加载完成回调 */
  onComplete?: () => void;
}

/**
 * 应用加载页
 * 使用品牌图片背景 + 底部真实进度条
 * 进度由外部 props 控制，反映实际的数据加载状态
 */
export function AppLoading({ progress, message, onComplete }: AppLoadingProps) {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);
  
  // 平滑过渡进度值
  useEffect(() => {
    if (progress === undefined) return;
    
    // 使用 CSS transition 处理平滑过渡，这里只更新目标值
    setDisplayProgress(progress);
  }, [progress]);
  
  // 进度达到 100% 时触发完成回调
  useEffect(() => {
    if (progress === 100 && onComplete) {
      // 短暂延迟让用户看到 100%，然后淡出
      const timer = setTimeout(() => {
        setIsFadingOut(true);
        // 淡出动画完成后调用 onComplete
        setTimeout(() => {
          onComplete();
        }, 300);
      }, 200);
      
      return () => clearTimeout(timer);
    }
  }, [progress, onComplete]);

  // 是否为 indeterminate 模式（外部未传入进度）
  const isIndeterminate = progress === undefined;

  // 状态文字
  const statusText = message || (
    isIndeterminate ? '加载中...' :
    displayProgress < 30 ? '初始化应用...' :
    displayProgress < 60 ? '准备学习环境...' :
    displayProgress < 90 ? '即将就绪...' :
    '加载完成'
  );

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden transition-opacity duration-300 ${
        isFadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* 品牌图片背景 */}
      <div className="relative flex-1 w-full">
        <Image
          src="/videos/加载页.jpg"
          alt="MeetMind - 你的第一个AI同桌"
          fill
          priority
          className="object-cover object-center"
          sizes="100vw"
        />
        
        {/* 底部渐变遮罩，让进度条区域更清晰 */}
        <div 
          className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)'
          }}
        />
      </div>

      {/* 底部进度条区域 */}
      <div className="absolute bottom-0 left-0 right-0 px-6 pb-8 pt-4">
        {/* 进度条容器 */}
        <div className="max-w-md mx-auto">
          {/* 进度条 */}
          <div className="relative h-1.5 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
            {isIndeterminate ? (
              /* Indeterminate 动画 */
              <div 
                className="absolute inset-y-0 w-1/3 rounded-full animate-indeterminate"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, #D4A574 50%, transparent 100%)',
                }}
              />
            ) : (
              /* 真实进度条 */
              <div 
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${displayProgress}%`,
                  background: 'linear-gradient(90deg, #E8C4A0 0%, #D4A574 50%, #C4956A 100%)',
                  boxShadow: '0 0 10px rgba(212, 165, 116, 0.6)'
                }}
              >
                {/* 流光效果 */}
                <div 
                  className="absolute inset-0 rounded-full animate-shimmer"
                  style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                    backgroundSize: '200% 100%'
                  }}
                />
              </div>
            )}
          </div>
          
          {/* 状态信息 */}
          <div className="flex justify-between items-center mt-3">
            <div className="flex items-center gap-2">
              {/* 加载指示点 */}
              <div className="flex gap-1">
                <span 
                  className="w-1 h-1 rounded-full bg-amber-300 animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span 
                  className="w-1 h-1 rounded-full bg-amber-200 animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span 
                  className="w-1 h-1 rounded-full bg-amber-100 animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <span className="text-sm text-white/90 font-medium">
                {statusText}
              </span>
            </div>
            {!isIndeterminate && (
              <span className="text-sm font-semibold text-amber-300 tabular-nums">
                {displayProgress}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 自定义动画样式 */}
      <style jsx>{`
        @keyframes shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
        
        @keyframes indeterminate {
          0% {
            left: -33%;
          }
          100% {
            left: 100%;
          }
        }
        
        .animate-shimmer {
          animation: shimmer 2s linear infinite;
        }
        
        .animate-indeterminate {
          animation: indeterminate 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default AppLoading;
