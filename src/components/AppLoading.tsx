'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Image from 'next/image';

interface AppLoadingProps {
  /** 外部传入的真实进度 0-100，如果不传则显示 indeterminate 动画 */
  progress?: number;
  /** 可选的状态文字 */
  message?: string;
  /** 加载完成回调 */
  onComplete?: () => void;
}

// 动态加载文案 - 更丰富的阶段提示
const LOADING_MESSAGES = [
  { min: 0, max: 15, texts: ['正在启动...', '初始化中...'] },
  { min: 15, max: 35, texts: ['连接服务...', '检查环境...', '准备资源...'] },
  { min: 35, max: 55, texts: ['加载数据...', '同步状态...', '配置完成...'] },
  { min: 55, max: 75, texts: ['渲染界面...', '优化体验...', '即将就绪...'] },
  { min: 75, max: 95, texts: ['最后准备...', '马上就好...', '几乎完成...'] },
  { min: 95, max: 100, texts: ['加载完成！', '准备就绪！'] },
];

/**
 * 应用加载页 - 增强版
 * 
 * 优化点：
 * 1. 平滑的进度过渡动画
 * 2. 动态切换的阶段文案
 * 3. 脉冲呼吸效果，消除"卡住"感
 * 4. 缩短完成延迟（200ms → 50ms）
 * 5. 进度条流光效果增强
 */
export function AppLoading({ progress, message, onComplete }: AppLoadingProps) {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [dynamicMessage, setDynamicMessage] = useState('正在启动...');
  const lastMessageChangeTime = useRef(0);
  const messageIndexRef = useRef(0);
  
  // 平滑过渡进度值 - 使用 requestAnimationFrame 实现更流畅的动画
  useEffect(() => {
    if (progress === undefined) return;
    
    // 进度值平滑过渡
    const animate = () => {
      setDisplayProgress(prev => {
        const diff = progress - prev;
        if (Math.abs(diff) < 0.5) return progress;
        // 使用 easeOut 效果
        return prev + diff * 0.15;
      });
    };
    
    // 使用 requestAnimationFrame 实现 60fps 动画
    let frameId: number;
    const loop = () => {
      animate();
      if (Math.abs(displayProgress - progress) > 0.5) {
        frameId = requestAnimationFrame(loop);
      }
    };
    frameId = requestAnimationFrame(loop);
    
    return () => cancelAnimationFrame(frameId);
  }, [progress, displayProgress]);
  
  // 动态文案切换 - 每 1.5 秒切换一次，避免静止感
  const updateDynamicMessage = useCallback(() => {
    if (message) return; // 如果有外部消息，不切换
    
    const now = Date.now();
    if (now - lastMessageChangeTime.current < 1500) return;
    
    const currentProgress = displayProgress;
    const stage = LOADING_MESSAGES.find(
      s => currentProgress >= s.min && currentProgress < s.max
    ) || LOADING_MESSAGES[LOADING_MESSAGES.length - 1];
    
    // 循环切换当前阶段的文案
    messageIndexRef.current = (messageIndexRef.current + 1) % stage.texts.length;
    setDynamicMessage(stage.texts[messageIndexRef.current]);
    lastMessageChangeTime.current = now;
  }, [displayProgress, message]);
  
  // 定时更新文案
  useEffect(() => {
    const interval = setInterval(updateDynamicMessage, 1500);
    return () => clearInterval(interval);
  }, [updateDynamicMessage]);
  
  // 进度达到 100% 时触发完成回调 - 缩短延迟
  useEffect(() => {
    if (progress === 100 && onComplete) {
      // 缩短延迟：50ms 让用户看到完成状态，然后快速淡出
      const timer = setTimeout(() => {
        setIsFadingOut(true);
        // 淡出动画 200ms 后调用 onComplete
        setTimeout(() => {
          onComplete();
        }, 200);
      }, 50);
      
      return () => clearTimeout(timer);
    }
  }, [progress, onComplete]);

  // 是否为 indeterminate 模式（外部未传入进度）
  const isIndeterminate = progress === undefined;

  // 状态文字：优先使用外部消息，否则使用动态消息
  const statusText = message || dynamicMessage;

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col overflow-hidden transition-opacity duration-200 ${
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
          <div className="relative h-2 bg-white/20 rounded-full overflow-hidden backdrop-blur-sm">
            {isIndeterminate ? (
              /* Indeterminate 动画 - 双向流动效果 */
              <>
                <div 
                  className="absolute inset-y-0 w-1/3 rounded-full animate-indeterminate"
                  style={{
                    background: 'linear-gradient(90deg, transparent 0%, #D4A574 50%, transparent 100%)',
                  }}
                />
                <div 
                  className="absolute inset-y-0 w-1/4 rounded-full animate-indeterminate-reverse"
                  style={{
                    background: 'linear-gradient(90deg, transparent 0%, #E8C4A0 50%, transparent 100%)',
                    opacity: 0.5,
                  }}
                />
              </>
            ) : (
              /* 真实进度条 */
              <div 
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${displayProgress}%`,
                  background: 'linear-gradient(90deg, #E8C4A0 0%, #D4A574 50%, #C4956A 100%)',
                  boxShadow: '0 0 12px rgba(212, 165, 116, 0.7)',
                  transition: 'width 0.1s ease-out',
                }}
              >
                {/* 流光效果 - 加速 */}
                <div 
                  className="absolute inset-0 rounded-full animate-shimmer"
                  style={{
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
                    backgroundSize: '200% 100%'
                  }}
                />
                {/* 末端脉冲光点 */}
                <div 
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full animate-pulse-glow"
                  style={{
                    background: 'radial-gradient(circle, #fff 0%, #D4A574 70%, transparent 100%)',
                  }}
                />
              </div>
            )}
          </div>
          
          {/* 状态信息 */}
          <div className="flex justify-between items-center mt-3">
            <div className="flex items-center gap-2">
              {/* 加载指示点 - 脉冲效果 */}
              <div className="flex gap-1">
                <span 
                  className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse-dot"
                  style={{ animationDelay: '0ms' }}
                />
                <span 
                  className="w-1.5 h-1.5 rounded-full bg-amber-200 animate-pulse-dot"
                  style={{ animationDelay: '200ms' }}
                />
                <span 
                  className="w-1.5 h-1.5 rounded-full bg-amber-100 animate-pulse-dot"
                  style={{ animationDelay: '400ms' }}
                />
              </div>
              {/* 文案切换动画 */}
              <span 
                className="text-sm text-white/90 font-medium transition-opacity duration-300"
                key={statusText} // key 变化触发重新渲染动画
              >
                {statusText}
              </span>
            </div>
            {!isIndeterminate && (
              <span className="text-sm font-semibold text-amber-300 tabular-nums min-w-[3rem] text-right">
                {Math.round(displayProgress)}%
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
        
        @keyframes indeterminate-reverse {
          0% {
            right: -25%;
          }
          100% {
            right: 100%;
          }
        }
        
        @keyframes pulse-glow {
          0%, 100% {
            opacity: 1;
            transform: translateY(-50%) scale(1);
          }
          50% {
            opacity: 0.6;
            transform: translateY(-50%) scale(1.3);
          }
        }
        
        @keyframes pulse-dot {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.4;
            transform: scale(0.8);
          }
        }
        
        .animate-shimmer {
          animation: shimmer 1.2s linear infinite;
        }
        
        .animate-indeterminate {
          animation: indeterminate 1.2s ease-in-out infinite;
        }
        
        .animate-indeterminate-reverse {
          animation: indeterminate-reverse 1.8s ease-in-out infinite;
        }
        
        .animate-pulse-glow {
          animation: pulse-glow 1s ease-in-out infinite;
        }
        
        .animate-pulse-dot {
          animation: pulse-dot 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default AppLoading;
