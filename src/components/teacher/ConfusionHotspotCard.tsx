'use client';

import { useState } from 'react';

export interface HotspotData {
  rank: number;
  timeRange: string;
  startMs: number;
  endMs: number;
  count: number;
  content: string;
  students: string[];
  possibleReason: string;
}

interface ConfusionHotspotCardProps {
  hotspot: HotspotData;
  isTop?: boolean;
}

export function ConfusionHotspotCard({ hotspot, isTop = false }: ConfusionHotspotCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // 根据排名确定样式
  const getRankStyle = () => {
    if (hotspot.rank === 1) {
      return {
        badge: 'bg-gradient-to-br from-amber-400 via-yellow-500 to-orange-500 shadow-amber-500/40',
        border: 'border-amber-200/50',
        glow: 'shadow-amber-500/10',
        indicator: 'bg-amber-500',
      };
    }
    if (hotspot.rank === 2) {
      return {
        badge: 'bg-gradient-to-br from-slate-300 via-gray-400 to-slate-500 shadow-slate-400/40',
        border: 'border-slate-200/50',
        glow: 'shadow-slate-400/10',
        indicator: 'bg-slate-400',
      };
    }
    return {
      badge: 'bg-gradient-to-br from-amber-600 via-orange-700 to-amber-800 shadow-amber-700/40',
      border: 'border-amber-200/30',
      glow: 'shadow-amber-600/10',
      indicator: 'bg-amber-700',
    };
  };

  const style = getRankStyle();
  
  // 热度指示器
  const heatLevel = Math.min(hotspot.count, 5);
  
  return (
    <div 
      className={`
        group relative overflow-hidden
        bg-white/80 backdrop-blur-sm
        rounded-2xl border ${style.border}
        shadow-lg ${style.glow}
        transition-all duration-500 ease-out
        hover:shadow-2xl hover:scale-[1.02] hover:-translate-y-1
        ${isTop ? 'ring-2 ring-amber-400/30' : ''}
      `}
    >
      {/* 背景装饰 */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50/50 to-transparent pointer-events-none" />
      <div className="absolute -right-8 -top-8 w-32 h-32 bg-gradient-to-br from-indigo-100/30 to-transparent rounded-full blur-2xl pointer-events-none" />
      
      {/* 顶部热度条 */}
      <div className="h-1 bg-gray-100 overflow-hidden">
        <div 
          className={`h-full ${style.indicator} transition-all duration-700`}
          style={{ width: `${(heatLevel / 5) * 100}%` }}
        />
      </div>
      
      <div className="relative p-5">
        {/* 头部：排名徽章 + 时间 */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* 排名徽章 */}
            <div className={`
              w-10 h-10 rounded-xl ${style.badge}
              flex items-center justify-center
              shadow-lg transform group-hover:rotate-3 transition-transform duration-300
            `}>
              <span className="text-white font-bold text-lg">{hotspot.rank}</span>
            </div>
            
            <div>
              <div className="text-sm font-medium text-slate-500 mb-0.5">
                困惑时段
              </div>
              <div className="font-mono text-lg font-semibold text-slate-800 tracking-tight">
                {hotspot.timeRange}
              </div>
            </div>
          </div>
          
          {/* 困惑人数 */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 rounded-full">
            <div className="flex -space-x-1">
              {Array.from({ length: Math.min(hotspot.count, 3) }).map((_, i) => (
                <div 
                  key={i}
                  className="w-5 h-5 rounded-full bg-gradient-to-br from-red-400 to-rose-500 border-2 border-white flex items-center justify-center"
                >
                  <span className="text-[8px] text-white">👤</span>
                </div>
              ))}
            </div>
            <span className="text-sm font-bold text-red-600">{hotspot.count}人</span>
          </div>
        </div>
        
        {/* 内容摘要 */}
        <div className="mb-4">
          <p className="text-slate-700 leading-relaxed line-clamp-2 group-hover:line-clamp-none transition-all">
            {hotspot.content}
          </p>
        </div>
        
        {/* 可能原因标签 */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-slate-400">可能原因</span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            {hotspot.possibleReason}
          </span>
        </div>
        
        {/* 展开详情 */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <span>{isExpanded ? '收起详情' : '查看详情'}</span>
          <svg 
            className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {/* 展开内容 */}
        <div className={`
          overflow-hidden transition-all duration-500 ease-out
          ${isExpanded ? 'max-h-40 opacity-100 mt-3' : 'max-h-0 opacity-0'}
        `}>
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs text-slate-400 mb-2">困惑学生</div>
            <div className="flex flex-wrap gap-2">
              {hotspot.students.map((student, i) => (
                <span 
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-md text-xs text-slate-600"
                >
                  <span>👤</span> {student}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
