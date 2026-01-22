'use client';

import { useEffect, useState, useRef, useMemo } from 'react';

interface AppLoadingProps {
  message?: string;
  onComplete?: () => void;
}

// 加载阶段配置
const LOADING_STAGES = [
  { progress: 15, text: '初始化应用', duration: 400 },
  { progress: 35, text: '加载核心模块', duration: 500 },
  { progress: 55, text: '准备学习环境', duration: 600 },
  { progress: 75, text: '连接 AI 服务', duration: 500 },
  { progress: 90, text: '优化体验', duration: 400 },
  { progress: 100, text: '即将就绪', duration: 300 },
];

// 粒子配置
interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  speed: number;
  angle: number;
}

export function AppLoading({ message, onComplete }: AppLoadingProps) {
  const [progress, setProgress] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [isLogoAnimated, setIsLogoAnimated] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const progressRef = useRef(0);
  const animationRef = useRef<number>();
  
  // 生成粒子 - 使用固定种子避免 hydration 不匹配
  const particles = useMemo<Particle[]>(() => {
    // 使用确定性的伪随机数，基于索引生成
    const seededRandom = (seed: number) => {
      const x = Math.sin(seed * 9999) * 10000;
      return x - Math.floor(x);
    };
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: seededRandom(i * 1) * 100,
      y: seededRandom(i * 2) * 100,
      size: seededRandom(i * 3) * 4 + 2,
      opacity: seededRandom(i * 4) * 0.3 + 0.1,
      speed: seededRandom(i * 5) * 20 + 10,
      angle: seededRandom(i * 6) * 360,
    }));
  }, []);

  // Logo 入场动画
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLogoAnimated(true);
    }, 100);
    
    const contentTimer = setTimeout(() => {
      setShowContent(true);
    }, 600);
    
    return () => {
      clearTimeout(timer);
      clearTimeout(contentTimer);
    };
  }, []);

  // 进度条动画 - 更真实的加载感知
  useEffect(() => {
    let stageTimeout: NodeJS.Timeout;
    let currentStage = 0;
    
    const advanceStage = () => {
      if (currentStage >= LOADING_STAGES.length) {
        // 完成动画
        setTimeout(() => {
          setIsFadingOut(true);
          setTimeout(() => {
            onComplete?.();
          }, 500);
        }, 200);
        return;
      }
      
      const stage = LOADING_STAGES[currentStage];
      const startProgress = progressRef.current;
      const targetProgress = stage.progress;
      const duration = stage.duration;
      const startTime = Date.now();
      
      setStageIndex(currentStage);
      
      // 平滑进度动画
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        // 使用 easeOutCubic 缓动
        const eased = 1 - Math.pow(1 - t, 3);
        const newProgress = startProgress + (targetProgress - startProgress) * eased;
        
        progressRef.current = newProgress;
        setProgress(Math.round(newProgress));
        
        if (t < 1) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          currentStage++;
          // 随机延迟模拟真实加载
          const delay = Math.random() * 200 + 100;
          stageTimeout = setTimeout(advanceStage, delay);
        }
      };
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    // 延迟开始加载动画
    const startTimer = setTimeout(advanceStage, 800);
    
    return () => {
      clearTimeout(startTimer);
      clearTimeout(stageTimeout);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [onComplete]);

  const currentStageText = message || LOADING_STAGES[stageIndex]?.text || '加载中';

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden transition-opacity duration-500 ${
        isFadingOut ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ 
        background: 'linear-gradient(135deg, #FEFCFB 0%, #FDF8F3 50%, #FCF5EE 100%)'
      }}
    >
      {/* 动态粒子背景 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute rounded-full animate-float"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              background: `rgba(212, 165, 116, ${particle.opacity})`,
              animationDuration: `${particle.speed}s`,
              animationDelay: `${-particle.id * 0.5}s`,
            }}
          />
        ))}
        
        {/* 渐变光晕 */}
        <div 
          className="absolute top-1/4 -right-20 w-96 h-96 rounded-full blur-3xl opacity-40 animate-pulse-slow"
          style={{ background: 'radial-gradient(circle, rgba(212, 165, 116, 0.3) 0%, transparent 70%)' }}
        />
        <div 
          className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full blur-3xl opacity-30 animate-pulse-slow"
          style={{ 
            background: 'radial-gradient(circle, rgba(168, 230, 207, 0.4) 0%, transparent 70%)',
            animationDelay: '1s'
          }}
        />
      </div>

      {/* 主要内容 */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo 动画容器 */}
        <div 
          className={`relative mb-12 transition-all duration-700 ease-out ${
            isLogoAnimated 
              ? 'opacity-100 transform translate-y-0 scale-100' 
              : 'opacity-0 transform -translate-y-8 scale-90'
          }`}
        >
          {/* 外层呼吸光环 */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div 
              className="w-32 h-32 rounded-full animate-breath"
              style={{ 
                background: 'radial-gradient(circle, rgba(212, 165, 116, 0.15) 0%, transparent 70%)',
              }}
            />
          </div>
          
          {/* 进度圆环 */}
          <svg className="w-28 h-28" viewBox="0 0 112 112">
            {/* 背景圆环 */}
            <circle
              cx="56"
              cy="56"
              r="50"
              fill="none"
              stroke="rgba(212, 165, 116, 0.15)"
              strokeWidth="6"
            />
            {/* 进度圆环 */}
            <circle
              cx="56"
              cy="56"
              r="50"
              fill="none"
              stroke="url(#loadingGradient)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${progress * 3.14} 314`}
              transform="rotate(-90 56 56)"
              className="transition-all duration-300 ease-out"
              style={{
                filter: 'drop-shadow(0 0 6px rgba(212, 165, 116, 0.4))'
              }}
            />
            {/* 圆环端点光点 */}
            {progress > 0 && (
              <circle
                cx="56"
                cy="6"
                r="3"
                fill="#D4A574"
                className="animate-pulse"
                transform={`rotate(${progress * 3.6 - 90} 56 56)`}
                style={{
                  filter: 'drop-shadow(0 0 4px rgba(212, 165, 116, 0.8))'
                }}
              />
            )}
            {/* 渐变定义 */}
            <defs>
              <linearGradient id="loadingGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#E8C4A0" />
                <stop offset="50%" stopColor="#D4A574" />
                <stop offset="100%" stopColor="#C4956A" />
              </linearGradient>
            </defs>
          </svg>
          
          {/* 中心 Logo */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div 
              className={`w-18 h-18 rounded-2xl flex items-center justify-center shadow-xl transition-all duration-500 ${
                isLogoAnimated ? 'animate-logo-bounce' : ''
              }`}
              style={{ 
                width: '72px',
                height: '72px',
                background: 'linear-gradient(135deg, #D4A574 0%, #C4956A 50%, #B8866A 100%)',
                boxShadow: '0 8px 32px rgba(212, 165, 116, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)'
              }}
            >
              <span 
                className="text-white text-3xl font-bold"
                style={{ textShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
              >
                M
              </span>
            </div>
          </div>
        </div>

        {/* 品牌名称 */}
        <div 
          className={`mb-10 text-center transition-all duration-700 delay-200 ${
            showContent 
              ? 'opacity-100 transform translate-y-0' 
              : 'opacity-0 transform translate-y-4'
          }`}
        >
          <h1 
            className="text-3xl font-bold bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 bg-clip-text text-transparent"
            style={{ letterSpacing: '0.02em' }}
          >
            MeetMind
          </h1>
          <p className="text-sm text-gray-500 mt-2 tracking-wide">
            智能课堂学习助手
          </p>
        </div>

        {/* 进度条区域 */}
        <div 
          className={`w-72 transition-all duration-700 delay-300 ${
            showContent 
              ? 'opacity-100 transform translate-y-0' 
              : 'opacity-0 transform translate-y-4'
          }`}
        >
          {/* 进度条 */}
          <div className="relative h-2.5 bg-gradient-to-r from-gray-100 to-gray-50 rounded-full overflow-hidden shadow-inner">
            {/* 背景纹理 */}
            <div 
              className="absolute inset-0 opacity-50"
              style={{
                backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px)'
              }}
            />
            {/* 进度填充 */}
            <div 
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #E8C4A0 0%, #D4A574 50%, #C4956A 100%)',
                boxShadow: '0 0 12px rgba(212, 165, 116, 0.5)'
              }}
            >
              {/* 光泽效果 */}
              <div 
                className="absolute inset-0 rounded-full"
                style={{
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 50%)'
                }}
              />
              {/* 流光动画 */}
              <div 
                className="absolute inset-0 rounded-full animate-shimmer"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                  backgroundSize: '200% 100%'
                }}
              />
            </div>
          </div>
          
          {/* 进度信息 */}
          <div className="flex justify-between items-center mt-3">
            <div className="flex items-center gap-2">
              {/* 加载指示器 */}
              <div className="flex gap-1">
                <span 
                  className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span 
                  className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce"
                  style={{ animationDelay: '150ms' }}
                />
                <span 
                  className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-bounce"
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <span 
                className="text-sm text-gray-500 transition-all duration-300"
                key={currentStageText}
              >
                {currentStageText}
              </span>
            </div>
            <span 
              className="text-sm font-semibold tabular-nums"
              style={{ 
                background: 'linear-gradient(135deg, #D4A574, #C4956A)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}
            >
              {progress}%
            </span>
          </div>
        </div>

        {/* 底部提示 */}
        <div 
          className={`mt-16 text-center transition-all duration-700 delay-500 ${
            showContent && progress > 50
              ? 'opacity-100 transform translate-y-0' 
              : 'opacity-0 transform translate-y-4'
          }`}
        >
          <p className="text-xs text-gray-400">
            {progress < 100 ? '首次加载可能需要几秒钟' : '加载完成，即将进入'}
          </p>
        </div>
      </div>

      {/* 自定义动画样式 */}
      <style jsx>{`
        @keyframes float {
          0%, 100% {
            transform: translateY(0) translateX(0);
          }
          25% {
            transform: translateY(-20px) translateX(10px);
          }
          50% {
            transform: translateY(-10px) translateX(-5px);
          }
          75% {
            transform: translateY(-25px) translateX(5px);
          }
        }
        
        @keyframes breath {
          0%, 100% {
            transform: scale(1);
            opacity: 0.6;
          }
          50% {
            transform: scale(1.2);
            opacity: 0.3;
          }
        }
        
        @keyframes logo-bounce {
          0% {
            transform: scale(0.8) translateY(10px);
          }
          50% {
            transform: scale(1.05) translateY(-5px);
          }
          70% {
            transform: scale(0.98) translateY(2px);
          }
          100% {
            transform: scale(1) translateY(0);
          }
        }
        
        @keyframes shimmer {
          0% {
            background-position: 200% 0;
          }
          100% {
            background-position: -200% 0;
          }
        }
        
        @keyframes pulse-slow {
          0%, 100% {
            opacity: 0.4;
            transform: scale(1);
          }
          50% {
            opacity: 0.2;
            transform: scale(1.1);
          }
        }
        
        .animate-float {
          animation: float linear infinite;
        }
        
        .animate-breath {
          animation: breath 3s ease-in-out infinite;
        }
        
        .animate-logo-bounce {
          animation: logo-bounce 0.6s ease-out forwards;
        }
        
        .animate-shimmer {
          animation: shimmer 2s linear infinite;
        }
        
        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export default AppLoading;
