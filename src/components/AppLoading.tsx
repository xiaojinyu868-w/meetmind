'use client';

import { useEffect, useState } from 'react';

interface AppLoadingProps {
  message?: string;
}

export function AppLoading({ message = '正在加载' }: AppLoadingProps) {
  const [progress, setProgress] = useState(0);
  const [dots, setDots] = useState('');
  
  useEffect(() => {
    // 进度动画 - 更平滑
    const progressInterval = setInterval(() => {
      setProgress(prev => prev >= 95 ? 95 : prev + Math.random() * 8);
    }, 200);
    
    // 点点动画
    const dotsInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);
    
    // 最终完成
    const timeout = setTimeout(() => {
      setProgress(100);
    }, 2500);
    
    return () => {
      clearInterval(progressInterval);
      clearInterval(dotsInterval);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-gradient-to-br from-amber-50/50 via-white to-orange-50/30 overflow-hidden">
      {/* 背景装饰 - 简洁的几何形状 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, #F5E6D3 0%, transparent 60%)' }}
        />
        <div 
          className="absolute bottom-0 -left-20 w-64 h-64 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #A8E6CF 0%, transparent 60%)' }}
        />
      </div>

      {/* 主要内容 */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Logo */}
        <div className="relative mb-10">
          {/* 外圈动画 */}
          <svg className="w-24 h-24" viewBox="0 0 96 96">
            {/* 底层圆环 */}
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke="#F5E6D3"
              strokeWidth="4"
            />
            {/* 动态进度圆环 */}
            <circle
              cx="48"
              cy="48"
              r="42"
              fill="none"
              stroke="url(#gradient)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${progress * 2.64} 264`}
              transform="rotate(-90 48 48)"
              style={{ transition: 'stroke-dasharray 0.3s ease-out' }}
            />
            {/* 渐变定义 */}
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#D4A574" />
                <stop offset="100%" stopColor="#C4956A" />
              </linearGradient>
            </defs>
          </svg>
          
          {/* 中心 Logo */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div 
              className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: 'linear-gradient(135deg, #D4A574 0%, #C4956A 100%)' }}
            >
              <span className="text-white text-2xl font-bold">M</span>
            </div>
          </div>
        </div>

        {/* 品牌名称 */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-800">
            MeetMind
          </h1>
          <p className="text-sm text-gray-500 mt-1.5">
            智能课堂学习助手
          </p>
        </div>

        {/* 加载进度条 - 更明显 */}
        <div className="w-64 mb-3">
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden shadow-inner">
            <div 
              className="h-full rounded-full shadow-sm"
              style={{
                width: `${progress}%`,
                background: 'linear-gradient(90deg, #D4A574 0%, #C4956A 100%)',
                transition: 'width 0.3s ease-out'
              }}
            />
          </div>
          {/* 进度百分比 */}
          <div className="flex justify-between mt-1.5 text-xs">
            <span className="text-gray-400">{message}{dots}</span>
            <span className="text-amber-600 font-medium">{Math.round(progress)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppLoading;
