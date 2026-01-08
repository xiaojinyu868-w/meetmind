'use client';

/**
 * 引导问题组件
 * 
 * 用于展示 Dify 返回的引导问题，让学生选择选项
 * 帮助诊断学生卡点（概念/步骤/审题/计算/图像理解等）
 */

import { useState } from 'react';
import type { GuidanceQuestion as GuidanceQuestionType, GuidanceOption } from '@/types/dify';

interface GuidanceQuestionProps {
  /** 引导问题数据 */
  question: GuidanceQuestionType;
  /** 选择回调 */
  onSelect: (optionId: string, option: GuidanceOption) => void;
  /** 是否正在加载（选择后等待响应） */
  isLoading?: boolean;
  /** 是否禁用（已选择过） */
  disabled?: boolean;
  /** 已选择的选项 ID */
  selectedOptionId?: string;
}

export function GuidanceQuestion({
  question,
  onSelect,
  isLoading = false,
  disabled = false,
  selectedOptionId,
}: GuidanceQuestionProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 选项分类对应的颜色
  const categoryColors: Record<GuidanceOption['category'], string> = {
    concept: 'bg-blue-50 border-blue-200 hover:border-blue-400',
    procedure: 'bg-green-50 border-green-200 hover:border-green-400',
    calculation: 'bg-yellow-50 border-yellow-200 hover:border-yellow-400',
    comprehension: 'bg-purple-50 border-purple-200 hover:border-purple-400',
    application: 'bg-orange-50 border-orange-200 hover:border-orange-400',
  };

  const categoryLabels: Record<GuidanceOption['category'], string> = {
    concept: '概念理解',
    procedure: '步骤方法',
    calculation: '计算过程',
    comprehension: '审题理解',
    application: '实际应用',
  };

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-xl p-4 border border-indigo-100">
      {/* 问题标题 */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center">
          <span className="text-white text-sm">🤔</span>
        </div>
        <div className="flex-1">
          <p className="text-gray-900 font-medium leading-relaxed">
            {question.question}
          </p>
          {question.hint && (
            <p className="text-sm text-gray-500 mt-1">{question.hint}</p>
          )}
        </div>
        <span className="text-xs text-indigo-600 bg-indigo-100 px-2 py-1 rounded-full">
          单选
        </span>
      </div>

      {/* 选项列表 */}
      <div className="space-y-2">
        {question.options.map((option, index) => {
          const isSelected = selectedOptionId === option.id;
          const isHovered = hoveredId === option.id;
          const baseColor = categoryColors[option.category];
          
          return (
            <button
              key={option.id}
              onClick={() => !disabled && !isLoading && onSelect(option.id, option)}
              onMouseEnter={() => setHoveredId(option.id)}
              onMouseLeave={() => setHoveredId(null)}
              disabled={disabled || isLoading}
              className={`
                w-full text-left p-3 rounded-lg border-2 transition-all duration-200
                ${isSelected 
                  ? 'bg-indigo-100 border-indigo-500 ring-2 ring-indigo-200' 
                  : baseColor
                }
                ${disabled || isLoading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
                ${isHovered && !disabled && !isLoading ? 'transform scale-[1.01] shadow-sm' : ''}
              `}
            >
              <div className="flex items-center gap-3">
                {/* 选项序号/选中状态 */}
                <div className={`
                  w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium
                  ${isSelected 
                    ? 'bg-indigo-500 text-white' 
                    : 'bg-white border border-gray-300 text-gray-600'
                  }
                `}>
                  {isSelected ? '✓' : String.fromCharCode(65 + index)}
                </div>
                
                {/* 选项文本 */}
                <span className={`flex-1 ${isSelected ? 'text-indigo-900 font-medium' : 'text-gray-700'}`}>
                  {option.text}
                </span>

                {/* 分类标签（悬停时显示） */}
                {isHovered && !isSelected && (
                  <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded">
                    {categoryLabels[option.category]}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 加载状态 */}
      {isLoading && (
        <div className="mt-4 flex items-center justify-center gap-2 text-indigo-600">
          <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
          <span className="text-sm">正在分析你的选择...</span>
        </div>
      )}
    </div>
  );
}

/**
 * 引导问题骨架屏
 */
export function GuidanceQuestionSkeleton() {
  return (
    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 animate-pulse">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 bg-gray-200 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-gray-200 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
