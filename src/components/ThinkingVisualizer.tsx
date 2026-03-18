'use client';

import React, { useMemo, useState, useEffect, memo } from 'react';
import { StreamingMarkdown } from './StreamingMarkdown';

/**
 * 解析后的思维步骤
 */
interface ThinkingStep {
  title: string;
  content: string;
  tip?: string;
}

/**
 * 解析后的结构化思考内容
 */
interface ParsedThinking {
  steps: ThinkingStep[];
  summary?: string;
  raw: string;
}

/**
 * ThinkingVisualizer 组件属性
 */
interface ThinkingVisualizerProps {
  /** 思考内容 */
  content: string;
  /** 是否正在思考 */
  isThinking: boolean;
  /** 是否折叠 */
  isCollapsed: boolean;
  /** 折叠切换回调 */
  onToggleCollapse: () => void;
  /** 学霸思维引导模式 */
  enableGuideMode: boolean;
  /** 时间戳点击回调 */
  onTimestampClick?: (timestampMs: number) => void;
  /** 思考开始时间（用于计算耗时） */
  startTime?: number;
  /** 移动端模式 */
  isMobile?: boolean;
  /** 自定义样式类 */
  className?: string;
}

/**
 * 步骤图标映射
 */
const STEP_ICONS: Record<string, string> = {
  '理解问题': '🔍',
  '分析问题': '🔍',
  '关联知识': '📚',
  '关联记忆': '📚',
  '检索知识': '📚',
  '回忆知识': '📚',
  '逻辑推理': '🧩',
  '推理分析': '🧩',
  '组织回答': '✨',
  '形成答案': '✨',
  '总结归纳': '✨',
  '验证检查': '✅',
};

/**
 * 获取步骤图标
 */
function getStepIcon(title: string): string {
  for (const [key, icon] of Object.entries(STEP_ICONS)) {
    if (title.includes(key)) return icon;
  }
  return '💭';
}

/**
 * 解析学霸思维格式的内容
 * 
 * 格式示例：
 * 【思维步骤：理解问题】
 * 内容...
 * 
 * 学霸笔记：学习建议...
 * 
 * 本次用到的思维方法：方法1 - 方法2
 */
function parseThinkingContent(content: string): ParsedThinking {
  const result: ParsedThinking = {
    steps: [],
    raw: content,
  };

  if (!content) return result;

  // 匹配思维方法总结
  const summaryMatch = content.match(/本次用到的思维方法[：:]\s*(.+?)(?=\n|$)/);
  if (summaryMatch) {
    result.summary = summaryMatch[1].trim();
  }

  // 匹配思维步骤
  const stepRegex = /【思维步骤[：:](.+?)】([\s\S]*?)(?=【思维步骤|本次用到的思维方法|$)/g;
  let match;

  while ((match = stepRegex.exec(content)) !== null) {
    const title = match[1].trim();
    let stepContent = match[2].trim();
    let tip: string | undefined;

    // 提取学霸笔记
    const tipMatch = stepContent.match(/学霸笔记[：:]\s*([\s\S]+?)(?=\n\n|$)/);
    if (tipMatch) {
      tip = tipMatch[1].trim();
      // 移除学霸笔记部分，保留纯内容
      stepContent = stepContent.replace(/学霸笔记[：:][\s\S]*?(?=\n\n|$)/, '').trim();
    }

    if (title && stepContent) {
      result.steps.push({ title, content: stepContent, tip });
    }
  }

  return result;
}

/**
 * 简洁模式的思考展示
 */
const SimpleThinking = memo(function SimpleThinking({
  content,
  isThinking,
  onTimestampClick,
  isMobile,
}: {
  content: string;
  isThinking: boolean;
  onTimestampClick?: (ms: number) => void;
  isMobile?: boolean;
}) {
  return (
    <div className={`text-xs text-violet-700/80 leading-relaxed max-h-48 overflow-y-auto ${isMobile ? 'text-[10px]' : ''}`}>
      <StreamingMarkdown
        content={content}
        isStreaming={isThinking}
        onTimestampClick={onTimestampClick}
        className="thinking-content italic"
      />
    </div>
  );
});

/**
 * 单个思维步骤卡片
 */
const ThinkingStepCard = memo(function ThinkingStepCard({
  step,
  index,
  isLast,
  onTimestampClick,
  isMobile,
}: {
  step: ThinkingStep;
  index: number;
  isLast: boolean;
  onTimestampClick?: (ms: number) => void;
  isMobile?: boolean;
}) {
  const icon = getStepIcon(step.title);
  
  return (
    <div className="relative">
      {/* 步骤卡片 */}
      <div 
        className="bg-white/70 rounded-xl border border-violet-100 overflow-hidden shadow-sm hover:transition-shadow duration-200"
        style={{ animationDelay: `${index * 150}ms` }}
      >
        {/* 步骤标题 */}
        <div className="px-3 py-2 bg-[#D3E4F4]/30 border-b border-violet-100">
          <div className="flex items-center gap-2">
            <span className="text-base">{icon}</span>
            <span className={`font-medium text-violet-800 ${isMobile ? 'text-xs' : 'text-sm'}`}>
              {step.title}
            </span>
          </div>
        </div>
        
        {/* 步骤内容 */}
        <div className={`px-3 py-2 ${isMobile ? 'text-[10px]' : 'text-xs'} text-gray-700 leading-relaxed`}>
          <StreamingMarkdown
            content={step.content}
            isStreaming={false}
            onTimestampClick={onTimestampClick}
          />
        </div>
        
        {/* 学霸笔记 */}
        {step.tip && (
          <div className="px-3 py-2 bg-[#FDF3C0]/30 border-t border-[#E9E9E7]">
            <div className="flex items-start gap-2">
              <span className="text-[#787774] flex-shrink-0">💡</span>
              <p className={`text-[#232322] ${isMobile ? 'text-[10px]' : 'text-xs'} leading-relaxed`}>
                <span className="font-medium">学霸笔记：</span>
                {step.tip}
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* 连接线（非最后一个步骤时显示） */}
      {!isLast && (
        <div className="flex justify-center py-1">
          <div className="w-px h-4 bg-[#D3E4F4]" />
          <svg className="w-3 h-3 text-violet-400 absolute -bottom-1" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 16l-6-6h12l-6 6z" />
          </svg>
        </div>
      )}
    </div>
  );
});

/**
 * 学霸思维模式的结构化展示
 */
const StructuredThinking = memo(function StructuredThinking({
  parsed,
  isThinking,
  onTimestampClick,
  isMobile,
}: {
  parsed: ParsedThinking;
  isThinking: boolean;
  onTimestampClick?: (ms: number) => void;
  isMobile?: boolean;
}) {
  // 如果没有解析出步骤，降级为简洁模式
  if (parsed.steps.length === 0) {
    return (
      <SimpleThinking
        content={parsed.raw}
        isThinking={isThinking}
        onTimestampClick={onTimestampClick}
        isMobile={isMobile}
      />
    );
  }

  return (
    <div className="space-y-2">
      {/* 思维步骤卡片列表 */}
      {parsed.steps.map((step, index) => (
        <ThinkingStepCard
          key={index}
          step={step}
          index={index}
          isLast={index === parsed.steps.length - 1}
          onTimestampClick={onTimestampClick}
          isMobile={isMobile}
        />
      ))}
      
      {/* 思维方法总结 */}
      {parsed.summary && !isThinking && (
        <div className="mt-3 p-3 bg-[#D1F4E0]/30 rounded-xl border border-[#D1F4E0]">
          <div className="flex items-center gap-2">
            <span className="text-[#232322]">🌟</span>
            <p className={`text-[#232322] ${isMobile ? 'text-[10px]' : 'text-xs'} font-medium`}>
              本次用到的思维方法：
              <span className="font-normal ml-1">{parsed.summary}</span>
            </p>
          </div>
        </div>
      )}
      
      {/* 思考中的提示 */}
      {isThinking && (
        <div className="flex items-center justify-center gap-2 py-2 text-violet-500">
          <div className="loading-dots scale-75">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span className={`${isMobile ? 'text-[10px]' : 'text-xs'}`}>继续思考中...</span>
        </div>
      )}
    </div>
  );
});

/**
 * 思考过程可视化组件
 * 
 * 支持两种模式：
 * 1. 简洁模式（enableGuideMode=false）：原始思考文本展示
 * 2. 学霸思维模式（enableGuideMode=true）：结构化步骤卡片展示
 */
export const ThinkingVisualizer = memo(function ThinkingVisualizer({
  content,
  isThinking,
  isCollapsed,
  onToggleCollapse,
  enableGuideMode,
  onTimestampClick,
  startTime,
  isMobile = false,
  className = '',
}: ThinkingVisualizerProps) {
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // 计算思考耗时
  useEffect(() => {
    if (!startTime) return;
    
    if (isThinking) {
      // 思考中：实时更新耗时
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 100);
      return () => clearInterval(interval);
    } else {
      // 思考结束：固定最终耗时
      setElapsedTime(Date.now() - startTime);
    }
  }, [isThinking, startTime]);

  // 解析思考内容（仅在学霸模式下）
  const parsed = useMemo(() => {
    if (!enableGuideMode) return null;
    return parseThinkingContent(content);
  }, [content, enableGuideMode]);

  // 格式化耗时
  const formattedTime = useMemo(() => {
    if (!startTime || elapsedTime < 100) return null;
    const seconds = (elapsedTime / 1000).toFixed(1);
    return `${seconds}s`;
  }, [startTime, elapsedTime]);

  if (!content) return null;

  return (
    <div className={`w-full ${className}`}>
      <div 
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          isThinking 
            ? 'bg-[#D3E4F4]/30 border-violet-200 shadow-violet-100/50' 
            : 'bg-violet-50/50 border-violet-100'
        }`}
      >
        {/* 标题栏 */}
        <button
          onClick={onToggleCollapse}
          className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-violet-100/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className={`text-violet-600 text-lg ${isThinking ? 'animate-pulse' : ''}`}>
              {isThinking ? '🧠' : '💭'}
            </span>
            <span className={`font-medium text-violet-700 ${isMobile ? 'text-xs' : 'text-sm'}`}>
              {enableGuideMode 
                ? (isThinking ? '跟我一起理清思路...' : '思维过程')
                : (isThinking ? 'AI 正在思考...' : '思考过程')
              }
            </span>
            {isThinking && (
              <div className="loading-dots scale-75">
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {/* 耗时统计 */}
            {formattedTime && (
              <span className={`text-violet-400 ${isMobile ? 'text-[10px]' : 'text-xs'}`}>
                {formattedTime}
              </span>
            )}
            
            {/* 折叠箭头 */}
            <svg 
              className={`w-4 h-4 text-violet-500 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
        
        {/* 内容区域 */}
        {!isCollapsed && (
          <div className={`px-4 pb-3 pt-1 ${enableGuideMode ? '' : ''}`}>
            {enableGuideMode && parsed ? (
              <StructuredThinking
                parsed={parsed}
                isThinking={isThinking}
                onTimestampClick={onTimestampClick}
                isMobile={isMobile}
              />
            ) : (
              <SimpleThinking
                content={content}
                isThinking={isThinking}
                onTimestampClick={onTimestampClick}
                isMobile={isMobile}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default ThinkingVisualizer;
